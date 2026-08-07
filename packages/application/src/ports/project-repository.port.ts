import type { Project, ProjectId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface ProjectRepositoryPort {
  getById(
    id: ProjectId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<Project> | null>;
  list(
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<Project>>>;
  save(
    project: Project,
    condition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Project>>;
}
