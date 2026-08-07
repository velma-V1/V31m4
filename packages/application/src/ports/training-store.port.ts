import type { TrainingPacket, TrainingPacketId, TrainingPacketStatus } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface TrainingStorePort {
  get(
    id: TrainingPacketId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<TrainingPacket> | null>;
  list(
    status: TrainingPacketStatus | undefined,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<TrainingPacket>>>;
  save(
    packet: TrainingPacket,
    condition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<TrainingPacket>>;
}
