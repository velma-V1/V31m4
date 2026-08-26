import { ExecutionLedgerEntry, type ExecutionLedgerEntry as LedgerEntry } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { Versioned } from "../port-types.js";
import type { ExecutionLedgerRepositoryPort } from "../ports/execution-ledger-repository.port.js";
import type { UnitOfWorkPort, UnitOfWorkTransaction } from "../ports/unit-of-work.port.js";
import { scanTaskLedger } from "./reconcile-execution-effect.js";

export interface AppendExecutionLedgerDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
}

/**
 * Appends one entry to a task's execution history.
 *
 * Outcome entries are checked against the attempt they name: an orphan outcome, or one pointing
 * at an entry that is not an attempt, is refused rather than stored as a dangling claim. No
 * model participates — this is deterministic bookkeeping.
 */
export async function appendExecutionLedgerEntry(
  dependencies: AppendExecutionLedgerDependencies,
  entry: LedgerEntry,
  context: OperationContext,
  existingTransaction?: UnitOfWorkTransaction,
): Promise<Versioned<LedgerEntry>> {
  const run = async (transaction: UnitOfWorkTransaction) => {
    await assertReferencesResolve(dependencies, entry, context, transaction);
    return dependencies.ledger.append(entry, context, transaction);
  };
  return existingTransaction === undefined
    ? dependencies.unitOfWork.execute(context, run)
    : run(existingTransaction);
}

async function assertReferencesResolve(
  dependencies: AppendExecutionLedgerDependencies,
  entry: LedgerEntry,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<void> {
  const referenced: string[] = [];
  if (
    entry.kind === "effect_confirmation" ||
    entry.kind === "effect_nonapplication" ||
    entry.kind === "reconciliation_indeterminate"
  ) {
    const attempt = await dependencies.ledger.getById(entry.attemptEntryId, context, transaction);
    if (attempt === null || attempt.kind !== "effect_attempt") {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "An outcome entry must reference an existing effect attempt.",
        { details: { entryId: entry.id, attemptEntryId: entry.attemptEntryId } },
      );
    }
    if (attempt.taskId !== entry.taskId) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "An outcome entry must belong to the same task as its attempt.",
        { details: { entryId: entry.id, attemptEntryId: entry.attemptEntryId } },
      );
    }
    // One attempt, one finalized outcome. Refusing a second here keeps a contradictory history
    // from being written at all, rather than leaving it to be discovered during a later fold.
    // The search walks the *whole* history through the canonical paged scan — an existing outcome
    // beyond the first page must block just as firmly as one on it — and stops as soon as it
    // finds a match.
    let existing: LedgerEntry | undefined;
    await scanTaskLedger(
      dependencies.ledger,
      entry.taskId,
      context,
      (entries) => {
        existing = entries.find(
          (candidate) =>
            (candidate.kind === "effect_confirmation" ||
              candidate.kind === "effect_nonapplication" ||
              candidate.kind === "reconciliation_indeterminate") &&
            candidate.attemptEntryId === entry.attemptEntryId,
        );
        return existing === undefined ? "continue" : "stop";
      },
      transaction,
    );
    if (existing !== undefined) {
      throw new ApplicationError(
        "CONFLICT",
        "This effect attempt already has a finalized outcome.",
        {
          details: {
            entryId: entry.id,
            attemptEntryId: entry.attemptEntryId,
            existingOutcome: existing.kind,
          },
        },
      );
    }
    return;
  }
  if (entry.kind === "invalidation") referenced.push(...entry.invalidatesEntryIds);
  if (entry.kind === "check_result") referenced.push(...entry.dependsOnEntryIds);
  if (entry.kind === "failure" && entry.attemptEntryId !== null) {
    referenced.push(entry.attemptEntryId);
  }

  for (const id of referenced) {
    const target = await dependencies.ledger.getById(id as LedgerEntry["id"], context, transaction);
    if (target === null) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "A ledger entry references an entry that does not exist.",
        { details: { entryId: entry.id, referenced: id } },
      );
    }
  }
}

/** Re-exported so callers build entries through the one validated constructor. */
export { ExecutionLedgerEntry };
