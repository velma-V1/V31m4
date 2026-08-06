import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationActor, OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export type AuditOutcome = "accepted" | "completed" | "denied" | "failed" | "cancelled";

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly actor: OperationActor;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly details: ApplicationJsonObject;
}

export interface AuditQuery extends PortPageRequest {
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly actorId?: string;
  readonly outcomes?: readonly AuditOutcome[];
}

export interface AuditStorePort {
  append(record: AuditRecord, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<void>;
  list(query: AuditQuery, context: OperationContext): Promise<PortPage<AuditRecord>>;
}
