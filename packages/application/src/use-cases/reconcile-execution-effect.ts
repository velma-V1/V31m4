import type {
  ContentHash,
  ExecutionLedgerEntry,
  LedgerEntryId,
  LedgerResourceFact,
  TaskId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { ExecutionLedgerRepositoryPort } from "../ports/execution-ledger-repository.port.js";
import type { UnitOfWorkTransaction } from "../ports/unit-of-work.port.js";
import { type PortPageVisitDecision, visitPortPages } from "./use-case-support.js";

/**
 * Deterministic reconciliation over the Execution Ledger.
 *
 * Everything here is a pure function of recorded entries. No model is consulted to decide what
 * happened: an effect is confirmed, denied, or unknown because entries say so, and an unknown
 * effect stays unknown until something observable resolves it.
 */
export type AttemptOutcome =
  | "unresolved"
  | "confirmed"
  | "not_applied"
  | "indeterminate"
  | "failed";

/**
 * One effect attempt as authoritative history records it.
 *
 * Every identity field here is read from the durable `effect_attempt` row, never from a caller.
 * That is what lets an effect be settled long after the process that ran it is gone: the record
 * of what was attempted outlives the capability that authorized it, and settling is a statement
 * about that record rather than a fresh request to act.
 */
export interface AttemptState {
  readonly attemptEntryId: LedgerEntryId;
  readonly taskId: TaskId;
  readonly jobId: string;
  readonly intentFingerprint: ContentHash;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly sandboxId: string | null;
  readonly outcome: AttemptOutcome;
}

/**
 * The one canonical attempt-outcome state machine.
 *
 * Two ideas that were previously conflated are kept apart here. `unresolved`, `failed`, and
 * `indeterminate` all **block** another try at the same intent, but none of them is a settled
 * answer about reality — each may still be reconciled once something observable is obtained.
 * `confirmed` and `not_applied` are **terminal**: reality was established, and no later entry may
 * revise it.
 *
 * Every transition is a strict move toward being settled, so there is no self-transition anywhere:
 * repeating a status is not a state change and may not be used to manufacture history. A failure
 * or an indeterminate record can never be written twice for one attempt, and neither can overwrite
 * a terminal outcome.
 *
 * The same table governs both the append path and the fold, so a history the append path accepted
 * always folds — and a stored sequence this table forbids is corruption, not caller input.
 */
export const ATTEMPT_OUTCOME_TRANSITIONS: Readonly<
  Record<AttemptOutcome, readonly AttemptOutcome[]>
> = Object.freeze({
  unresolved: Object.freeze<AttemptOutcome[]>([
    "failed",
    "indeterminate",
    "confirmed",
    "not_applied",
  ]),
  // A failure says the attempt did not succeed; it never says the effect failed to land, so it may
  // still be settled either way once reality is observed.
  failed: Object.freeze<AttemptOutcome[]>(["indeterminate", "confirmed", "not_applied"]),
  // Unknown blocks retry *until reconciled*, not for ever.
  indeterminate: Object.freeze<AttemptOutcome[]>(["confirmed", "not_applied"]),
  confirmed: Object.freeze<AttemptOutcome[]>([]),
  not_applied: Object.freeze<AttemptOutcome[]>([]),
});

/** Whether reality is settled for this attempt, so no later outcome may revise it. */
export function isTerminalAttemptOutcome(outcome: AttemptOutcome): boolean {
  return ATTEMPT_OUTCOME_TRANSITIONS[outcome].length === 0;
}

export function canTransitionAttemptOutcome(from: AttemptOutcome, to: AttemptOutcome): boolean {
  return ATTEMPT_OUTCOME_TRANSITIONS[from].includes(to);
}

/**
 * The outcome an entry asserts about an attempt, or `null` when it asserts none. A `failure`
 * carrying no `attemptEntryId` is ordinary failure history rather than an attempt outcome.
 */
export function assertedAttemptOutcome(
  entry: ExecutionLedgerEntry,
): Readonly<{ attemptEntryId: LedgerEntryId; outcome: AttemptOutcome }> | null {
  switch (entry.kind) {
    case "effect_confirmation":
      return { attemptEntryId: entry.attemptEntryId, outcome: "confirmed" };
    case "effect_nonapplication":
      return { attemptEntryId: entry.attemptEntryId, outcome: "not_applied" };
    case "reconciliation_indeterminate":
      return { attemptEntryId: entry.attemptEntryId, outcome: "indeterminate" };
    case "failure":
      return entry.attemptEntryId === null
        ? null
        : { attemptEntryId: entry.attemptEntryId, outcome: "failed" };
    default:
      return null;
  }
}

/**
 * The part of a fact-bearing entry that decides whether it is still current.
 *
 * Only `observation` and `check_result` can go stale, so only those are indexed. Keeping a
 * compact node instead of the whole entry is what lets a dependency be resolved during an
 * incremental, paged fold without holding every entry of a long history.
 */
export interface LedgerValidityNode {
  readonly entryId: string;
  readonly kind: "observation" | "check_result";
  readonly taskId: string;
  readonly jobId: string;
  readonly facts: readonly LedgerResourceFact[];
  /** Entries this one's validity depends on; empty for an observation. */
  readonly dependsOnEntryIds: readonly string[];
}

export interface LedgerProjection {
  readonly attempts: readonly AttemptState[];
  /** Entries explicitly invalidated by a later `invalidation` entry. */
  readonly invalidatedEntryIds: ReadonlySet<string>;
  /** Every fact-bearing entry, so a declared validity dependency can actually be resolved. */
  readonly validityNodes: ReadonlyMap<string, LedgerValidityNode>;
}

interface LedgerFold {
  readonly attempts: Map<string, AttemptState>;
  readonly invalidated: Set<string>;
  readonly validityNodes: Map<string, LedgerValidityNode>;
}

/**
 * Folds the append-only history into current state. Later entries supersede earlier beliefs;
 * nothing is mutated, and the same entries always fold to the same projection.
 */
export function projectLedger(entries: readonly ExecutionLedgerEntry[]): LedgerProjection {
  const fold: LedgerFold = {
    attempts: new Map(),
    invalidated: new Set(),
    validityNodes: new Map(),
  };
  foldLedgerPage(fold, entries);
  return finishFold(fold);
}

/**
 * Folds one page of history into an in-progress fold. Splitting the fold from the read is what
 * lets an unbounded history be reconciled incrementally instead of materialised in full — the
 * result is identical either way, because the fold only ever depends on append order.
 */
function foldLedgerPage(fold: LedgerFold, entries: readonly ExecutionLedgerEntry[]): void {
  const attempts = fold.attempts;
  const invalidated = fold.invalidated;

  for (const entry of entries) {
    if (entry.kind === "observation" || entry.kind === "check_result") {
      fold.validityNodes.set(entry.id, {
        entryId: entry.id,
        kind: entry.kind,
        taskId: entry.taskId,
        jobId: entry.jobId,
        facts: entry.facts,
        dependsOnEntryIds: entry.kind === "check_result" ? entry.dependsOnEntryIds : [],
      });
    }
    if (entry.kind === "effect_attempt") {
      attempts.set(entry.id, {
        attemptEntryId: entry.id,
        taskId: entry.taskId,
        jobId: entry.jobId,
        intentFingerprint: entry.intentFingerprint,
        operationId: entry.operationId,
        workspaceId: entry.workspaceId,
        sandboxId: entry.sandboxId,
        outcome: "unresolved",
      });
    }
    if (entry.kind === "invalidation") {
      for (const id of entry.invalidatesEntryIds) invalidated.add(id);
    }
    const asserted = assertedAttemptOutcome(entry);
    if (asserted !== null) {
      advanceAttempt(attempts, asserted.attemptEntryId, asserted.outcome);
    }
  }
}

function finishFold(fold: LedgerFold): LedgerProjection {
  return Object.freeze({
    attempts: Object.freeze([...fold.attempts.values()]),
    invalidatedEntryIds: fold.invalidated,
    validityNodes: fold.validityNodes,
  });
}

/**
 * Moves one attempt along the canonical state machine.
 *
 * The append path validates the very same transition before anything is stored, so a stored
 * sequence that lands here illegally cannot have come through it — it is corrupted or
 * hand-edited history, and surfacing that is the point. What this must never do is throw for a
 * sequence the append path accepted, which would make a task's history permanently unreplayable.
 */
function advanceAttempt(
  attempts: Map<string, AttemptState>,
  attemptEntryId: string,
  outcome: AttemptOutcome,
): void {
  const held = attempts.get(attemptEntryId);
  if (held === undefined) return;
  if (!canTransitionAttemptOutcome(held.outcome, outcome)) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "An effect attempt records an outcome transition the state machine forbids.",
      { details: { attemptEntryId, existing: held.outcome, conflicting: outcome } },
    );
  }
  attempts.set(attemptEntryId, { ...held, outcome });
}

