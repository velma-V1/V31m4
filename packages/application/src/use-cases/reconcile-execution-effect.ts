import type { ContentHash, ExecutionLedgerEntry, LedgerEntryId, TaskId } from "@v31m4/domain";
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

export interface AttemptState {
  readonly attemptEntryId: LedgerEntryId;
  readonly intentFingerprint: ContentHash;
  readonly operationId: string;
  readonly outcome: AttemptOutcome;
}

export interface LedgerProjection {
  readonly attempts: readonly AttemptState[];
  /** Entries explicitly invalidated by a later `invalidation` entry. */
  readonly invalidatedEntryIds: ReadonlySet<string>;
}

interface LedgerFold {
  readonly attempts: Map<string, { state: AttemptState; resolved: boolean }>;
  readonly invalidated: Set<string>;
}

/**
 * Folds the append-only history into current state. Later entries supersede earlier beliefs;
 * nothing is mutated, and the same entries always fold to the same projection.
 */
export function projectLedger(entries: readonly ExecutionLedgerEntry[]): LedgerProjection {
  const fold: LedgerFold = { attempts: new Map(), invalidated: new Set() };
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
    switch (entry.kind) {
      case "effect_attempt":
        attempts.set(entry.id, {
          resolved: false,
          state: {
            attemptEntryId: entry.id,
            intentFingerprint: entry.intentFingerprint,
            operationId: entry.operationId,
            outcome: "unresolved",
          },
        });
        break;
      case "effect_confirmation":
        resolve(attempts, entry.attemptEntryId, "confirmed");
        break;
      case "effect_nonapplication":
        resolve(attempts, entry.attemptEntryId, "not_applied");
        break;
      case "reconciliation_indeterminate":
        resolve(attempts, entry.attemptEntryId, "indeterminate");
        break;
      case "failure":
        if (entry.attemptEntryId !== null) {
          // A failure resolves an attempt only when the attempt never started producing an
          // effect; an indeterminate record is what covers "it may have run".
          resolve(attempts, entry.attemptEntryId, "failed");
        }
        break;
      case "invalidation":
        for (const id of entry.invalidatesEntryIds) invalidated.add(id);
        break;
      default:
        break;
    }
  }
}

function finishFold(fold: LedgerFold): LedgerProjection {
  return Object.freeze({
    attempts: Object.freeze([...fold.attempts.values()].map((held) => held.state)),
    invalidatedEntryIds: fold.invalidated,
  });
}

function resolve(
  attempts: Map<string, { state: AttemptState; resolved: boolean }>,
  attemptEntryId: string,
  outcome: AttemptOutcome,
): void {
  const held = attempts.get(attemptEntryId);
  if (held === undefined) return;
  if (held.resolved) {
    // The first finalized outcome stands. A conflicting second one is a defect to surface, not
    // a silent overwrite of history.
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "An effect attempt has more than one finalized outcome.",
      { details: { attemptEntryId, existing: held.state.outcome, conflicting: outcome } },
    );
  }
  attempts.set(attemptEntryId, {
    resolved: true,
    state: { ...held.state, outcome },
  });
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

/**
 * An observation or check is usable only if nothing later invalidated it **and** every resource
 * it recorded still carries the fingerprint it had when observed. A fact about a file that has
 * since changed is history, not evidence.
 */
export function isEntryStillValid(
  projection: LedgerProjection,
  entry: ExecutionLedgerEntry,
  currentFingerprints: Readonly<Record<string, string>>,
): boolean {
  if (projection.invalidatedEntryIds.has(entry.id)) return false;
  if (entry.kind !== "observation" && entry.kind !== "check_result") return true;
  return entry.facts.every((fact) => currentFingerprints[fact.locator] === fact.fingerprint);
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
  const fold: LedgerFold = { attempts: new Map(), invalidated: new Set() };
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
