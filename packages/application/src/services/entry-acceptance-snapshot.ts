import {
  type CanonicalValue,
  type ContentHash,
  canonicalFingerprint,
  type EvidenceKind,
  type TaskCapsule,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";

/**
 * The Entry Acceptance Snapshot: the verification contract for one bounded task, frozen and
 * fingerprinted before significant Executor work begins.
 *
 * It exists because "what counts as done" must be settled *before* anyone sees the implementation.
 * Without it, an Executor can quietly narrow success to whatever it managed to build and an Auditor
 * can widen it to whatever it was shown — and both would look like agreement.
 *
 * This is additive over existing authority, not a second task-state system. Every field that says
 * what the task *is* is read from the authoritative Task Capsule revision and never from a caller:
 * the objective, the acceptance criteria, the constraints, and the forbidden changes. What a caller
 * supplies is only what the capsule cannot express — which deterministic checks this class of task
 * requires, which evidence kinds must back it, which risk policies apply, and the identity of the
 * workspace the work happens in.
 *
 * Everything here is pure: no clock, no randomness, no I/O. The freeze time is an input.
 */
export interface EntryAcceptanceSnapshot {
  /**
   * Nominal marker. A structurally similar object assembled by a caller is not a frozen contract,
   * and this makes that difference visible at the type level as well as at runtime.
   */
  readonly snapshotKind: "entry_acceptance_snapshot";
  readonly taskId: string;
  readonly capsuleRevision: number;
  readonly capsuleFingerprint: ContentHash;
  readonly objective: string;
  readonly acceptanceCriterionIds: readonly string[];
  /** Deterministic checks that must pass. Canonically ordered and de-duplicated. */
  readonly requiredChecks: readonly string[];
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly constraints: readonly string[];
  readonly forbiddenChanges: readonly string[];
  readonly riskPolicyIds: readonly string[];
  readonly workspaceId: string | null;
  readonly workspaceFingerprint: ContentHash | null;
  readonly frozenAt: string;
  readonly contractFingerprint: ContentHash;
}

export interface EntryAcceptanceInput {
  /** The authoritative revision the contract is compiled from. */
  readonly capsule: TaskCapsule;
  readonly requiredChecks: readonly string[];
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly riskPolicyIds: readonly string[];
  readonly workspaceFingerprint: ContentHash | null;
  readonly frozenAt: string;
}

export const ACCEPTANCE_LIMITS = Object.freeze({
  maxRequiredChecks: 64,
  maxRequiredEvidenceKinds: 32,
  maxRiskPolicyIds: 32,
});

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function invalid(message: string, details: Record<string, string | number> = {}): ApplicationError {
  return new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}

/**
 * Sorted and de-duplicated, so two callers that declare the same requirement in a different order
 * produce the same contract fingerprint. Order is not part of what a contract means.
 */
function canonicalSet(values: readonly string[], limit: number, label: string): readonly string[] {
  const unique = [...new Set(values)].sort();
  if (unique.length > limit) {
    throw invalid(`An acceptance contract may declare at most ${limit} ${label}.`, {
      count: unique.length,
    });
  }
  for (const value of unique) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
      throw invalid(`Every ${label} entry must be bounded non-empty text.`);
    }
  }
  return Object.freeze(unique);
}

/** The part of the contract the fingerprint covers: everything except the fingerprint itself. */
function contractPayload(snapshot: Omit<EntryAcceptanceSnapshot, "contractFingerprint">) {
  return {
    snapshotKind: snapshot.snapshotKind,
    taskId: snapshot.taskId,
    capsuleRevision: snapshot.capsuleRevision,
    capsuleFingerprint: snapshot.capsuleFingerprint,
    objective: snapshot.objective,
    acceptanceCriterionIds: [...snapshot.acceptanceCriterionIds],
    requiredChecks: [...snapshot.requiredChecks],
    requiredEvidenceKinds: [...snapshot.requiredEvidenceKinds],
    constraints: [...snapshot.constraints],
    forbiddenChanges: [...snapshot.forbiddenChanges],
    riskPolicyIds: [...snapshot.riskPolicyIds],
    workspaceId: snapshot.workspaceId,
    workspaceFingerprint: snapshot.workspaceFingerprint,
    frozenAt: snapshot.frozenAt,
  } as unknown as CanonicalValue;
}

