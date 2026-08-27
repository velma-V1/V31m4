import { assertDomain } from "../domain-errors.js";
import {
  type CanonicalValue,
  canonicalFingerprint,
} from "../value-objects/canonical-fingerprint.js";
import { ContentHash } from "../value-objects/content-hash.js";
import {
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  isCanonicalDurableId,
  JobId,
  type JobId as JobIdType,
  LedgerEntryId,
  type LedgerEntryId as LedgerEntryIdType,
  SandboxId,
  type SandboxId as SandboxIdType,
  TaskId,
  type TaskId as TaskIdType,
} from "../value-objects/ids.js";

/**
 * The Execution Ledger records what actually happened in the environment, separately from what
 * a task intended.
 *
 * Entries are immutable and append-only. A mistake is never edited away: it is superseded by a
 * later entry — an `invalidation`, a `failure`, or a `reconciliation_indeterminate`. The kinds
 * are a closed set and the shapes are discriminated, so an outcome entry structurally cannot
 * exist without naming the attempt it resolves.
 *
 * Nothing here consults a model. Deciding what happened is deterministic runtime bookkeeping.
 */
export const LEDGER_ENTRY_KINDS = Object.freeze([
  "observation",
  "check_result",
  "effect_attempt",
  "effect_confirmation",
  "effect_nonapplication",
  "invalidation",
  "failure",
  "reconciliation_indeterminate",
] as const);

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

const KINDS: ReadonlySet<string> = new Set<string>(LEDGER_ENTRY_KINDS);

export const LEDGER_LIMITS = Object.freeze({
  maxFacts: 64,
  maxDependencies: 64,
  maxInvalidations: 64,
  maxEvidenceReferences: 64,
  maxTextLength: 2_000,
  maxLocatorLength: 1_024,
});

/** One observed resource and the fingerprint it carried when observed. */
export interface LedgerResourceFact {
  readonly resourceKind: string;
  readonly locator: string;
  readonly fingerprint: ContentHash;
}

interface LedgerEntryCommon {
  readonly id: LedgerEntryIdType;
  readonly taskId: TaskIdType;
  readonly jobId: JobIdType;
  readonly recordedAt: string;
  readonly detail: string;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly fingerprint: ContentHash;
}

export type ExecutionLedgerEntry =
  | (LedgerEntryCommon & {
      readonly kind: "observation";
      readonly facts: readonly LedgerResourceFact[];
    })
  | (LedgerEntryCommon & {
      readonly kind: "check_result";
      readonly checkName: string;
      readonly passed: boolean;
      readonly facts: readonly LedgerResourceFact[];
      /** Observations this check's validity depends on. */
      readonly dependsOnEntryIds: readonly LedgerEntryIdType[];
    })
  | (LedgerEntryCommon & {
      readonly kind: "effect_attempt";
      readonly intentFingerprint: ContentHash;
      readonly operationId: string;
      readonly workspaceId: string;
      readonly sandboxId: SandboxIdType | null;
    })
  | (LedgerEntryCommon & {
      readonly kind: "effect_confirmation";
      readonly attemptEntryId: LedgerEntryIdType;
      readonly facts: readonly LedgerResourceFact[];
    })
  | (LedgerEntryCommon & {
      readonly kind: "effect_nonapplication";
      readonly attemptEntryId: LedgerEntryIdType;
      readonly facts: readonly LedgerResourceFact[];
    })
  | (LedgerEntryCommon & {
      readonly kind: "reconciliation_indeterminate";
      readonly attemptEntryId: LedgerEntryIdType;
      readonly facts: readonly LedgerResourceFact[];
    })
  | (LedgerEntryCommon & {
      readonly kind: "invalidation";
      readonly invalidatesEntryIds: readonly LedgerEntryIdType[];
      readonly reason: string;
    })
  | (LedgerEntryCommon & {
      readonly kind: "failure";
      readonly attemptEntryId: LedgerEntryIdType | null;
      readonly reason: string;
    });

