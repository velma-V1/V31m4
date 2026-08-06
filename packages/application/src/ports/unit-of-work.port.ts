import type { OperationContext } from "../operation-context.js";

export interface UnitOfWorkTransaction {
  readonly id: string;
  readonly startedAt: string;
  afterCommit(action: () => void | Promise<void>): void;
  afterRollback(action: () => void | Promise<void>): void;
}

export interface UnitOfWorkPort {
  execute<Result>(
    context: OperationContext,
    work: (transaction: UnitOfWorkTransaction) => Promise<Result>,
  ): Promise<Result>;
}
