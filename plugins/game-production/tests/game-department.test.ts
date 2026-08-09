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
  type BuiltScene,
  createGameConnector,
  GameDepartment,
  type GameDepartmentDeps,
  type GameProjectSpec,
  gameManifest,
  InMemoryProjectStore,
  InMemorySceneCache,
  type PackageAdapter,
  ReferenceAssetAdapter,
  ReferencePackageAdapter,
  ReferenceSceneBuildAdapter,
  ReferenceSceneValidationAdapter,
  referenceGameDeps,
} from "../src/index.js";

const context: OperationContext = createOperationContext({
  requestId: "request-game",
  idempotencyKey: "idempotency-game",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-09T12:00:00.000Z",
});

const clock: ClockPort = {
  now: () => "2026-08-09T12:00:00.000Z",
  monotonicMilliseconds: () => 0,
  sleep: async () => undefined,
};

function project(overrides: Partial<GameProjectSpec> = {}): GameProjectSpec {
  return {
    projectId: "game-1",
    maxAttemptsPerScene: 3,
    scenes: [
      {
        sceneId: "scene-1",
        engine: "reference",
        assets: [{ assetId: "hero-mesh", kind: "mesh", source: "assets/hero.glb" }],
      },
      {
        sceneId: "scene-2",
        engine: "godot",
        assets: [{ assetId: "level-tex", kind: "texture", source: "assets/level.png" }],
        defect: "missing-collision",
      },
    ],
    ...overrides,
  };
}

async function started(deps: GameDepartmentDeps): Promise<GameDepartment> {
  const department = new GameDepartment(deps);
  await department.start();
  return department;
}

type Receipt = {
  status: string;
  packageRef: string | null;
  scenes: { sceneId: string; status: string; attempts: number }[];
};

describe("GameDepartment orchestration", () => {
  it("builds a project, repairing a validation defect through the bounded loop", async () => {
    const department = await started(referenceGameDeps());
    const receipt = (await department.invoke(
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    expect(receipt.packageRef).toBeTypeOf("string");
    expect(receipt.scenes.map((scene) => scene.status)).toEqual(["accepted", "accepted"]);
    expect(receipt.scenes[1]?.attempts).toBe(2); // defective scene rebuilt after repair
  });

  it("acquires each scene's assets during the build", async () => {
    const deps = referenceGameDeps();
    const assets = deps.assets as ReferenceAssetAdapter;
    const department = await started(deps);
    await department.invoke(
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    );
    expect(assets.acquireCalls).toBe(2); // one asset per scene
  });

  it("fails the project when bounded retries cannot repair a scene", async () => {
    const department = await started(referenceGameDeps());
    const receipt = (await department.invoke(
      "game.build_project",
      project({ maxAttemptsPerScene: 1 }) as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("failed");
    expect(receipt.packageRef).toBeNull();
  });

  it("reuses cached accepted scenes on a re-run instead of rebuilding", async () => {
    const deps = referenceGameDeps();
    const build = deps.build as ReferenceSceneBuildAdapter;
    const department = await started(deps);
    await department.invoke(
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    );
    const afterFirst = build.buildCalls;
    const receipt = (await department.invoke(
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    expect(build.buildCalls).toBe(afterFirst); // no rebuild on the cached re-run
  });

  it("resumes an interrupted project after a packaging failure, without rebuilding scenes", async () => {
    const inner = new ReferencePackageAdapter();
    let packageCalls = 0;
    const flakyPackage: PackageAdapter = {
      package: async (id, scenes) => {
        packageCalls += 1;
        if (packageCalls === 1) throw new Error("build server unavailable");
        return inner.package(id, scenes);
      },
    };
    const deps: GameDepartmentDeps = {
      assets: new ReferenceAssetAdapter(),
      build: new ReferenceSceneBuildAdapter(),
      validation: new ReferenceSceneValidationAdapter(),
      packaging: flakyPackage,
      store: new InMemoryProjectStore(),
      cache: new InMemorySceneCache(),
    };
    const department = await started(deps);
    await expect(
      department.invoke(
        "game.build_project",
        project() as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toThrow(/build server/);
    const builtAfterCrash = (deps.build as ReferenceSceneBuildAdapter).buildCalls;
    const receipt = (await department.invoke(
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");
    expect((deps.build as ReferenceSceneBuildAdapter).buildCalls).toBe(builtAfterCrash);
  });

  it("rejects a package that fails checksum verification", async () => {
    const badPackage: PackageAdapter = {
      package: async (
        _id,
        scenes,
      ): Promise<{ outputRef: string; checksum: string; sceneRefs: string[] }> => ({
        outputRef: "tampered",
        checksum: "wrong-checksum",
        sceneRefs: scenes.map((scene: BuiltScene) => scene.sceneRef),
      }),
    };
    const deps: GameDepartmentDeps = { ...referenceGameDeps(), packaging: badPackage };
    const department = await started(deps);
    await expect(
      department.invoke(
        "game.build_project",
        project({
          scenes: [{ sceneId: "s1", engine: "reference", assets: [] }],
        }) as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("propagates an engine build adapter failure", async () => {
    const deps: GameDepartmentDeps = {
      ...referenceGameDeps(),
      build: { build: async () => Promise.reject(new Error("engine crashed")) },
    };
    const department = await started(deps);
    await expect(
      department.invoke(
        "game.build_project",
        project() as unknown as ApplicationJsonValue,
        context,
      ),
    ).rejects.toThrow(/engine crashed/);
  });
});

describe("GameDepartment as a removable department", () => {
  function gameHost() {
    const db = new SqliteRuntimeDatabase(
      join(mkdtempSync(join(tmpdir(), "v31m4-game-")), "state.db"),
    );
    const registry = new SqlitePluginRegistry(db);
    const released: string[] = [];
    const host = new DepartmentHost({
      registry,
      unitOfWork: db.unitOfWork,
      clock,
      connector: createGameConnector(referenceGameDeps()),
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
    const { host, db, released } = gameHost();
    await host.install(
      gameManifest,
      { permissions: gameManifest.permissions, availableToolIds: [], availableModelIds: [] },
      context,
    );
    await host.enable("game-production", context);
    await host.start("game-production", context);
    const receipt = (await host.invoke(
      "game-production",
      "game.build_project",
      project() as unknown as ApplicationJsonValue,
      context,
    )) as Receipt;
    expect(receipt.status).toBe("completed");

    await host.stop("game-production", context);
    await host.disable("game-production", context);
    await host.remove("game-production", context);
    expect(released).toContain("game-production");
    expect(host.state("game-production")).toBe("removed");
    db.close();
  });
});
