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
  type AcquiredAsset,
  type AssetAdapter,
  type BuiltScene,
  contentHash,
  type GameProjectSpec,
  type PackageAdapter,
  type ProjectRecord,
  type ProjectStore,
  parseGameProjectSpec,
  type SceneBuildAdapter,
  type SceneCache,
  type SceneRecord,
  type SceneSpec,
  type SceneValidationAdapter,
  type ValidationFinding,
} from "./contracts.js";
import {
  InMemoryProjectStore,
  InMemorySceneCache,
  ReferenceAssetAdapter,
  ReferencePackageAdapter,
  ReferenceSceneBuildAdapter,
  ReferenceSceneValidationAdapter,
} from "./reference-adapters.js";

export interface GameDepartmentDeps {
  readonly assets: AssetAdapter;
  readonly build: SceneBuildAdapter;
  readonly validation: SceneValidationAdapter;
  readonly packaging: PackageAdapter;
  readonly store: ProjectStore;
  readonly cache: SceneCache;
}

interface SceneOutcome {
  readonly record: SceneRecord;
  readonly scene?: BuiltScene;
}

/**
 * The 3D/Game Production department: deterministic software owns the project workflow while asset
 * acquisition, engine scene builds, validation, and packaging are delegated to replaceable adapters.
 * Each scene runs an acquire → build → validate → bounded-repair loop; accepted scene builds are
 * content-cached separately from the durable workflow state, so an interrupted project resumes from
 * its last checkpoint without rebuilding accepted scenes, and the package is verified before completion.
 */
export class GameDepartment implements DepartmentInstance {
  #ready = false;

