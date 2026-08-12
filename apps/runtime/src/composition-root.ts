import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  type ApplicationJsonValue,
  type ApprovalStorePort,
  type ArtifactStorePort,
  type AuditStorePort,
  type CandidateRepositoryPort,
  type ClockPort,
  createProject,
  type EventBusPort,
  type EvidenceRepositoryPort,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type OperationContext,
  type ProductionKernelPort,
  type ProjectRepositoryPort,
  submitMission,
  type UnitOfWorkTransaction,
  type VerifierPort,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import {
  createProjectRequestSchema,
  createProjectResponseSchema,
  submitMissionRequestSchema,
  submitMissionResponseSchema,
} from "@v31m4/contracts";
import { createDomainEvent, type ProjectId } from "@v31m4/domain";
import {
  ContentAddressedArtifactStore,
  EventReplayStore,
  type PolicyRule,
  RuleBasedPolicyEngine,
  SqliteIdempotencyStore,
  SqliteOutbox,
  SqlitePluginRegistry,
  SqliteRecordStore,
  SqliteRuntimeDatabase,
} from "@v31m4/infrastructure";
import { LocalSessionAuthenticator } from "./api/auth.js";
import { registerApprovalSurface } from "./approval-surface.js";
import { EventStreamCoordinator } from "./event-stream.js";
import { ExternalCommandExecutor } from "./external-command-executor.js";
import { registerJobCommands } from "./job-command-surface.js";
import {
  LocalWorkspaceManager,
  ReferenceVerifier,
  SqliteCandidateRepository,
  SqliteEvidenceRepository,
} from "./job-execution-infrastructure.js";
import { registerListQueries } from "./list-query-surface.js";
import type { RuntimeConfig } from "./runtime-config.js";
import {
  parseCommandPayload,
  passthroughUnitOfWork,
  ReferenceProductionKernel,
  SqliteApprovalStore,
  SqliteAuditStore,
  SqliteEventBus,
  SqliteJobRepository,
  SqliteMissionRepository,
  SqliteProjectRepository,
  SystemClock,
} from "./use-case-infrastructure.js";

const NAME_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** An authoritative command handler running inside the serialized command transaction. */
export type CommandHandler = (
  payload: ApplicationJsonValue,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
) => Promise<ApplicationJsonValue>;

/**
 * A command handler that manages its own transaction boundaries and may perform external effects
 * between them (e.g. `startJob`'s create+queue transaction, then a non-transactional production-
 * kernel call, then a running-or-failed transaction) — structurally incompatible with
 * {@link ExternalCommandExecutor}'s single enclosing transaction, which cannot have external
 * execution run while it is still open. Registered via {@link RuntimeService.registerDirect}.
 */
export type DirectCommandHandler = (
  payload: ApplicationJsonValue,
  context: OperationContext,
) => Promise<ApplicationJsonValue>;

/** An authenticated, read-only query over authoritative runtime state. */
export type QueryHandler = (
  payload: ApplicationJsonValue,
  context: OperationContext,
) => Promise<ApplicationJsonValue>;

/**
 * Command and query surface for the runtime. Most commands run through the
 * {@link ExternalCommandExecutor} so the external-command idempotency contract holds for the whole
 * operation; handlers contain the authoritative effect while HTTP routes only translate transport
 * to these calls. A `DirectCommandHandler` is the one exception, for commands whose external effect
 * cannot live inside a single transaction — it is responsible for its own idempotency handling.
 */
export class RuntimeService {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #directHandlers = new Map<string, DirectCommandHandler>();
  readonly #queryHandlers = new Map<string, QueryHandler>();

  constructor(
    private readonly executor: ExternalCommandExecutor,
    private readonly records: SqliteRecordStore,
  ) {}

  register(commandType: string, handler: CommandHandler): void {
    this.#handlers.set(commandType, handler);
  }

  registerDirect(commandType: string, handler: DirectCommandHandler): void {
    this.#directHandlers.set(commandType, handler);
  }

  registerQuery(queryType: string, handler: QueryHandler): void {
    this.#queryHandlers.set(queryType, handler);
  }

  async dispatch(
    commandType: string,
    payload: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const direct = this.#directHandlers.get(commandType);
    if (direct !== undefined) return direct(payload, context);
    const handler = this.#handlers.get(commandType);
    if (handler === undefined) {
      throw new ApplicationError("UNSUPPORTED_OPERATION", "Unknown command type.", {
        details: { commandType },
      });
    }
    return this.executor.execute(
      {
        actorId: context.actor.id,
        idempotencyKey: context.idempotencyKey,
        commandType,
        payload,
      },
      context,
      (transaction) => handler(payload, context, transaction),
    );
  }

  async query(
    queryType: string,
    payload: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const handler = this.#queryHandlers.get(queryType);
    if (handler === undefined) {
      throw new ApplicationError("UNSUPPORTED_OPERATION", "Unknown query type.", {
        details: { queryType },
      });
    }
    return handler(payload, context);
  }

