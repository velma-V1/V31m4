import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStorePort,
  AuditQuery,
  AuditRecord,
  AuditStorePort,
  ClockPort,
  EventBusPort,
  JobListFilter,
  JobRepositoryPort,
  KernelStartRequest,
  KernelStatus,
  MissionRepositoryPort,
  OperationContext,
  OperationReceipt,
  PortHealth,
  PortListener,
  PortPage,
  PortPageRequest,
  PortSubscription,
  ProductionKernelPort,
  ProjectRepositoryPort,
  UnitOfWorkPort,
  UnitOfWorkTransaction,
  Versioned,
  WriteCondition,
} from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";
import type {
  Checkpoint,
  CheckpointId,
  DomainEvent,
  Job,
  JobId,
  MissionContract,
  Project,
  ProjectId,
} from "@v31m4/domain";
import {
  type SqliteOutbox,
  SqliteRecordStore,
  type SqliteRuntimeDatabase,
} from "@v31m4/infrastructure";
import type { ZodType } from "zod";
import type { EventStreamCoordinator } from "./event-stream.js";
import { listPersistedRecords } from "./record-listing.js";

const PROJECT_TYPE = "project";
const MISSION_TYPE = "mission";
const JOB_TYPE = "job";
const CHECKPOINT_TYPE = "checkpoint";
const APPROVAL_TYPE = "approval";
const AUDIT_TYPE = "audit";

/**
 * Validates a command's JSON payload against its `@v31m4/contracts` request schema, translating a
 * Zod failure into the same `INVALID_APPLICATION_INPUT` `ApplicationError` shape every other
 * validation failure in this runtime uses, instead of letting a raw `ZodError` collapse to an
 * opaque 500 in {@link import("./api/error-mapper.js").mapErrorToHttp}.
 */
export function parseCommandPayload<Value>(schema: ZodType<Value>, payload: unknown): Value {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Command payload failed validation.", {
      details: { issues: result.error.issues.map((issue) => issue.message) },
    });
  }
  return result.data;
}

/**
 * Adapts an already-open `UnitOfWorkTransaction` (opened by the runtime's
 * `ExternalCommandExecutor`, see external-command-executor.ts) into a `UnitOfWorkPort` a Layer 6
 * use case can call. Layer 6 use cases own their transaction boundary (`unitOfWork.execute(...)`)
 * because they are also used outside the runtime; `SqliteRuntimeDatabase` forbids nested
 * transactions, so the runtime cannot simply call `database.unitOfWork.execute` again inside the
 * executor's own transaction. Because this passthrough runs `work` against the *same* transaction
 * instead of opening a new one, the use case's writes, its audit append, and the executor's
 * idempotency record all commit atomically in one SQLite transaction — the idempotency contract is
 * preserved exactly, not weakened.
 */
export function passthroughUnitOfWork(transaction: UnitOfWorkTransaction): UnitOfWorkPort {
  return {
    async execute<Result>(
      _context: OperationContext,
      work: (transaction: UnitOfWorkTransaction) => Promise<Result>,
    ): Promise<Result> {
      return work(transaction);
    },
  };
}

