import { createHash } from "node:crypto";
import { ApplicationError, type OperationContext } from "@v31m4/application";

/** One shot to produce. `defect`, when present, models a QC-detectable problem the correction loop repairs. */
export interface ShotSpec {
  readonly shotId: string;
  readonly prompt: string;
  readonly referenceId?: string;
  readonly qualityTier: "draft" | "standard" | "premium";
  readonly seed: number;
  readonly defect?: string;
}

export interface ProductionSpec {
  readonly productionId: string;
  readonly shots: readonly ShotSpec[];
  readonly maxAttemptsPerShot: number;
}

export interface GeneratedShot {
  readonly shotId: string;
  readonly attempt: number;
  readonly outputRef: string;
  readonly descriptor: string;
}

export interface QcFinding {
  readonly kind: string;
  readonly detail: string;
}

export interface QcReport {
  readonly passed: boolean;
  readonly findings: readonly QcFinding[];
}

export interface RenderOutput {
  readonly outputRef: string;
  readonly checksum: string;
  readonly shotRefs: readonly string[];
}

/**
 * Replaceable production-tool boundaries. Production wiring backs these with real generation
 * (e.g. ComfyUI / a video model), vision QC (a vision model), and assembly (ffmpeg/Blender);
 * this package also ships deterministic reference adapters so the orchestration is verifiable
 * without those executables present.
 */
export interface ShotGenerationAdapter {
  generate(spec: ShotSpec, attempt: number, context: OperationContext): Promise<GeneratedShot>;
}
export interface VisionQcAdapter {
  inspect(shot: GeneratedShot, spec: ShotSpec, context: OperationContext): Promise<QcReport>;
}
export interface AssemblyAdapter {
  assemble(
    productionId: string,
    shots: readonly GeneratedShot[],
    context: OperationContext,
  ): Promise<RenderOutput>;
}

export type ShotStatus = "pending" | "accepted" | "failed";

export interface ShotRecord {
  readonly shotId: string;
  readonly status: ShotStatus;
  readonly attempts: number;
  readonly outputRef?: string;
  readonly findings?: readonly QcFinding[];
}

export type ProductionStatus = "in_progress" | "shots_complete" | "completed" | "failed";

export interface ProductionRecord {
  readonly productionId: string;
  readonly status: ProductionStatus;
  readonly shots: readonly ShotRecord[];
  readonly finalOutputRef?: string;
}

/** Durable workflow state — the checkpoint/resume authority (project storage). */
export interface ProductionStore {
  load(productionId: string): Promise<ProductionRecord | null>;
  save(record: ProductionRecord): Promise<void>;
}

/** Content-addressed accepted-shot cache, kept separate from workflow state (cache storage). */
export interface ShotCache {
  get(outputRef: string): GeneratedShot | undefined;
  put(shot: GeneratedShot): void;
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

/** Stable content hash for a value (shot descriptors, output references, checksums). */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TIERS = new Set<ShotSpec["qualityTier"]>(["draft", "standard", "premium"]);

function invalid(message: string, details: Record<string, unknown>): never {
  throw new ApplicationError("INVALID_APPLICATION_INPUT", message, {
    details: details as Record<string, never>,
  });
}

/** Validates a production request payload into a `ProductionSpec`, failing closed on bad input. */
export function parseProductionSpec(raw: unknown): ProductionSpec {
  if (raw === null || typeof raw !== "object") invalid("Production spec must be an object.", {});
  const object = raw as Record<string, unknown>;
  const productionId = object["productionId"];
  if (typeof productionId !== "string" || !ID.test(productionId)) {
    invalid("productionId must be a durable id.", { productionId });
  }
  const maxAttempts = object["maxAttemptsPerShot"];
  if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    invalid("maxAttemptsPerShot must be a positive integer.", { maxAttempts });
  }
  const rawShots = object["shots"];
  if (!Array.isArray(rawShots) || rawShots.length === 0) {
    invalid("A production must contain at least one shot.", {});
  }
  const seen = new Set<string>();
  const shots = rawShots.map((entry, index): ShotSpec => {
    if (entry === null || typeof entry !== "object")
      invalid(`shots[${index}] must be an object.`, {});
    const shot = entry as Record<string, unknown>;
    const shotId = shot["shotId"];
    if (typeof shotId !== "string" || !ID.test(shotId))
      invalid(`shots[${index}].shotId invalid.`, {});
    if (seen.has(shotId)) invalid(`Duplicate shotId '${shotId}'.`, {});
    seen.add(shotId);
    const prompt = shot["prompt"];
    if (typeof prompt !== "string" || prompt.length === 0)
      invalid(`shots[${index}].prompt invalid.`, {});
    const qualityTier = shot["qualityTier"];
    if (typeof qualityTier !== "string" || !TIERS.has(qualityTier as ShotSpec["qualityTier"])) {
      invalid(`shots[${index}].qualityTier invalid.`, {});
    }
    const seed = shot["seed"];
    if (typeof seed !== "number" || !Number.isInteger(seed))
      invalid(`shots[${index}].seed invalid.`, {});
    const referenceId = shot["referenceId"];
    const defect = shot["defect"];
    return Object.freeze({
      shotId,
      prompt,
      qualityTier: qualityTier as ShotSpec["qualityTier"],
      seed,
      ...(typeof referenceId === "string" ? { referenceId } : {}),
      ...(typeof defect === "string" ? { defect } : {}),
    });
  });
  return Object.freeze({
    productionId,
    shots: Object.freeze(shots),
    maxAttemptsPerShot: maxAttempts,
  });
}