  async getRecord(recordType: string, recordId: string): Promise<ApplicationJsonValue> {
    if (!NAME_TOKEN_PATTERN.test(recordType) || !ID_PATTERN.test(recordId)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Malformed record identity.");
    }
    const record = await this.records.get<ApplicationJsonValue>(recordType, recordId);
    if (record === null) {
      throw new ApplicationError("NOT_FOUND", "Record does not exist.", {
        details: { recordType, recordId },
      });
    }
    return { recordType, recordId, revision: record.revision, value: record.value };
  }
}

export interface RuntimeComposition {
  readonly config: RuntimeConfig;
  readonly database: SqliteRuntimeDatabase;
  readonly records: SqliteRecordStore;
  readonly outbox: SqliteOutbox;
  readonly replay: EventReplayStore;
  readonly coordinator: EventStreamCoordinator;
  readonly executor: ExternalCommandExecutor;
  readonly authenticator: LocalSessionAuthenticator;
  readonly service: RuntimeService;
  recoverOnStartup(): { readonly latestSequence: number };
  close(): void;
}

/**
 * Test-only composition seam: never populated from `RuntimeConfig`, the environment, or any
 * HTTP-facing input, so it cannot be activated by normal runtime operation. `verifierFactory`
 * lets tests inject a deterministic verifier (e.g. one that always fails) in place of the real
 * `ReferenceVerifier` to exercise job.execute's negative-verification path without making
 * `ReferenceVerifier` itself nondeterministic or environment-dependent.
 */
export interface CompositionOverrides {
  readonly verifierFactory?: (artifacts: ArtifactStorePort, projectId: ProjectId) => VerifierPort;
}

/**
 * Wires the runtime's durable authority (SQLite), its committed-event log, the resumable stream
 * coordinator, the idempotent command executor, local authentication, and the built-in command
 * handlers into a single composition. This is the only place concrete implementations are
 * assembled; routes and lifecycle code depend on the returned interface, not on construction.
 */