/** Real wall-clock `ClockPort`. */
export class SystemClock implements ClockPort {
  now(): string {
    return new Date().toISOString();
  }
  monotonicMilliseconds(): number {
    return performance.now();
  }
  async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

/** `ProjectRepositoryPort` backed by the runtime's generic content-addressed-by-id record store. */
export class SqliteProjectRepository implements ProjectRepositoryPort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async getById(id: ProjectId): Promise<Versioned<Project> | null> {
    return this.#records.get<Project>(PROJECT_TYPE, id);
  }
  async list(request: PortPageRequest): Promise<PortPage<Versioned<Project>>> {
    return listPersistedRecords<Project>(this.database, PROJECT_TYPE, request);
  }
  async save(
    project: Project,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Project>> {
    return this.#records.save(PROJECT_TYPE, project.id, project, condition, transaction);
  }
}

/** `MissionRepositoryPort` backed by the generic record store. */
export class SqliteMissionRepository implements MissionRepositoryPort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async getById(id: string): Promise<Versioned<MissionContract> | null> {
    return this.#records.get<MissionContract>(MISSION_TYPE, id);
  }
  async listByProject(
    projectId: string,
    request: PortPageRequest,
  ): Promise<PortPage<Versioned<MissionContract>>> {
    return listPersistedRecords<MissionContract>(
      this.database,
      MISSION_TYPE,
      request,
      (mission) => mission.projectId === projectId,
    );
  }
  async append(
    mission: MissionContract,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<MissionContract>> {
    return this.#records.append(MISSION_TYPE, mission.id, mission, transaction);
  }
}

/** `JobRepositoryPort` backed by the generic record store; checkpoints are a separate record type. */
export class SqliteJobRepository implements JobRepositoryPort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async getById(id: JobId): Promise<Versioned<Job> | null> {
    return this.#records.get<Job>(JOB_TYPE, id);
  }
  async list(filter: JobListFilter): Promise<PortPage<Versioned<Job>>> {
    return listPersistedRecords<Job>(this.database, JOB_TYPE, filter, (job) => {
      if (filter.projectId !== undefined && job.projectId !== filter.projectId) return false;
      if (filter.missionId !== undefined && job.missionId !== filter.missionId) return false;
      return filter.statuses === undefined || filter.statuses.includes(job.status);
    });
  }
  async save(
    job: Job,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Job>> {
    return this.#records.save(JOB_TYPE, job.id, job, condition, transaction);
  }
  async appendCheckpoint(
    checkpoint: Checkpoint,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Checkpoint>> {
    return this.#records.append(CHECKPOINT_TYPE, checkpoint.id, checkpoint, transaction);
  }
  async getCheckpoint(id: CheckpointId): Promise<Versioned<Checkpoint> | null> {
    return this.#records.get<Checkpoint>(CHECKPOINT_TYPE, id);
  }
  async getLatestVerifiedCheckpoint(jobId: JobId): Promise<Versioned<Checkpoint> | null> {
    const page = listPersistedRecords<Checkpoint>(this.database, CHECKPOINT_TYPE, {
      limit: 10_000,
    });
    const candidates = page.items
      .filter((entry) => entry.value.jobId === jobId && entry.value.verified)
      .sort((a, b) => Date.parse(b.value.createdAt) - Date.parse(a.value.createdAt));
    return candidates[0] ?? null;
  }
}

/**
 * `EventBusPort` over the runtime's existing outbox/SSE stream — the same durable log and live
 * fan-out `project.updated`/`mission.submitted` already publish through, not a parallel event
 * system. `subscribe` has no caller in the currently-wired use cases; it fails closed rather than
 * pretending to support a subscription model that was never built or tested.
 */
export class SqliteEventBus implements EventBusPort {
  constructor(
    private readonly outbox: SqliteOutbox,
    private readonly coordinator: EventStreamCoordinator,
  ) {}
  async publish(
    events: readonly DomainEvent[],
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<void> {
    for (const event of events) {
      const sequence = await this.outbox.append(event, transaction);
      transaction.afterCommit(() => this.coordinator.publish({ sequence, event }));
    }
  }
  async subscribe(
    _eventTypes: readonly string[],
    _listener: PortListener<DomainEvent>,
    _context: OperationContext,
  ): Promise<PortSubscription> {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "In-process EventBusPort subscription is not implemented; use the /events SSE route.",
    );
  }
}

/**
 * Deterministic reference `ProductionKernelPort`: no real model/tool execution, no supervised
 * child process. It exists so job orchestration (accept -> queue -> start) is provable without a
 * real production-kernel adapter process installed, exactly like the Video/Game departments' own
 * reference adapters — this must never be represented as real production-kernel execution.
 */
export class ReferenceProductionKernel implements ProductionKernelPort {
  async start(request: KernelStartRequest): Promise<OperationReceipt> {
    return Object.freeze({
      operationId: `kernel-op-${randomUUID()}`,
      acceptedAt: new Date().toISOString(),
      idempotencyKey: request.jobId,
    });
  }
  async checkpoint(): Promise<CheckpointId> {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "ReferenceProductionKernel does not implement checkpointing yet.",
    );
  }
  async resume(): Promise<OperationReceipt> {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "ReferenceProductionKernel does not implement resume yet.",
    );
  }
  async stop(): Promise<void> {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "ReferenceProductionKernel does not implement stop yet.",
    );
  }
  async status(jobId: JobId): Promise<KernelStatus> {
    return Object.freeze({
      jobId,
      status: "running",
      stage: "accepted",
      progress: 0 as KernelStatus["progress"],
      details: Object.freeze({}),
    });
  }
  async health(): Promise<PortHealth> {
    return Object.freeze({
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { kernel: "reference", real: false },
    });
  }
}

/** `ApprovalStorePort` backed by the generic record store. Exercised only when a policy rule
 * returns `require_approval`; the default operator policy allows known actions outright. */
export class SqliteApprovalStore implements ApprovalStorePort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async get(id: string): Promise<Versioned<ApprovalRequest> | null> {
    return this.#records.get<ApprovalRequest>(APPROVAL_TYPE, id);
  }
  async list(
    status: ApprovalStatus | undefined,
    request: PortPageRequest,
  ): Promise<PortPage<Versioned<ApprovalRequest>>> {
    return listPersistedRecords<ApprovalRequest>(
      this.database,
      APPROVAL_TYPE,
      request,
      (approval) => status === undefined || approval.status === status,
    );
  }
  async save(
    request: ApprovalRequest,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<ApprovalRequest>> {
    return this.#records.save(APPROVAL_TYPE, request.id, request, condition, transaction);
  }
  async consume(
    id: string,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<ApprovalRequest>> {
    const current = await this.get(id);
    if (current === null) {
      throw new ApplicationError("NOT_FOUND", "Approval does not exist.", { details: { id } });
    }
    const consumed: ApprovalRequest = { ...current.value, status: "consumed" };
    return this.#records.save(APPROVAL_TYPE, id, consumed, condition, transaction);
  }
}

/** `AuditStorePort` backed by the generic record store, one row per audit record id. */
export class SqliteAuditStore implements AuditStorePort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async append(
    record: AuditRecord,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<void> {
    await this.#records.append(AUDIT_TYPE, record.id, record, transaction);
  }
  async list(query: AuditQuery): Promise<PortPage<AuditRecord>> {
    const page = listPersistedRecords<AuditRecord>(
      this.database,
      AUDIT_TYPE,
      query,
      (record) =>
        (query.action === undefined || record.action === query.action) &&
        (query.resourceType === undefined || record.resourceType === query.resourceType) &&
        (query.resourceId === undefined || record.resourceId === query.resourceId) &&
        (query.actorId === undefined || record.actor.id === query.actorId) &&
        (query.outcomes === undefined || query.outcomes.includes(record.outcome)),
    );
    return Object.freeze({ ...page, items: page.items.map((entry) => entry.value) });
  }
}
