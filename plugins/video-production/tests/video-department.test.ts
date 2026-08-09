import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationJsonValue,
  type ClockPort,
  createOperationContext,
  type OperationContext,
} from "@v31m4/application";
import { DepartmentHost } from "@v31m4/department-host";
import { SqlitePluginRegistry, SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import { describe, expect, it } from "vitest";
import {
  type AssemblyAdapter,
  createVideoConnector,
  type GeneratedShot,
  InMemoryProductionStore,
  InMemoryShotCache,
  type ProductionSpec,
  ReferenceAssemblyAdapter,
  ReferenceShotGenerationAdapter,
  ReferenceVisionQcAdapter,
  referenceVideoDeps,
  VideoDepartment,
  type VideoDepartmentDeps,
  videoManifest,
} from "../src/index.js";

const context: OperationContext = createOperationContext({
  requestId: "request-video",
  idempotencyKey: "idempotency-video",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-09T12:00:00.000Z",
});

const clock: ClockPort = {
  now: () => "2026-08-09T12:00:00.000Z",
  monotonicMilliseconds: () => 0,
  sleep: async () => undefined,
};

function production(overrides: Partial<ProductionSpec> = {}): ProductionSpec {
  return {
    productionId: "prod-1",
    maxAttemptsPerShot: 3,
    shots: [
      { shotId: "shot-1", prompt: "wide establishing", qualityTier: "standard", seed: 1 },
      {
        shotId: "shot-2",
        prompt: "hero close-up",
        qualityTier: "premium",
        seed: 2,
        defect: "identity-drift",
      },
    ],
    ...overrides,
  };
}

async function started(deps: VideoDepartmentDeps): Promise<VideoDepartment> {
  const department = new VideoDepartment(deps);
  await department.start();
  return department;
}

type Receipt = {
  status: string;
  finalOutputRef: string | null;
  shots: { shotId: string; status: string; attempts: number }[];
};

describe("VideoDepartment orchestration", () => {
  it("renders a production, repairing a QC defect through the correction loop", async () => {
    const department = await started(referenceVideoDeps());
    const receipt = (await department.invoke(
      "video.render_production",
      production() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    expect(receipt.finalOutputRef).toBeTypeOf("string");
    expect(receipt.shots.map((shot) => shot.status)).toEqual(["accepted", "accepted"]);
    // The defective shot needed a second attempt after the correction dropped the defect.
    expect(receipt.shots[1]?.attempts).toBe(2);
  });

  it("fails the production when bounded retries cannot repair a shot", async () => {
    const department = await started(referenceVideoDeps());
    const receipt = (await department.invoke(
      "video.render_production",
      production({ maxAttemptsPerShot: 1 }) as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("failed");
    expect(receipt.finalOutputRef).toBeNull();
  });

  it("reuses cached accepted shots on a re-run instead of regenerating", async () => {
    const deps = referenceVideoDeps();
    const generation = deps.generation as ReferenceShotGenerationAdapter;
    const department = await started(deps);
    await department.invoke(
      "video.render_production",
      production() as unknown as ApplicationJsonValue,
      context,
    );
    const afterFirst = generation.generateCalls;
    const receipt = (await department.invoke(
      "video.render_production",
      production() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    expect(generation.generateCalls).toBe(afterFirst); // no regeneration on the cached re-run
  });

  it("resumes an interrupted production after an assembly failure, without regenerating shots", async () => {
    const inner = new ReferenceAssemblyAdapter();
    let assembleCalls = 0;
    const flakyAssembly: AssemblyAdapter = {
      assemble: async (id, shots) => {
        assembleCalls += 1;
        if (assembleCalls === 1) throw new Error("render farm unavailable");
        return inner.assemble(id, shots);
      },
    };
    const deps: VideoDepartmentDeps = {
      generation: new ReferenceShotGenerationAdapter(),
      qc: new ReferenceVisionQcAdapter(),
      assembly: flakyAssembly,
      store: new InMemoryProductionStore(),
      cache: new InMemoryShotCache(),
    };
    const department = await started(deps);
    await expect(
      department.invoke(
        "video.render_production",
        production() as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toThrow(/render farm/);
    const generatedAfterCrash = (deps.generation as ReferenceShotGenerationAdapter).generateCalls;
    const receipt = (await department.invoke(
      "video.render_production",
      production() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    // Resume reused the checkpointed, cached shots — no shot was regenerated.
    expect((deps.generation as ReferenceShotGenerationAdapter).generateCalls).toBe(
      generatedAfterCrash,
    );
  });

  it("rejects an assembled output that fails checksum verification", async () => {
    const badAssembly: AssemblyAdapter = {
      assemble: async (
        _id,
        shots,
      ): Promise<{ outputRef: string; checksum: string; shotRefs: string[] }> => ({
        outputRef: "tampered",
        checksum: "wrong-checksum",
        shotRefs: shots.map((shot: GeneratedShot) => shot.outputRef),
      }),
    };
    const deps: VideoDepartmentDeps = { ...referenceVideoDeps(), assembly: badAssembly };
    const department = await started(deps);
    await expect(
      department.invoke(
        "video.render_production",
        production({
          shots: [{ shotId: "s1", prompt: "clean", qualityTier: "draft", seed: 1 }],
        }) as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("propagates a generation adapter failure", async () => {
    const deps: VideoDepartmentDeps = {
      ...referenceVideoDeps(),
      generation: { generate: async () => Promise.reject(new Error("gpu oom")) },
    };
    const department = await started(deps);
    await expect(
      department.invoke(
        "video.render_production",
        production() as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toThrow(/gpu oom/);
  });
});

describe("VideoDepartment as a removable department", () => {
  function videoHost() {
    const db = new SqliteRuntimeDatabase(
      join(mkdtempSync(join(tmpdir(), "v31m4-video-")), "state.db"),
    );
    const registry = new SqlitePluginRegistry(db);
    const released: string[] = [];
    const host = new DepartmentHost({
      registry,
      unitOfWork: db.unitOfWork,
      clock,
      connector: createVideoConnector(referenceVideoDeps()),
      workspaces: {
        allocate: async (id, path) => ({
          path: `${path}/${id}`,
          release: async () => void released.push(id),
        }),
      },
    });
    return { host, db, released };
  }

  it("installs, runs, and removes cleanly, leaving the host operable", async () => {
    const { host, db, released } = videoHost();
    await host.install(
      videoManifest,
      { permissions: videoManifest.permissions, availableToolIds: [], availableModelIds: [] },
      context,
    );
    await host.enable("video-production", context);
    await host.start("video-production", context);
    const receipt = (await host.invoke(
      "video-production",
      "video.render_production",
      production() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");

    await host.stop("video-production", context);
    await host.disable("video-production", context);
    await host.remove("video-production", context);
    expect(released).toContain("video-production");
    expect(host.list().find((entry) => entry.departmentId === "video-production")?.state).toBe(
      "removed",
    );
    // Host still operable with the department removed.
    expect(host.list().every((entry) => entry.state === "removed")).toBe(true);
    db.close();
  });
});
