import {
  type AcquiredAsset,
  type AssetAdapter,
  type AssetSpec,
  type BuiltScene,
  contentHash,
  type PackageAdapter,
  type PackageOutput,
  type ProjectRecord,
  type ProjectStore,
  type SceneBuildAdapter,
  type SceneCache,
  type SceneSpec,
  type SceneValidationAdapter,
  type ValidationReport,
} from "./contracts.js";

/** Deterministic reference asset acquisition — a stable ref per asset spec, no real pipeline. */
export class ReferenceAssetAdapter implements AssetAdapter {
  public acquireCalls = 0;
  async acquire(spec: AssetSpec): Promise<AcquiredAsset> {
    this.acquireCalls += 1;
    return Object.freeze({ assetId: spec.assetId, ref: contentHash({ spec, kind: "asset" }) });
  }
}

/** Deterministic reference scene build — a stable sceneRef over the (corrected) spec and asset refs. */
export class ReferenceSceneBuildAdapter implements SceneBuildAdapter {
  public buildCalls = 0;
  async build(
    spec: SceneSpec,
    assets: readonly AcquiredAsset[],
    attempt: number,
  ): Promise<BuiltScene> {
    this.buildCalls += 1;
    const assetRefs = assets.map((asset) => asset.ref);
    return Object.freeze({
      sceneId: spec.sceneId,
      attempt,
      sceneRef: contentHash({ spec, assetRefs, kind: "scene" }),
      assetRefs: Object.freeze(assetRefs),
    });
  }
}

/** Deterministic reference validation: a scene fails while its spec still carries a `defect`. */
export class ReferenceSceneValidationAdapter implements SceneValidationAdapter {
  async validate(_scene: BuiltScene, spec: SceneSpec): Promise<ValidationReport> {
    if (spec.defect !== undefined) {
      return Object.freeze({
        passed: false,
        findings: Object.freeze([{ kind: "validation", detail: spec.defect }]),
      });
    }
    return Object.freeze({ passed: true, findings: Object.freeze([]) });
  }
}

/** Deterministic reference packaging: a stable package ref and checksum over the built scenes. */
export class ReferencePackageAdapter implements PackageAdapter {
  public packageCalls = 0;
  async package(projectId: string, scenes: readonly BuiltScene[]): Promise<PackageOutput> {
    this.packageCalls += 1;
    const sceneRefs = scenes.map((scene) => scene.sceneRef);
    return Object.freeze({
      outputRef: contentHash({ projectId, sceneRefs, kind: "package" }),
      checksum: contentHash({ sceneRefs, kind: "checksum" }),
      sceneRefs: Object.freeze(sceneRefs),
    });
  }
}

export class InMemoryProjectStore implements ProjectStore {
  readonly #records = new Map<string, ProjectRecord>();
  async load(projectId: string): Promise<ProjectRecord | null> {
    return this.#records.get(projectId) ?? null;
  }
  async save(record: ProjectRecord): Promise<void> {
    this.#records.set(record.projectId, JSON.parse(JSON.stringify(record)) as ProjectRecord);
  }
}

export class InMemorySceneCache implements SceneCache {
  readonly #scenes = new Map<string, BuiltScene>();
  get(sceneRef: string): BuiltScene | undefined {
    return this.#scenes.get(sceneRef);
  }
  put(scene: BuiltScene): void {
    this.#scenes.set(scene.sceneRef, scene);
  }
}