export type RetryDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      code: "ATTEMPT_UNRESOLVED" | "EFFECT_INDETERMINATE" | "ALREADY_APPLIED";
      attemptEntryId: LedgerEntryId;
      reason: string;
    }>;

/**
 * Whether an intent may be attempted again.
 *
 * Three situations forbid it, and none of them is "probably fine". An unresolved attempt might
 * still be running. An indeterminate attempt may or may not have applied. A confirmed attempt
 * already applied, so repeating it would duplicate a real effect. Only a verified
 * non-application clears the way — that is the whole point of recording the difference.
 */
export function decideRetry(
  projection: LedgerProjection,
  intentFingerprint: ContentHash,
): RetryDecision {
  for (const attempt of projection.attempts) {
    if (attempt.intentFingerprint !== intentFingerprint) continue;
    if (attempt.outcome === "unresolved") {
      return blocked("ATTEMPT_UNRESOLVED", attempt, "an earlier attempt is still unresolved");
    }
    if (attempt.outcome === "indeterminate") {
      return blocked(
        "EFFECT_INDETERMINATE",
        attempt,
        "an earlier attempt could not be proved applied or unapplied",
      );
    }
    if (attempt.outcome === "confirmed") {
      return blocked("ALREADY_APPLIED", attempt, "this effect was already confirmed as applied");
    }
    if (attempt.outcome === "failed") {
      // A recorded failure says the attempt did not succeed. It does not say the effect never
      // landed — treating "failed" as "safe to repeat" is exactly how a duplicate effect gets
      // made. Only a verified non-application clears the way.
      return blocked(
        "EFFECT_INDETERMINATE",
        attempt,
        "an earlier attempt failed without proving the effect was not applied",
      );
    }
  }
  return Object.freeze({ allowed: true as const });
}