export function buildComposition(
  config: RuntimeConfig,
  overrides: CompositionOverrides = {},
): RuntimeComposition {
  const database = new SqliteRuntimeDatabase(config.databasePath);
  const records = new SqliteRecordStore(database);
  const outbox = new SqliteOutbox(database);
  const replay = new EventReplayStore(database);
  const coordinator = new EventStreamCoordinator(replay, {
    maxQueue: config.eventQueueLimit,
    batchSize: config.replayBatchSize,
  });
  const executor = new ExternalCommandExecutor(database);
  const authenticator = new LocalSessionAuthenticator(config.sessions);
  const service = new RuntimeService(executor, records);

  // Real Layer 6 use-case wiring: the operator's local session (role "operator") may create
  // projects; every other actor/action is fail-closed denied by RuleBasedPolicyEngine's default.
  const clock: ClockPort = new SystemClock();
  const projects: ProjectRepositoryPort = new SqliteProjectRepository(database);
  const missions: MissionRepositoryPort = new SqliteMissionRepository(database);
  const approvals: ApprovalStorePort = new SqliteApprovalStore(database);
  const audit: AuditStorePort = new SqliteAuditStore(database);
  const policyRules: readonly PolicyRule[] = Object.freeze([
    {
      id: "operator-plugin-registration-approval",
      effect: "require_approval",
      actions: ["plugin.register"],
      resourceTypes: ["plugin"],
      actorKinds: ["user"],
      requiredRoles: ["operator"],
      requiredApprovalScopes: ["plugin:register"],
      reason: "Plugin registration requires an explicit operator approval.",
    },
    {
      id: "operator-approval-actions",
      effect: "allow",
      actions: ["approval.decide", "approval.list"],
      resourceTypes: ["approval"],
      actorKinds: ["user"],
      requiredRoles: ["operator"],
      reason: "The local operator may review and decide approval requests.",
    },
    {
      id: "operator-project-actions",
      effect: "allow",
      actions: ["project.*"],
      actorKinds: ["user"],
      requiredRoles: ["operator"],
      reason: "The local operator session may manage projects.",
    },
  ]);
  const policy = new RuleBasedPolicyEngine(policyRules);
  const plugins = new SqlitePluginRegistry(database);
  registerApprovalSurface(service, { approvals, audit, clock, plugins, policy });

  service.register("project.create", async (payload, context, transaction) => {
    const request = parseCommandPayload(createProjectRequestSchema, payload);
    const projectId = `project-${randomUUID()}`;
    const auditId = `audit-${randomUUID()}`;
    const saved = await createProject(
      {
        unitOfWork: passthroughUnitOfWork(transaction),
        projects,
        policy,
        approvals,
        audit,
        clock,
      },
      { projectId, name: request.name, rootPath: request.rootPath, auditId },
      context,
    );
    const event = createDomainEvent({
      id: `event-${randomUUID()}`,
      type: "project.updated",
      aggregateType: "project",
      aggregateId: saved.value.id,
      occurredAt: context.startedAt,
      payload: { projectId: saved.value.id, status: saved.value.status, name: saved.value.name },
      metadata: {},
    });
    const sequence = await outbox.append(event, transaction);
    transaction.afterCommit(() => coordinator.publish({ sequence, event }));
    return createProjectResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      project: saved.value,
    });
  });

  // submitMission does not call authorizeAction itself (unlike createProject) - that is the
  // use case's own design, preserved as-is rather than adding a parallel policy check here.
  service.register("mission.submit", async (payload, context, transaction) => {
    const request = parseCommandPayload(submitMissionRequestSchema, payload);
    const missionId = `mission-${randomUUID()}`;
    const auditId = `audit-${randomUUID()}`;
    const { schemaVersion: _schemaVersion, requestId, ...missionContent } = request;
    // Zod's inferred type for an omitted-but-optional field is `T | undefined` (present under
    // exactOptionalPropertyTypes), stricter in shape than but behaviorally identical to the
    // domain type's plain optional key: a parsed, omitted field is simply absent at runtime,
    // never present with value `undefined`. This cast bridges that structural-typing friction at
    // the one boundary where a validated contract payload becomes a use-case command.
    const saved = await submitMission(
      { unitOfWork: passthroughUnitOfWork(transaction), projects, missions, audit, clock },
      { id: missionId, auditId, ...missionContent } as unknown as Parameters<
        typeof submitMission
      >[1],
      context,
    );
    const event = createDomainEvent({
      id: `event-${randomUUID()}`,
      type: "mission.submitted",
      aggregateType: "mission",
      aggregateId: saved.value.id,
      occurredAt: context.startedAt,
      payload: {
        missionId: saved.value.id,
        projectId: saved.value.projectId,
        title: saved.value.title,
      },
      metadata: {},
    });
    const sequence = await outbox.append(event, transaction);
    transaction.afterCommit(() => coordinator.publish({ sequence, event }));
    // Same structural-typing friction as above, at the response boundary: the parsed value is
    // genuinely safe JSON at runtime (Zod guarantees it), just not structurally identical to
    // ApplicationJsonValue's exact-optional-property shape.
    return submitMissionResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId,
      mission: saved.value,
    }) as unknown as ApplicationJsonValue;
  });

  const jobs: JobRepositoryPort = new SqliteJobRepository(database);
  const eventBus: EventBusPort = new SqliteEventBus(outbox, coordinator);
  // Direct handlers (job.start, job.execute) bypass ExternalCommandExecutor's automatic wrapping
  // (see the comment above the job.start registration), so they enforce the same
  // actor+key+commandType+payloadHash idempotency contract explicitly, against the same durable
  // idempotency_records table ExternalCommandExecutor's canonical commands use.
  const idempotency = new SqliteIdempotencyStore(database);
  const verifierFactory: (artifacts: ArtifactStorePort, projectId: ProjectId) => VerifierPort =
    overrides.verifierFactory ?? ((store, projectId) => new ReferenceVerifier(store, projectId));
  // No real production-kernel adapter process is installed on this machine; ReferenceProductionKernel
  // proves job orchestration deterministically, exactly like the Video/Game departments' reference
  // adapters, and must never be represented as real production-kernel execution.
  const kernel: ProductionKernelPort = new ReferenceProductionKernel();

  const artifactsRoot = join(dirname(config.databasePath), "artifacts");
  const artifacts: ArtifactStorePort = new ContentAddressedArtifactStore(database, artifactsRoot);
  const workspacesRoot = join(dirname(config.databasePath), "workspaces");
  const workspaces: WorkspaceManagerPort = new LocalWorkspaceManager(workspacesRoot);
  const candidates: CandidateRepositoryPort = new SqliteCandidateRepository(database);
  const evidenceRepo: EvidenceRepositoryPort = new SqliteEvidenceRepository(database);
  registerListQueries(service, {
    projects,
    missions,
    jobs,
    candidates,
    evidence: evidenceRepo,
  });

  registerJobCommands({
    service,
    database,
    missions,
    jobs,
    eventBus,
    idempotency,
    kernel,
    audit,
    clock,
    artifacts,
    candidates,
    evidence: evidenceRepo,
    workspaces,
    verifierFactory,
  });

  return Object.freeze({
    config,
    database,
    records,
    outbox,
    replay,
    coordinator,
    executor,
    authenticator,
    service,
    recoverOnStartup(): { readonly latestSequence: number } {
      // The database reopens with its WAL applied, so committed events survive a crash and the
      // durable log is immediately replay-ready. MAX(sequence) is the O(1) head of that log — the
      // cursor a client resumes toward — and is a truthful liveness signal, unlike a never-draining
      // "pending" count over an outbox that is retained for replay rather than consumed.
      const row = database.connection
        .prepare("SELECT MAX(sequence) AS latest FROM outbox_events")
        .get() as { latest: number | null } | undefined;
      return { latestSequence: row?.latest ?? 0 };
    },
    close(): void {
      coordinator.closeAll();
      database.close();
    },
  });
}
