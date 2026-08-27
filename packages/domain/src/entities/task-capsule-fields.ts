import { assertDomain } from "../domain-errors.js";
import { ContentHash } from "../value-objects/content-hash.js";
import { isCanonicalDurableId } from "../value-objects/ids.js";

/**
 * The bounded field vocabulary every Task Capsule revision is built from.
 *
 * Split out of `task-capsule.ts` to stay under the mandatory source-size limit. The seam is the
 * entity's own: these are the phase vocabulary, the capacity ceilings, and the primitives that
 * enforce them. They decide whether one *field* is admissible; the entity decides whether a whole
 * *revision* is. Every refusal is `INVALID_TASK_CAPSULE`, and none of them touches the
 * fingerprint — so what a capsule hashes over is unchanged by where these live.
 */

/** The seven phases a task may occupy. The vocabulary is closed; there is no other phase. */
export type TaskPhase =
  | "investigate"
  | "plan"
  | "execute"
  | "verify"
  | "repair"
  | "blocked"
  | "complete";

/** The seven approved phases, as a membership set for the entity's own phase check. */
export const PHASES: ReadonlySet<string> = new Set<TaskPhase>([
  "investigate",
  "plan",
  "execute",
  "verify",
  "repair",
  "blocked",
  "complete",
]);

export const TASK_CAPSULE_LIMITS = Object.freeze({
  maxDagNodes: 64,
  maxDependenciesPerNode: 16,
  maxTotalDependencies: 256,
  maxHypotheses: 16,
  maxRisks: 16,
  maxPlanSteps: 32,
  maxConstraints: 32,
  maxAcceptanceCriteria: 64,
  maxEvidenceReferences: 128,
  maxDecisionReferences: 64,
  maxCheckpointReferences: 64,
  maxArtifactReferences: 64,
  maxLedgerReferences: 256,
  maxActiveFingerprints: 32,
  maxTextLength: 2_000,
  maxAttemptCeiling: 100,
});

export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function fail(
  message: string,
  details: Readonly<Record<string, string | number>> = {},
): never {
  assertDomain(false, "INVALID_TASK_CAPSULE", message, details);
}

export function text(value: string, label: string, allowEmpty = false): string {
  assertDomain(
    typeof value === "string" &&
      value === value.trim() &&
      (allowEmpty || value.length > 0) &&
      value.length <= TASK_CAPSULE_LIMITS.maxTextLength,
    "INVALID_TASK_CAPSULE",
    `${label} must be canonical text of at most ${TASK_CAPSULE_LIMITS.maxTextLength} characters.`,
    { label },
  );
  return value;
}

export function boundedTexts(
  values: readonly string[],
  label: string,
  limit: number,
): readonly string[] {
  assertDomain(
    Array.isArray(values) && values.length <= limit,
    "INVALID_TASK_CAPSULE",
    `${label} may hold at most ${limit} entries.`,
    { label, count: Array.isArray(values) ? values.length : -1 },
  );
  return Object.freeze(values.map((value) => text(value, label)));
}

export function boundedIds<T>(
  values: readonly string[],
  label: string,
  limit: number,
  parse: (value: string) => T,
): readonly T[] {
  assertDomain(
    Array.isArray(values) && values.length <= limit,
    "INVALID_TASK_CAPSULE",
    `${label} may hold at most ${limit} entries.`,
    { label, count: Array.isArray(values) ? values.length : -1 },
  );
  const parsed = values.map((value) => parse(value));
  assertDomain(
    new Set(parsed).size === parsed.length,
    "INVALID_TASK_CAPSULE",
    `${label} must be unique.`,
    { label },
  );
  return Object.freeze(parsed);
}

export function integerWithin(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  assertDomain(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "INVALID_TASK_CAPSULE",
    `${label} must be an integer between ${minimum} and ${maximum}.`,
    { label, value: String(value) },
  );
  return value;
}

export function optionalId<T>(
  value: string | null | undefined,
  parse: (raw: string) => T,
): T | null {
  return value === undefined || value === null ? null : parse(value);
}

export function buildActiveFingerprints(
  input: Readonly<Record<string, string>>,
): Readonly<Record<string, ContentHash>> {
  const keys = Object.keys(input);
  assertDomain(
    keys.length <= TASK_CAPSULE_LIMITS.maxActiveFingerprints,
    "INVALID_TASK_CAPSULE",
    `A capsule may hold at most ${TASK_CAPSULE_LIMITS.maxActiveFingerprints} active fingerprints.`,
    { count: keys.length },
  );
  const entries: Record<string, ContentHash> = {};
  for (const key of keys.sort()) {
    assertDomain(
      isCanonicalDurableId(key),
      "INVALID_TASK_CAPSULE",
      "An active fingerprint name must use canonical durable-ID syntax.",
      { key },
    );
    entries[key] = ContentHash.parse(input[key] as string);
  }
  return Object.freeze(entries);
}
