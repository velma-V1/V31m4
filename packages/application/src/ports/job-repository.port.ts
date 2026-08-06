import type { Checkpoint, CheckpointId, Job, JobId, MissionId, ProjectId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface JobListFilter extends PortPageRequest {
  readonly projectId?: ProjectId;
  readonly missionId?: MissionId;
  readonly statuses?: readonly Job["status"][];
}

export interface JobRepositoryPort {
  getById(id: JobId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<Job> | null>;
  list(filter: JobListFilter, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<Job>>>;
  save(job: Job, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<Job>>;
  appendCheckpoint(checkpoint: Checkpoint, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<Checkpoint>>;
  getCheckpoint(id: CheckpointId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<Checkpoint> | null>;
  getLatestVerifiedCheckpoint(jobId: JobId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<Checkpoint> | null>;
}
