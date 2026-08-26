import type { ExecutionLedgerEntry, LedgerEntryId, TaskId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

/**
 * Append-only execution history.
 *
 * There is deliberately no update and no delete. A record that turns out to be wrong is
 * superseded by a later entry — an `invalidation`, a `failure`, or a
 * `reconciliation_indeterminate` — never rewritten, because the point of the ledger is to say
 * what was believed and when, not to present a tidy final story.
 *
 * Entries are returned in append order, which is what makes replay deterministic.
 */
export interface ExecutionLedgerRepositoryPort {
  append(
    entry: ExecutionLedgerEntry,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<ExecutionLedgerEntry>>;

  getById(
    id: LedgerEntryId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<ExecutionLedgerEntry | null>;

  /** Every entry for a task, in append order. */
  listForTask(
    taskId: TaskId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<ExecutionLedgerEntry>>;
}
