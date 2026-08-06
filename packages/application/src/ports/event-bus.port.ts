import type { DomainEvent } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortListener, PortSubscription } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface EventBusPort {
  publish(events: readonly DomainEvent[], context: OperationContext, transaction: UnitOfWorkTransaction): Promise<void>;
  subscribe(eventTypes: readonly string[], listener: PortListener<DomainEvent>, context: OperationContext): Promise<PortSubscription>;
}
