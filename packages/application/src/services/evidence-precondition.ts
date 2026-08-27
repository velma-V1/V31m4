import type { EvidenceKind, EvidenceRecord, ExecutionLedgerEntry, TaskId } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import {
  isEntryStillValid,
  type LedgerProjection,
} from "../use-cases/reconcile-execution-effect.js";

/**
 * Evidence-conditioned effects: the deterministic predicate a consequential operation must satisfy
 * before it may touch anything.
 *
 * The point is not that facts exist somewhere. It is that the facts justifying *this* effect exist
 * **and are still current**. An impact analysis computed before the file moved is not an answer,
 * and a check whose premise was invalidated is not a pass — so currency is decided by the canonical
 * `isEntryStillValid` rule rather than by a second staleness notion invented here.
 *
 * Both sources are ones V31M4 already treats as authoritative: immutable `EvidenceRecord` facts,
 * with their own kind/subject/status semantics, and valid Ledger observations and check results.
 * There is deliberately no parallel free-form evidence taxonomy — a requirement can only name what
 * those two systems already express.
 *
 * A denial is a product, not an exception to be summarised. It names every requirement that is not
 * met, because an agent that is told "denied" cannot act, while one told "the impact analysis for
 * src/target.ts is stale" can go and refresh it. Nothing here blocks the read path that produces
 * those facts: an empty requirement set is satisfied.
 *
 * Pure: no clock, no randomness, no I/O.
 */
export type PreconditionRequirement =
  | Readonly<{
      kind: "evidence";
      allowedEvidenceKinds: readonly EvidenceKind[];
      subjectType: string;
      requirePassed: true;
    }>
  | Readonly<{
      kind: "ledger_observation";
      resourceKind: string;
      requireCurrentFingerprint: true;
    }>;

export interface EvidencePreconditionPolicy {
  readonly policyId: string;
  readonly requirements: readonly PreconditionRequirement[];
}

/** Everything the predicate reads. All of it is authoritative state, none of it is a model claim. */
export interface EvidencePreconditionState {
  readonly taskId: TaskId;
  /** This task's Ledger history in append order. */
  readonly history: readonly ExecutionLedgerEntry[];
  readonly projection: LedgerProjection;
  /** Evidence records this task owns, already resolved from the authoritative store. */
  readonly evidence: readonly EvidenceRecord[];
  /**
   * Current fingerprints of observed resources. A locator that is absent is *not* current: the
   * rule fails closed, so an unobserved world denies rather than silently satisfies.
   */
  readonly currentFingerprints: Readonly<Record<string, string>>;
}

export type MissingRequirement = Readonly<{
  requirement: PreconditionRequirement;
  /** Why the requirement is unmet, in terms an agent can act on. */
  reason: string;
}>;

export type EvidencePreconditionVerdict =
  | Readonly<{ kind: "satisfied"; policyId: string; satisfiedBy: readonly string[] }>
  | Readonly<{ kind: "unsatisfied"; policyId: string; missing: readonly MissingRequirement[] }>;

const MAX_MISSING = 32;

/**
 * The newest still-current fact-bearing entry that carries the required resource kind.
 *
 * Newest wins because a later observation supersedes an earlier one. A failed check never
 * satisfies anything: a check result records what happened, and what happened was a failure.
 */
function currentFactFor(
  state: EvidencePreconditionState,
  resourceKind: string,
): ExecutionLedgerEntry | null {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const entry = state.history[index];
    if (entry === undefined) continue;
    if (entry.kind !== "observation" && entry.kind !== "check_result") continue;
    // Facts recorded against another task or job are another task's business.
    if (entry.taskId !== state.taskId) continue;
    if (entry.kind === "check_result" && !entry.passed) continue;
    if (!entry.facts.some((fact) => fact.resourceKind === resourceKind)) continue;
    if (!isEntryStillValid(state.projection, entry, state.currentFingerprints)) continue;
    return entry;
  }
  return null;
}

/** Why no entry of this resource kind could be used, said precisely enough to act on. */
function describeMissingObservation(
  state: EvidencePreconditionState,
  resourceKind: string,
): string {
  const recorded = state.history.filter(
    (entry) =>
      (entry.kind === "observation" || entry.kind === "check_result") &&
      entry.taskId === state.taskId &&
      entry.facts.some((fact) => fact.resourceKind === resourceKind),
  );
  if (recorded.length === 0) {
    return `no ${resourceKind} has been observed for this task`;
  }
  return `every recorded ${resourceKind} is stale or invalidated; observe it again`;
}

function evidenceSatisfying(
  state: EvidencePreconditionState,
  requirement: Extract<PreconditionRequirement, { kind: "evidence" }>,
): EvidenceRecord | null {
  const allowed = new Set<string>(requirement.allowedEvidenceKinds);
  return (
    state.evidence.find(
      (record) =>
        record.status === "passed" &&
        record.subjectType === requirement.subjectType &&
        allowed.has(record.kind),
    ) ?? null
  );
}

export function evaluateEvidencePrecondition(
  policy: EvidencePreconditionPolicy,
  state: EvidencePreconditionState,
): EvidencePreconditionVerdict {
  const satisfiedBy: string[] = [];
  const missing: MissingRequirement[] = [];

  for (const requirement of policy.requirements) {
    if (requirement.kind === "ledger_observation") {
      const entry = currentFactFor(state, requirement.resourceKind);
      if (entry === null) {
        missing.push(
          Object.freeze({
            requirement,
            reason: describeMissingObservation(state, requirement.resourceKind),
          }),
        );
        continue;
      }
      satisfiedBy.push(entry.id);
      continue;
    }
    const record = evidenceSatisfying(state, requirement);
    if (record === null) {
      missing.push(
        Object.freeze({
          requirement,
          reason: `no passing ${requirement.allowedEvidenceKinds.join(" or ")} evidence about a ${requirement.subjectType} is recorded for this task`,
        }),
      );
      continue;
    }
    satisfiedBy.push(record.id);
  }

  if (missing.length > 0) {
    if (missing.length > MAX_MISSING) missing.length = MAX_MISSING;
    return Object.freeze({
      kind: "unsatisfied" as const,
      policyId: policy.policyId,
      missing: Object.freeze(missing),
    });
  }
  return Object.freeze({
    kind: "satisfied" as const,
    policyId: policy.policyId,
    satisfiedBy: Object.freeze(satisfiedBy),
  });
}

/**
 * Turns an unsatisfied verdict into the typed denial the caller must not work around.
 *
 * Non-retryable on purpose. Repeating the identical request against the identical state produces
 * the identical denial; only new evidence or new observed state can change the answer, and saying
 * so is what stops a retry loop from being mistaken for progress.
 */
export function assertEvidencePreconditionSatisfied(
  verdict: EvidencePreconditionVerdict,
  operationId: string,
): void {
  if (verdict.kind === "satisfied") return;
  throw new ApplicationError(
    "POLICY_REJECTED",
    "The evidence precondition for this operation is not satisfied; acquire the missing facts first.",
    {
      retryable: false,
      details: {
        operationId,
        policyId: verdict.policyId,
        missing: verdict.missing.map((entry) => describeRequirement(entry)),
      },
    },
  );
}

/** One missing requirement rendered as a single actionable line. */
export function describeRequirement(missing: MissingRequirement): string {
  const { requirement } = missing;
  const subject =
    requirement.kind === "ledger_observation"
      ? `ledger observation ${requirement.resourceKind}`
      : `${requirement.allowedEvidenceKinds.join("|")} evidence about ${requirement.subjectType}`;
  return `${subject}: ${missing.reason}`;
}
