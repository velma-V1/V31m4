import type { EvidenceId, EvidenceRecord, JobId, ProjectId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface EvidenceQuery extends PortPageRequest {
  readonly projectId?: ProjectId;
  readonly jobId?: JobId;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly statuses?: readonly EvidenceRecord["status"][];
  readonly kinds?: readonly EvidenceRecord["kind"][];
}

export interface EvidenceRepositoryPort {
  getById(id: EvidenceId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<EvidenceRecord> | null>;
  list(query: EvidenceQuery, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<EvidenceRecord>>>;
  append(record: EvidenceRecord, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<EvidenceRecord>>;
}