  constructor(private readonly deps: GameDepartmentDeps) {}

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
      details: { department: "game-production" },
    });
  }

  async invoke(
    capabilityId: string,
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    if (!this.#ready) {
      throw new ApplicationError("CONFLICT", "Game department is not started.");
    }
    switch (capabilityId) {
      case "game.build_project":
        return this.#build(request, context);
      case "game.project_status":
        return this.#status(request);
      default:
        throw new ApplicationError("UNSUPPORTED_OPERATION", "Unknown game capability.", {
          details: { capabilityId },
        });
    }
  }

  async #build(
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const spec = parseGameProjectSpec(request);
    const prior = await this.deps.store.load(spec.projectId);
    const sceneRecords = new Map<string, SceneRecord>(
      (prior?.scenes ?? []).map((scene) => [scene.sceneId, scene]),
    );
    let record: ProjectRecord = { projectId: spec.projectId, status: "in_progress", scenes: [] };
    const accepted: BuiltScene[] = [];

    for (const sceneSpec of spec.scenes) {
      const existing = sceneRecords.get(sceneSpec.sceneId);
      const cached =
        existing?.status === "accepted" && existing.sceneRef !== undefined
          ? this.deps.cache.get(existing.sceneRef)
          : undefined;
      if (existing?.status === "accepted" && cached !== undefined) {
        accepted.push(cached); // resume: reuse cached accepted build, no rebuild
        sceneRecords.set(sceneSpec.sceneId, existing);
        continue;
      }
      const outcome = await this.#produceScene(sceneSpec, spec.maxAttemptsPerScene, context);
      sceneRecords.set(sceneSpec.sceneId, outcome.record);
      record = {
        projectId: spec.projectId,
        status: "in_progress",
        scenes: this.#order(spec, sceneRecords),
      };
      await this.deps.store.save(record); // checkpoint after every scene
      if (outcome.record.status !== "accepted" || outcome.scene === undefined) {
        record = { ...record, status: "failed" };
        await this.deps.store.save(record);
        return this.#receipt(record);
      }
      this.deps.cache.put(outcome.scene);
      accepted.push(outcome.scene);
    }

    record = {
      projectId: spec.projectId,
      status: "scenes_complete",
      scenes: this.#order(spec, sceneRecords),
    };
    await this.deps.store.save(record);

    const output = await this.deps.packaging.package(spec.projectId, accepted, context);
    const expected = contentHash({
      sceneRefs: accepted.map((scene) => scene.sceneRef),
      kind: "checksum",
    });
    if (output.checksum !== expected) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Packaged output failed verification.", {
        details: { projectId: spec.projectId },
      });
    }
    record = { ...record, status: "completed", packageRef: output.outputRef };
    await this.deps.store.save(record);
    return this.#receipt(record);
  }

  async #produceScene(
    sceneSpec: SceneSpec,
    maxAttempts: number,
    context: OperationContext,
  ): Promise<SceneOutcome> {
    const acquired: AcquiredAsset[] = [];
    for (const assetSpec of sceneSpec.assets) {
      acquired.push(await this.deps.assets.acquire(assetSpec, context));
    }
    let currentSpec = sceneSpec;
    let findings: readonly ValidationFinding[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const scene = await this.deps.build.build(currentSpec, acquired, attempt, context);
      const report = await this.deps.validation.validate(scene, currentSpec, context);
      if (report.passed) {
        return {
          record: {
            sceneId: sceneSpec.sceneId,
            status: "accepted",
            attempts: attempt,
            sceneRef: scene.sceneRef,
          },
          scene,
        };
      }
      findings = report.findings;
      currentSpec = this.#applyRepair(currentSpec);
    }
    return {
      record: { sceneId: sceneSpec.sceneId, status: "failed", attempts: maxAttempts, findings },
    };
  }

  /** Deterministic repair: drop the detected defect for the retry. */
  #applyRepair(spec: SceneSpec): SceneSpec {
    const { defect: _dropped, ...rest } = spec;
    return Object.freeze({ ...rest });
  }

  #order(spec: GameProjectSpec, records: Map<string, SceneRecord>): readonly SceneRecord[] {
    const ordered: SceneRecord[] = [];
    for (const sceneSpec of spec.scenes) {
      const record = records.get(sceneSpec.sceneId);
      if (record !== undefined) ordered.push(record);
    }
    return Object.freeze(ordered);
  }

  async #status(request: ApplicationJsonValue): Promise<ApplicationJsonValue> {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Status request must be an object.");
    }
    const projectId = (request as Record<string, ApplicationJsonValue>)["projectId"];
    if (typeof projectId !== "string") {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "projectId is required.");
    }
    const record = await this.deps.store.load(projectId);
    if (record === null) {
      throw new ApplicationError("NOT_FOUND", "Project not found.", { details: { projectId } });
    }
    return this.#receipt(record);
  }

  #receipt(record: ProjectRecord): ApplicationJsonValue {
    return {
      projectId: record.projectId,
      status: record.status,
      packageRef: record.packageRef ?? null,
      scenes: record.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        status: scene.status,
        attempts: scene.attempts,
        sceneRef: scene.sceneRef ?? null,
      })),
    };
  }
}

/** Deterministic reference dependencies (no external engines/tools), for verification and demos. */
export function referenceGameDeps(): GameDepartmentDeps {
  return {
    assets: new ReferenceAssetAdapter(),
    build: new ReferenceSceneBuildAdapter(),
    validation: new ReferenceSceneValidationAdapter(),
    packaging: new ReferencePackageAdapter(),
    store: new InMemoryProjectStore(),
    cache: new InMemorySceneCache(),
  };
}

/** A host connector that binds the Game department in-process with the given dependencies. */
export function createGameConnector(deps: GameDepartmentDeps): DepartmentConnector {
  return { connect: async () => new GameDepartment(deps) };
}

export const gameManifest: DepartmentManifest = Object.freeze({
  departmentId: "game-production",
  displayName: "3D and Game Production",
  version: "0.1.0",
  hostApiVersion: "1.0.0",
  capabilities: ["game.build_project", "game.project_status"],
  requiredToolIds: [],
  optionalToolIds: ["godot", "unreal", "blender"],
  requiredModelIds: [],
  permissions: ["workspace.write", "cache.write"],
  workspacePath: "departments/game-production",
});
