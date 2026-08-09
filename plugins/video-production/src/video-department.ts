import {
  ApplicationError,
  type ApplicationJsonValue,
  type OperationContext,
  type PortHealth,
} from "@v31m4/application";
import type {
  DepartmentConnector,
  DepartmentInstance,
  DepartmentManifest,
} from "@v31m4/department-host";
import {
  type AssemblyAdapter,
  contentHash,
  type GeneratedShot,
  type ProductionRecord,
  type ProductionSpec,
  type ProductionStore,
  parseProductionSpec,
  type QcFinding,
  type ShotCache,
  type ShotGenerationAdapter,
  type ShotRecord,
  type ShotSpec,
  type VisionQcAdapter,
} from "./contracts.js";
import {
  InMemoryProductionStore,
  InMemoryShotCache,
  ReferenceAssemblyAdapter,
  ReferenceShotGenerationAdapter,
  ReferenceVisionQcAdapter,
} from "./reference-adapters.js";

export interface VideoDepartmentDeps {
  readonly generation: ShotGenerationAdapter;
  readonly qc: VisionQcAdapter;
  readonly assembly: AssemblyAdapter;
  readonly store: ProductionStore;
  readonly cache: ShotCache;
}

interface ShotOutcome {
  readonly record: ShotRecord;
  readonly shot?: GeneratedShot;
}

/**
 * The Video Production department: deterministic software owns the long-horizon workflow while
 * generation, QC, and assembly are delegated to replaceable adapters. Each shot runs a
 * generate → vision-QC → bounded-correction loop; accepted shots are content-cached separately
 * from the durable workflow state, so an interrupted production resumes from its last checkpoint
 * without repeating accepted work, and the assembled output is verified before completion.
 */
export class VideoDepartment implements DepartmentInstance {
  #ready = false;

  constructor(private readonly deps: VideoDepartmentDeps) {}

  async start(): Promise<void> {
    this.#ready = true;
  }

  async stop(): Promise<void> {
    this.#ready = false;
  }

  async health(): Promise<PortHealth> {
    return Object.freeze({
      status: this.#ready ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      details: { department: "video-production" },
    });
  }

  async invoke(
    capabilityId: string,
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    if (!this.#ready) {
      throw new ApplicationError("CONFLICT", "Video department is not started.");
    }
    switch (capabilityId) {
      case "video.render_production":
        return this.#render(request, context);
      case "video.production_status":
        return this.#status(request);
      default:
        throw new ApplicationError("UNSUPPORTED_OPERATION", "Unknown video capability.", {
          details: { capabilityId },
        });
    }
  }

  async #render(
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const spec = parseProductionSpec(request);
    const prior = await this.deps.store.load(spec.productionId);
    const shotRecords = new Map<string, ShotRecord>(
      (prior?.shots ?? []).map((shot) => [shot.shotId, shot]),
    );
    let record: ProductionRecord = {
      productionId: spec.productionId,
      status: "in_progress",
      shots: [],
    };
    const accepted: GeneratedShot[] = [];

    for (const shotSpec of spec.shots) {
      const existing = shotRecords.get(shotSpec.shotId);
      const cached =
        existing?.status === "accepted" && existing.outputRef !== undefined
          ? this.deps.cache.get(existing.outputRef)
          : undefined;
      if (existing?.status === "accepted" && cached !== undefined) {
        accepted.push(cached); // resume: reuse cached accepted work, no regeneration
        shotRecords.set(shotSpec.shotId, existing);
        continue;
      }
      const outcome = await this.#produceShot(shotSpec, spec.maxAttemptsPerShot, context);
      shotRecords.set(shotSpec.shotId, outcome.record);
      record = {
        productionId: spec.productionId,
        status: "in_progress",
        shots: this.#order(spec, shotRecords),
      };
      await this.deps.store.save(record); // checkpoint after every shot
      if (outcome.record.status !== "accepted" || outcome.shot === undefined) {
        record = { ...record, status: "failed" };
        await this.deps.store.save(record);
        return this.#receipt(record);
      }
      this.deps.cache.put(outcome.shot);
      accepted.push(outcome.shot);
    }

