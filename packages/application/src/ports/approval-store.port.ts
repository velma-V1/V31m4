import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationActor, OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export type ApprovalStatus = "pending" | "granted" | "denied" | "expired" | "consumed";

export interface ApprovalRequest {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly requestedBy: OperationActor;
  readonly requiredScopes: readonly string[];
  readonly context: ApplicationJsonObject;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy?: OperationActor;
  readonly decidedAt?: string;
  readonly decisionReason?: string;
}

export interface ApprovalStorePort {
  get(id: string, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<ApprovalRequest> | null>;
  list(status: ApprovalStatus | undefined, request: PortPageRequest, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<ApprovalRequest>>>;
  save(request: ApprovalRequest, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<ApprovalRequest>>;
  consume(id: string, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<ApprovalRequest>>;
}
