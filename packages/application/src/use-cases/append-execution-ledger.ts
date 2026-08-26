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
 * Every reference an entry carries is resolved before it is stored, and no reference may cross a
 * scope boundary: a referenced entry must exist, be a kind that reference permits, and belong to
 * the same task **and** the same job. An outcome recorded under another job must not be able to
 * finalize this job's attempt, and a check must not rest on another task's observation. No model
 * participates — this is deterministic bookkeeping.
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

/**
 * The fact-bearing kinds. A check's validity dependency and an invalidation's target may name
 * only these: they are the entries whose currency can actually be evaluated.
 */
const DEPENDENCY_KINDS: ReadonlySet<LedgerEntry["kind"]> = new Set<LedgerEntry["kind"]>([
  "observation",
  "check_result",
]);

/**
 * Resolves one reference and proves it stays inside this entry's scope.
 *
 * Same task and same job are both required. `getById` is a global lookup by entry identifier, so
 * without this an entry could name any other task's or job's history and have that edge accepted
 * as authoritative.
 */
async function requireReference(
  dependencies: AppendExecutionLedgerDependencies,
  entry: LedgerEntry,
  referencedId: string,
  allowedKinds: ReadonlySet<LedgerEntry["kind"]>,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<LedgerEntry> {
  if (referencedId === entry.id) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "A ledger entry cannot reference itself.",
      { details: { entryId: entry.id } },
    );
  }
  const target = await dependencies.ledger.getById(
    referencedId as LedgerEntry["id"],
    context,
    transaction,
  );
  if (target === null || !allowedKinds.has(target.kind)) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "A ledger entry references an entry that does not exist or is not a permitted kind.",
      {
        details: {
          entryId: entry.id,
          referenced: referencedId,
          referencedKind: target === null ? "missing" : target.kind,
        },
      },
    );
  }
  if (target.taskId !== entry.taskId || target.jobId !== entry.jobId) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "A ledger entry may only reference an entry from its own task and job.",
      {
        details: {
          entryId: entry.id,
          referenced: referencedId,
          entryTaskId: entry.taskId,
          entryJobId: entry.jobId,
          referencedTaskId: target.taskId,
          referencedJobId: target.jobId,
        },
      },
    );
  }
  return target;
}

async function assertReferencesResolve(
  dependencies: AppendExecutionLedgerDependencies,
  entry: LedgerEntry,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<void> {
  const referenced: { readonly id: string; readonly kinds: ReadonlySet<LedgerEntry["kind"]> }[] =
    [];
  if (
    entry.kind === "effect_confirmation" ||
    entry.kind === "effect_nonapplication" ||
    entry.kind === "reconciliation_indeterminate"
  ) {
    await requireReference(
      dependencies,
      entry,
      entry.attemptEntryId,
      new Set<LedgerEntry["kind"]>(["effect_attempt"]),
      context,
      transaction,
    );
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
  if (entry.kind === "invalidation") {
    // Invalidation supersedes a *belief about the environment* — an observation or a check. It is
    // deliberately not a way to point at an effect attempt: an attempt that may have changed the
    // world is resolved by an observed outcome, never annulled, and permitting it here would put a
    // retry-unblocking shape within reach of a caller.
    for (const id of entry.invalidatesEntryIds) {
      referenced.push({ id, kinds: DEPENDENCY_KINDS });
    }
  }
  if (entry.kind === "check_result") {
    // A check's validity may only rest on a fact-bearing entry; anything else could not be
    // evaluated for staleness, so accepting it would make the dependency decorative.
    for (const id of entry.dependsOnEntryIds) {
      referenced.push({ id, kinds: DEPENDENCY_KINDS });
    }
  }
  if (entry.kind === "failure" && entry.attemptEntryId !== null) {
    referenced.push({
      id: entry.attemptEntryId,
      kinds: new Set<LedgerEntry["kind"]>(["effect_attempt"]),
    });
  }

  for (const reference of referenced) {
    await requireReference(
      dependencies,
      entry,
      reference.id,
      reference.kinds,
      context,
      transaction,
    );
  }
}

/** Re-exported so callers build entries through the one validated constructor. */
export { ExecutionLedgerEntry };