    record = {
      productionId: spec.productionId,
      status: "shots_complete",
      shots: this.#order(spec, shotRecords),
    };
    await this.deps.store.save(record);

    const output = await this.deps.assembly.assemble(spec.productionId, accepted, context);
    const expected = contentHash({
      shotRefs: accepted.map((shot) => shot.outputRef),
      kind: "checksum",
    });
    if (output.checksum !== expected) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Assembled output failed verification.", {
        details: { productionId: spec.productionId },
      });
    }
    record = { ...record, status: "completed", finalOutputRef: output.outputRef };
    await this.deps.store.save(record);
    return this.#receipt(record);
  }

  async #produceShot(
    shotSpec: ShotSpec,
    maxAttempts: number,
    context: OperationContext,
  ): Promise<ShotOutcome> {
    let currentSpec = shotSpec;
    let findings: readonly QcFinding[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const generated = await this.deps.generation.generate(currentSpec, attempt, context);
      const report = await this.deps.qc.inspect(generated, currentSpec, context);
      if (report.passed) {
        return {
          record: {
            shotId: shotSpec.shotId,
            status: "accepted",
            attempts: attempt,
            outputRef: generated.outputRef,
          },
          shot: generated,
        };
      }
      findings = report.findings;
      currentSpec = this.#applyCorrection(currentSpec);
    }
    return {
      record: { shotId: shotSpec.shotId, status: "failed", attempts: maxAttempts, findings },
    };
  }

  /** Deterministic repair: drop the detected defect and annotate the prompt for the retry. */
  #applyCorrection(spec: ShotSpec): ShotSpec {
    const { defect: _dropped, ...rest } = spec;
    return Object.freeze({ ...rest, prompt: `${spec.prompt} [repair]` });
  }

  #order(spec: ProductionSpec, records: Map<string, ShotRecord>): readonly ShotRecord[] {
    const ordered: ShotRecord[] = [];
    for (const shotSpec of spec.shots) {
      const record = records.get(shotSpec.shotId);
      if (record !== undefined) ordered.push(record);
    }
    return Object.freeze(ordered);
  }

  async #status(request: ApplicationJsonValue): Promise<ApplicationJsonValue> {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Status request must be an object.");
    }
    const productionId = (request as Record<string, ApplicationJsonValue>)["productionId"];
    if (typeof productionId !== "string") {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "productionId is required.");
    }
    const record = await this.deps.store.load(productionId);
    if (record === null) {
      throw new ApplicationError("NOT_FOUND", "Production not found.", {
        details: { productionId },
      });
    }
    return this.#receipt(record);
  }

  #receipt(record: ProductionRecord): ApplicationJsonValue {
    return {
      productionId: record.productionId,
      status: record.status,
      finalOutputRef: record.finalOutputRef ?? null,
      shots: record.shots.map((shot) => ({
        shotId: shot.shotId,
        status: shot.status,
        attempts: shot.attempts,
        outputRef: shot.outputRef ?? null,
      })),
    };
  }
}

/** Deterministic reference dependencies (no external tools/models), for verification and demos. */
export function referenceVideoDeps(): VideoDepartmentDeps {
  return {
    generation: new ReferenceShotGenerationAdapter(),
    qc: new ReferenceVisionQcAdapter(),
    assembly: new ReferenceAssemblyAdapter(),
    store: new InMemoryProductionStore(),
    cache: new InMemoryShotCache(),
  };
}

/** A host connector that binds the Video department in-process with the given dependencies. */
export function createVideoConnector(deps: VideoDepartmentDeps): DepartmentConnector {
  return { connect: async () => new VideoDepartment(deps) };
}

export const videoManifest: DepartmentManifest = Object.freeze({
  departmentId: "video-production",
  displayName: "Video Production",
  version: "0.1.0",
  hostApiVersion: "1.0.0",
  capabilities: ["video.render_production", "video.production_status"],
  requiredToolIds: [],
  optionalToolIds: ["ffmpeg", "blender", "comfyui"],
  requiredModelIds: [],
  permissions: ["workspace.write", "cache.write"],
  workspacePath: "departments/video-production",
});