function blocked(
  code: "ATTEMPT_UNRESOLVED" | "EFFECT_INDETERMINATE" | "ALREADY_APPLIED",
  attempt: AttemptState,
  reason: string,
): RetryDecision {
  return Object.freeze({
    allowed: false as const,
    code,
    attemptEntryId: attempt.attemptEntryId,
    reason,
  });
}

/** The only entry kinds a check's validity may depend on. */
const DEPENDENCY_KINDS: ReadonlySet<string> = new Set(["observation", "check_result"]);

/**
 * An observation or check is usable only if nothing later invalidated it, every resource it
 * recorded still carries the fingerprint it had when observed, **and** every validity dependency
 * it declared is itself still usable.
 *
 * That last clause is what makes `dependsOnEntryIds` mean something. A check whose own report file
 * has not moved is not current if the observation it was derived from has gone stale or been
 * invalidated — the conclusion outlived its premise. Dependencies chain, so invalidating one
 * observation propagates through every check that transitively rests on it.
 *
 * Every ambiguity fails closed: a dependency that is missing, belongs to another task or job, is
 * not a fact-bearing kind, or sits on a cycle in corrupted history makes the dependent unusable
 * rather than trusted.
 */
export function isEntryStillValid(
  projection: LedgerProjection,
  entry: ExecutionLedgerEntry,
  currentFingerprints: Readonly<Record<string, string>>,
): boolean {
  if (entry.kind !== "observation" && entry.kind !== "check_result") {
    return !projection.invalidatedEntryIds.has(entry.id);
  }
  return isNodeStillValid(
    projection,
    {
      entryId: entry.id,
      kind: entry.kind,
      taskId: entry.taskId,
      jobId: entry.jobId,
      facts: entry.facts,
      dependsOnEntryIds: entry.kind === "check_result" ? entry.dependsOnEntryIds : [],
    },
    currentFingerprints,
    new Map(),
    new Set(),
  );
}

function isNodeStillValid(
  projection: LedgerProjection,
  node: LedgerValidityNode,
  currentFingerprints: Readonly<Record<string, string>>,
  decided: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  const cached = decided.get(node.entryId);
  if (cached !== undefined) return cached;
  // A cycle can only come from corrupted history — append refuses a dependency that does not
  // already exist — so treat it as unusable rather than looping or trusting it.
  if (visiting.has(node.entryId)) return false;

  const valid = evaluateNode(projection, node, currentFingerprints, decided, visiting);
  decided.set(node.entryId, valid);
  return valid;
}

