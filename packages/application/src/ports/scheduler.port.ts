import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { OperationReceipt, PortPage, PortPageRequest, WriteCondition } from "../port-types.js";

export type ScheduledWorkStatus = "scheduled" | "claimed" | "completed" | "failed" | "cancelled";

export interface ScheduledWork {
  readonly id: string;
  readonly kind: string;
  readonly payload: ApplicationJsonObject;
  readonly runAt: string;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly attemptCount: number;
  readonly status: ScheduledWorkStatus;
}

export interface SchedulerPort {
  schedule(
    work: ScheduledWork,
    condition: WriteCondition,
    context: OperationContext,
  ): Promise<OperationReceipt>;
  cancel(workId: string, context: OperationContext): Promise<void>;
  get(workId: string, context: OperationContext): Promise<ScheduledWork | null>;
  list(request: PortPageRequest, context: OperationContext): Promise<PortPage<ScheduledWork>>;
}