/** The semantic identity of an effect: what it would do, independent of which try this is. */
export interface EffectIntent {
  readonly taskId: string;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly command: { readonly executable: string; readonly arguments: readonly string[] } | null;
  readonly parameters: CanonicalValue;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * `Omit` collapses a union to its shared keys, which would erase every kind-specific field. This
 * distributes across the union so each variant keeps its own shape while losing the fingerprint
 * that is about to be computed over it.
 */
type UnfingerprintedEntry = ExecutionLedgerEntry extends infer Variant
  ? Variant extends ExecutionLedgerEntry
    ? Omit<Variant, "fingerprint">
    : never
  : never;

function text(value: unknown, label: string, max: number = LEDGER_LIMITS.maxTextLength): string {
  assertDomain(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "INVALID_LEDGER_ENTRY",
    `${label} must be non-empty text of at most ${max} characters.`,
    { label },
  );
  return value as string;
}

function facts(input: unknown, label: string, minimum: number): readonly LedgerResourceFact[] {
  assertDomain(
    Array.isArray(input) && input.length >= minimum && input.length <= LEDGER_LIMITS.maxFacts,
    "INVALID_LEDGER_ENTRY",
    `${label} requires between ${minimum} and ${LEDGER_LIMITS.maxFacts} resource facts.`,
    { label, count: Array.isArray(input) ? input.length : -1 },
  );
  return Object.freeze(
    (input as readonly LedgerResourceFact[]).map((fact) =>
      Object.freeze({
        resourceKind: text(fact.resourceKind, "resourceKind", 128),
        locator: text(fact.locator, "locator", LEDGER_LIMITS.maxLocatorLength),
        fingerprint: ContentHash.parse(fact.fingerprint as unknown as string),
      }),
    ),
  );
}

function ledgerIds(input: unknown, label: string, minimum: number, limit: number) {
  assertDomain(
    Array.isArray(input) && input.length >= minimum && input.length <= limit,
    "INVALID_LEDGER_ENTRY",
    `${label} requires between ${minimum} and ${limit} entries.`,
    { label, count: Array.isArray(input) ? input.length : -1 },
  );
  const parsed = (input as readonly string[]).map((id) => LedgerEntryId.parse(id));
  assertDomain(
    new Set(parsed).size === parsed.length,
    "INVALID_LEDGER_ENTRY",
    `${label} must be unique.`,
    { label },
  );
  return Object.freeze(parsed);
}

/** The part of an entry the fingerprint covers: everything except the fingerprint itself. */
function payload(entry: UnfingerprintedEntry): CanonicalValue {
  const { fingerprint: _ignored, ...rest } = entry as ExecutionLedgerEntry & {
    readonly fingerprint?: unknown;
  };
  return rest as unknown as CanonicalValue;
}

/**
 * One exhaustive validator per kind, kept together on purpose: the closed-set guarantee is only
 * legible if every shape rule sits in one place.
 */
function build(input: Record<string, unknown>): UnfingerprintedEntry {
  const kind = input["kind"];
  assertDomain(
    typeof kind === "string" && KINDS.has(kind),
    "INVALID_LEDGER_ENTRY",
    "Ledger entry kind is not one of the canonical kinds.",
    { kind: String(kind) },
  );
  assertDomain(
    typeof input["recordedAt"] === "string" &&
      ISO_PATTERN.test(input["recordedAt"]) &&
      new Date(Date.parse(input["recordedAt"])).toISOString() === input["recordedAt"],
    "INVALID_LEDGER_ENTRY",
    "Ledger entry time must be canonical UTC ISO-8601 with milliseconds.",
  );

  const evidenceRaw = (input["evidenceIds"] ?? []) as readonly string[];
  assertDomain(
    Array.isArray(evidenceRaw) && evidenceRaw.length <= LEDGER_LIMITS.maxEvidenceReferences,
    "INVALID_LEDGER_ENTRY",
    `A ledger entry may cite at most ${LEDGER_LIMITS.maxEvidenceReferences} evidence records.`,
  );
  const common = {
    id: LedgerEntryId.parse(input["id"] as string),
    taskId: TaskId.parse(input["taskId"] as string),
    jobId: JobId.parse(input["jobId"] as string),
    recordedAt: input["recordedAt"] as string,
    detail: text(input["detail"], "detail"),
    evidenceIds: Object.freeze(evidenceRaw.map((id) => EvidenceId.parse(id))),
  };

  switch (kind as LedgerEntryKind) {
    case "observation":
      return { ...common, kind: "observation", facts: facts(input["facts"], "observation", 1) };
    case "check_result":
      return {
        ...common,
        kind: "check_result",
        checkName: text(input["checkName"], "checkName", 256),
        passed: assertBoolean(input["passed"], "passed"),
        facts: facts(input["facts"], "check_result", 1),
        dependsOnEntryIds: ledgerIds(
          input["dependsOnEntryIds"] ?? [],
          "dependsOnEntryIds",
          0,
          LEDGER_LIMITS.maxDependencies,
        ),
      };
    case "effect_attempt": {
      const workspaceId = input["workspaceId"];
      assertDomain(
        isCanonicalDurableId(workspaceId),
        "INVALID_LEDGER_ENTRY",
        "An effect attempt must name the workspace it acts on.",
        { workspaceId: String(workspaceId) },
      );
      return {
        ...common,
        kind: "effect_attempt",
        intentFingerprint: ContentHash.parse(input["intentFingerprint"] as string),
        operationId: text(input["operationId"], "operationId", 128),
        workspaceId: workspaceId as string,
        sandboxId:
          input["sandboxId"] === undefined || input["sandboxId"] === null
            ? null
            : SandboxId.parse(input["sandboxId"] as string),
      };
    }
    case "effect_confirmation":
      return {
        ...common,
        kind: "effect_confirmation",
        attemptEntryId: LedgerEntryId.parse(input["attemptEntryId"] as string),
        // Confirming application is a claim about observed reality, so it must carry the
        // observation that supports it.
        facts: facts(input["facts"], "effect_confirmation", 1),
      };
    case "effect_nonapplication":
      return {
        ...common,
        kind: "effect_nonapplication",
        attemptEntryId: LedgerEntryId.parse(input["attemptEntryId"] as string),
        // Denying application is equally a claim about observed reality.
        facts: facts(input["facts"], "effect_nonapplication", 1),
      };
    case "reconciliation_indeterminate":
      return {
        ...common,
        kind: "reconciliation_indeterminate",
        attemptEntryId: LedgerEntryId.parse(input["attemptEntryId"] as string),
        // Indeterminate means no fact could be obtained; requiring one would be contradictory.
        facts: facts(input["facts"] ?? [], "reconciliation_indeterminate", 0),
      };
    case "invalidation":
      return {
        ...common,
        kind: "invalidation",
        invalidatesEntryIds: ledgerIds(
          input["invalidatesEntryIds"],
          "invalidatesEntryIds",
          1,
          LEDGER_LIMITS.maxInvalidations,
        ),
        reason: text(input["reason"], "reason"),
      };
    default:
      return {
        ...common,
        kind: "failure",
        attemptEntryId:
          input["attemptEntryId"] === undefined || input["attemptEntryId"] === null
            ? null
            : LedgerEntryId.parse(input["attemptEntryId"] as string),
        reason: text(input["reason"], "reason"),
      };
  }
}

function assertBoolean(value: unknown, label: string): boolean {
  assertDomain(typeof value === "boolean", "INVALID_LEDGER_ENTRY", `${label} must be a boolean.`, {
    label,
  });
  return value as boolean;
}

export const ExecutionLedgerEntry = Object.freeze({
  create(input: Record<string, unknown>): ExecutionLedgerEntry {
    const state = build(input);
    return Object.freeze({
      ...state,
      fingerprint: canonicalFingerprint(payload(state)),
    }) as ExecutionLedgerEntry;
  },

  /**
   * The deterministic identity of an effect's *intent*. It deliberately excludes anything that
   * differs between tries — the capability nonce, the sandbox instance, the timestamp — so two
   * attempts at the same work share a fingerprint and a duplicate is detectable without a model.
   */
  intentFingerprint(intent: EffectIntent): ContentHash {
    return canonicalFingerprint({
      taskId: intent.taskId,
      operationId: intent.operationId,
      workspaceId: intent.workspaceId,
      command:
        intent.command === null
          ? null
          : {
              executable: intent.command.executable,
              arguments: [...intent.command.arguments],
            },
      parameters: intent.parameters,
    });
  },

  /** Rebuilds a persisted entry and proves storage did not alter it. */
  rehydrate(value: unknown): ExecutionLedgerEntry {
    assertDomain(
      typeof value === "object" && value !== null && !Array.isArray(value),
      "INVALID_LEDGER_ENTRY",
      "A persisted ledger entry must be a JSON object.",
    );
    const body = value as Record<string, unknown>;
    const rebuilt = ExecutionLedgerEntry.create(body);
    assertDomain(
      body["fingerprint"] === rebuilt.fingerprint,
      "INVALID_LEDGER_ENTRY",
      "The persisted ledger entry fingerprint does not match its content.",
      { id: String(body["id"]) },
    );
    return rebuilt;
  },
});