function evaluateNode(
  projection: LedgerProjection,
  node: LedgerValidityNode,
  currentFingerprints: Readonly<Record<string, string>>,
  decided: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  if (projection.invalidatedEntryIds.has(node.entryId)) return false;
  if (!node.facts.every((fact) => currentFingerprints[fact.locator] === fact.fingerprint)) {
    return false;
  }
  if (node.dependsOnEntryIds.length === 0) return true;

  visiting.add(node.entryId);
  try {
    return node.dependsOnEntryIds.every((dependencyId) => {
      const dependency = projection.validityNodes.get(dependencyId);
      if (dependency === undefined) return false;
      if (!DEPENDENCY_KINDS.has(dependency.kind)) return false;
      if (dependency.taskId !== node.taskId || dependency.jobId !== node.jobId) return false;
      return isNodeStillValid(projection, dependency, currentFingerprints, decided, visiting);
    });
  } finally {
    visiting.delete(node.entryId);
  }
}

export interface ReconcileExecutionEffectDependencies {
  readonly ledger: ExecutionLedgerRepositoryPort;
}

/**
 * How much history one read pulls back. This is a transport bound, never a claim that a task's
 * history ends here: every authoritative reader below follows `nextCursor` to exhaustion.
 */
export const LEDGER_PAGE_SIZE = 500;

/**
 * The one canonical paged walk over a task's execution history, in append order.
 *
 * Every authoritative decision that reads the Ledger goes through this: retry projection,
 * reconciliation, and finalized-outcome conflict detection. It follows `nextCursor` until the
 * history is exhausted, rejects a repeated cursor, and surfaces its defensive page ceiling as a
 * typed non-success — so no decision can ever be made against a silently truncated first page.
 * A visitor may stop early, which is how a targeted lookup avoids reading the whole history.
 */
export async function scanTaskLedger(
  ledger: ExecutionLedgerRepositoryPort,
  taskId: TaskId,
  context: OperationContext,
  visit: (entries: readonly ExecutionLedgerEntry[]) => PortPageVisitDecision,
  transaction?: UnitOfWorkTransaction,
): Promise<void> {
  await visitPortPages<ExecutionLedgerEntry>(
    (cursor) =>
      ledger.listForTask(
        taskId,
        cursor === undefined ? { limit: LEDGER_PAGE_SIZE } : { limit: LEDGER_PAGE_SIZE, cursor },
        context,
        transaction,
      ),
    visit,
  );
}

/** Loads a task's complete history and folds it, so callers reconcile from durable state alone. */
export async function reconcileExecutionEffect(
  dependencies: ReconcileExecutionEffectDependencies,
  taskId: TaskId,
  context: OperationContext,
  transaction?: UnitOfWorkTransaction,
): Promise<LedgerProjection> {
  const fold: LedgerFold = {
    attempts: new Map(),
    invalidated: new Set(),
    validityNodes: new Map(),
  };
  await scanTaskLedger(
    dependencies.ledger,
    taskId,
    context,
    (entries) => {
      foldLedgerPage(fold, entries);
      return "continue";
    },
    transaction,
  );
  return finishFold(fold);
}

/**
 * The current state of exactly one attempt, folded from the task's complete durable history.
 *
 * The whole history is walked — the deciding outcome may sit on any page — but only entries about
 * this attempt are folded, so the answer costs a scan rather than a full projection. `null` means
 * no such attempt exists in this task's history.
 */
export async function attemptOutcomeState(
  ledger: ExecutionLedgerRepositoryPort,
  taskId: TaskId,
  attemptEntryId: string,
  context: OperationContext,
  transaction?: UnitOfWorkTransaction,
): Promise<AttemptOutcome | null> {
  const attempts = new Map<string, AttemptState>();
  await scanTaskLedger(
    ledger,
    taskId,
    context,
    (entries) => {
      for (const entry of entries) {
        if (entry.kind === "effect_attempt" && entry.id === attemptEntryId) {
          attempts.set(entry.id, {
            attemptEntryId: entry.id,
            taskId: entry.taskId,
            jobId: entry.jobId,
            intentFingerprint: entry.intentFingerprint,
            operationId: entry.operationId,
            workspaceId: entry.workspaceId,
            sandboxId: entry.sandboxId,
            outcome: "unresolved",
          });
          continue;
        }
        const asserted = assertedAttemptOutcome(entry);
        if (asserted !== null && asserted.attemptEntryId === attemptEntryId) {
          advanceAttempt(attempts, attemptEntryId, asserted.outcome);
        }
      }
      return "continue";
    },
    transaction,
  );
  return attempts.get(attemptEntryId)?.outcome ?? null;
}
