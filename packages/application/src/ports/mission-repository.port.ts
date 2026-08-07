import type { MissionContract, MissionId, ProjectId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface MissionRepositoryPort {
  getById(
    id: MissionId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<MissionContract> | null>;
  listByProject(
    projectId: ProjectId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<MissionContract>>>;
  append(
    mission: MissionContract,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<MissionContract>>;
}
