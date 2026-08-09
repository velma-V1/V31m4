import { createHash } from "node:crypto";
import type { OperationContext } from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";

export type AssetKind = "mesh" | "texture" | "audio" | "script";

export interface AssetSpec {
  readonly assetId: string;
  readonly kind: AssetKind;
  readonly source: string;
}

export type SceneEngine = "godot" | "unreal" | "reference";

export interface SceneSpec {
  readonly sceneId: string;
  readonly engine: SceneEngine;
  readonly assets: readonly AssetSpec[];
  readonly defect?: string;
}

export interface GameProjectSpec {
  readonly projectId: string;
  readonly scenes: readonly SceneSpec[];
  readonly maxAttemptsPerScene: number;
}

export interface AcquiredAsset {
  readonly assetId: string;
  readonly ref: string;
}

export interface BuiltScene {
  readonly sceneId: string;
  readonly attempt: number;
  readonly sceneRef: string;
  readonly assetRefs: readonly string[];
}

export interface ValidationFinding {
  readonly kind: string;
  readonly detail: string;
}

export interface ValidationReport {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

export interface PackageOutput {
  readonly outputRef: string;
  readonly checksum: string;
  readonly sceneRefs: readonly string[];
}

/**
 * Replaceable game execution/tool boundaries. Production wiring keeps V31M4 orchestration,
 * verification, evidence, policy, and acceptance on this side of the boundary while real engine
 * work is delegated through replaceable adapters. The approved primary real path is Summer behind
 * these existing interfaces (Summer MCP/CLI -> Summer Engine/Godot); deterministic reference
 * adapters remain the CI/unit default. Direct Blender/Unreal/custom-Godot agent stacks are not the
 * current primary integration path.
 */
export interface AssetAdapter {
  acquire(spec: AssetSpec, context: OperationContext): Promise<AcquiredAsset>;
}
export interface SceneBuildAdapter {
  build(
    spec: SceneSpec,
    assets: readonly AcquiredAsset[],
    attempt: number,
    context: OperationContext,
  ): Promise<BuiltScene>;
}
export interface SceneValidationAdapter {
  validate(
    scene: BuiltScene,
    spec: SceneSpec,
    context: OperationContext,
  ): Promise<ValidationReport>;
}
export interface PackageAdapter {
  package(
    projectId: string,
    scenes: readonly BuiltScene[],
    context: OperationContext,
  ): Promise<PackageOutput>;
}

export type SceneStatus = "pending" | "accepted" | "failed";

export interface SceneRecord {
  readonly sceneId: string;
  readonly status: SceneStatus;
  readonly attempts: number;
  readonly sceneRef?: string;
  readonly findings?: readonly ValidationFinding[];
}

export type ProjectStatus = "in_progress" | "scenes_complete" | "completed" | "failed";

export interface ProjectRecord {
  readonly projectId: string;
  readonly status: ProjectStatus;
  readonly scenes: readonly SceneRecord[];
  readonly packageRef?: string;
}

/** Durable workflow state — the checkpoint/resume authority (project storage). */
export interface ProjectStore {
  load(projectId: string): Promise<ProjectRecord | null>;
  save(record: ProjectRecord): Promise<void>;
}

/** Content-addressed built-scene cache, kept separate from workflow state (asset/build cache). */
export interface SceneCache {
  get(sceneRef: string): BuiltScene | undefined;
  put(scene: BuiltScene): void;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

/** Stable content hash for scene/asset references and package checksums. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const KINDS = new Set<AssetKind>(["mesh", "texture", "audio", "script"]);
const ENGINES = new Set<SceneEngine>(["godot", "unreal", "reference"]);

function invalid(message: string, details: Record<string, unknown>): never {
  throw new ApplicationError("INVALID_APPLICATION_INPUT", message, {
    details: details as Record<string, never>,
  });
}

/** Validates a build-project request payload into a `GameProjectSpec`, failing closed on bad input. */
export function parseGameProjectSpec(raw: unknown): GameProjectSpec {
  if (raw === null || typeof raw !== "object") invalid("Project spec must be an object.", {});
  const object = raw as Record<string, unknown>;
  const projectId = object["projectId"];
  if (typeof projectId !== "string" || !ID.test(projectId)) {
    invalid("projectId must be a durable id.", { projectId });
  }
  const maxAttempts = object["maxAttemptsPerScene"];
  if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    invalid("maxAttemptsPerScene must be a positive integer.", { maxAttempts });
  }
  const rawScenes = object["scenes"];
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    invalid("A project must contain at least one scene.", {});
  }
  const seenScenes = new Set<string>();
  const scenes = rawScenes.map((entry, index): SceneSpec => {
    if (entry === null || typeof entry !== "object")
      invalid(`scenes[${index}] must be an object.`, {});
    const scene = entry as Record<string, unknown>;
    const sceneId = scene["sceneId"];
    if (typeof sceneId !== "string" || !ID.test(sceneId))
      invalid(`scenes[${index}].sceneId invalid.`, {});
    if (seenScenes.has(sceneId)) invalid(`Duplicate sceneId '${sceneId}'.`, {});
    seenScenes.add(sceneId);
    const engine = scene["engine"];
    if (typeof engine !== "string" || !ENGINES.has(engine as SceneEngine)) {
      invalid(`scenes[${index}].engine invalid.`, {});
    }
    const rawAssets = scene["assets"];
    if (!Array.isArray(rawAssets)) invalid(`scenes[${index}].assets must be an array.`, {});
    const seenAssets = new Set<string>();
    const assets = rawAssets.map((assetEntry, assetIndex): AssetSpec => {
      if (assetEntry === null || typeof assetEntry !== "object") {
        invalid(`scenes[${index}].assets[${assetIndex}] must be an object.`, {});
      }
      const asset = assetEntry as Record<string, unknown>;
      const assetId = asset["assetId"];
      if (typeof assetId !== "string" || !ID.test(assetId)) {
        invalid(`scenes[${index}].assets[${assetIndex}].assetId invalid.`, {});
      }
      if (seenAssets.has(assetId)) invalid(`Duplicate assetId '${assetId}'.`, {});
      seenAssets.add(assetId);
      const kind = asset["kind"];
      if (typeof kind !== "string" || !KINDS.has(kind as AssetKind)) {
        invalid(`scenes[${index}].assets[${assetIndex}].kind invalid.`, {});
      }
      const source = asset["source"];
      if (typeof source !== "string" || source.length === 0) {
        invalid(`scenes[${index}].assets[${assetIndex}].source invalid.`, {});
      }
      return Object.freeze({ assetId, kind: kind as AssetKind, source });
    });
    const defect = scene["defect"];
    return Object.freeze({
      sceneId,
      engine: engine as SceneEngine,
      assets: Object.freeze(assets),
      ...(typeof defect === "string" ? { defect } : {}),
    });
  });
  return Object.freeze({
    projectId,
    scenes: Object.freeze(scenes),
    maxAttemptsPerScene: maxAttempts,
  });
}
