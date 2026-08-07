import type { PracticeTask, PracticeTaskId, PracticeTaskStatus } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface PracticeRepositoryPort {
  get(id: PracticeTaskId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<PracticeTask> | null>;
  list(status: PracticeTaskStatus | undefined, request: PortPageRequest, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<PracticeTask>>>;
  save(task: PracticeTask, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<PracticeTask>>;
}