export function freezeEntryAcceptanceSnapshot(
  input: EntryAcceptanceInput,
): EntryAcceptanceSnapshot {
  const { capsule } = input;
  if (typeof input.frozenAt !== "string" || !ISO_PATTERN.test(input.frozenAt)) {
    throw invalid("An acceptance contract must be frozen at a canonical UTC timestamp.");
  }
  const state = {
    snapshotKind: "entry_acceptance_snapshot" as const,
    taskId: capsule.taskId,
    capsuleRevision: capsule.capsuleRevision,
    capsuleFingerprint: capsule.fingerprint,
    // From the capsule, never from the caller: these are what the task already is.
    objective: capsule.objective,
    acceptanceCriterionIds: Object.freeze([...capsule.acceptanceCriterionIds]),
    requiredChecks: canonicalSet(
      input.requiredChecks,
      ACCEPTANCE_LIMITS.maxRequiredChecks,
      "required checks",
    ),
    requiredEvidenceKinds: canonicalSet(
      input.requiredEvidenceKinds,
      ACCEPTANCE_LIMITS.maxRequiredEvidenceKinds,
      "required evidence kinds",
    ) as readonly EvidenceKind[],
    constraints: Object.freeze([...capsule.constraints]),
    forbiddenChanges: Object.freeze([...capsule.forbiddenChanges]),
    riskPolicyIds: canonicalSet(
      input.riskPolicyIds,
      ACCEPTANCE_LIMITS.maxRiskPolicyIds,
      "risk policies",
    ),
    workspaceId: capsule.workspaceId,
    workspaceFingerprint: input.workspaceFingerprint,
    frozenAt: input.frozenAt,
  };
  return Object.freeze({
    ...state,
    contractFingerprint: canonicalFingerprint(contractPayload(state)),
  });
}

/**
 * Proves a snapshot is the exact contract a role was dispatched against.
 *
 * Roles carry the fingerprint, not the object, precisely so this check has something to compare
 * against after a restart or across a process boundary.
 */
export function assertEntryAcceptanceContract(
  snapshot: EntryAcceptanceSnapshot,
  expectedFingerprint: ContentHash,
): void {
  if (snapshot.contractFingerprint !== expectedFingerprint) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "The acceptance contract does not match the one this role was dispatched against.",
      {
        details: {
          taskId: snapshot.taskId,
          expected: expectedFingerprint,
          observed: snapshot.contractFingerprint,
        },
      },
    );
  }
}

function missingFrom(
  label: string,
  frozen: readonly string[],
  proposed: readonly string[],
): readonly string[] {
  const present = new Set(proposed);
  return frozen.filter((value) => !present.has(value)).map((value) => `${label}: ${value}`);
}

/**
 * Every way a later contract is weaker than the frozen one.
 *
 * A recompiled contract may be *stronger* — more checks, more evidence, more prohibitions — because
 * raising the bar after the fact harms nobody. Dropping any requirement, changing what the task was
 * about, or rebinding the workspace the promise was made in is redefinition of success and is
 * reported here so a caller can refuse it. An empty result means nothing was given up.
 */
export function detectAcceptanceWeakening(
  frozen: EntryAcceptanceSnapshot,
  proposed: EntryAcceptanceSnapshot,
): readonly string[] {
  const weakened: string[] = [];
  if (frozen.taskId !== proposed.taskId) weakened.push("taskId");
  if (frozen.objective !== proposed.objective) weakened.push("objective");
  // Workspace identity is part of the contract: the work was promised in *this* workspace.
  // Rebinding it points the same acceptance criteria at a different tree, which is a weaker
  // claim wearing the original's fingerprint. Its *contents* legitimately change as work
  // happens, so only losing the binding entirely counts.
  if (frozen.workspaceId !== proposed.workspaceId) weakened.push("workspaceId");
  if (frozen.workspaceFingerprint !== null && proposed.workspaceFingerprint === null) {
    weakened.push("workspaceFingerprint: the frozen workspace state was unbound");
  }
  weakened.push(
    ...missingFrom(
      "acceptanceCriterionIds",
      frozen.acceptanceCriterionIds,
      proposed.acceptanceCriterionIds,
    ),
    ...missingFrom("requiredChecks", frozen.requiredChecks, proposed.requiredChecks),
    ...missingFrom(
      "requiredEvidenceKinds",
      frozen.requiredEvidenceKinds,
      proposed.requiredEvidenceKinds,
    ),
    ...missingFrom("constraints", frozen.constraints, proposed.constraints),
    ...missingFrom("forbiddenChanges", frozen.forbiddenChanges, proposed.forbiddenChanges),
    ...missingFrom("riskPolicyIds", frozen.riskPolicyIds, proposed.riskPolicyIds),
  );
  return Object.freeze(weakened);
}
