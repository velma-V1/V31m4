import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type ApplicationJsonValue,
  type ApprovalStorePort,
  type ArtifactStorePort,
  type AuditStorePort,
  type CandidateRepositoryPort,
  type ClockPort,
  createProject,
  deliverResult,
  type EventBusPort,
  type EvidenceRepositoryPort,
  isApplicationError,
  isApplicationJsonValue,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type OperationContext,
  type ProductionKernelPort,
  type ProjectRepositoryPort,
  runSolverForge,
  selectChampionUseCase,
  startJob,
  submitMission,
  type UnitOfWorkTransaction,
  type VerifierPort,
  type Versioned,
  verifyCandidates,
  type WorkspaceManagerPort,
  type WriteCondition,
  WriteConditions,
} from "@v31m4/application";
import {
  createProjectRequestSchema,
  createProjectResponseSchema,
  startJobRequestSchema,
  startJobResponseSchema,
  submitMissionRequestSchema,
  submitMissionResponseSchema,
} from "@v31m4/contracts";
import {
  ArtifactId,
  createDomainEvent,
  Job,
  JobId,
  type ModelId,
  type ProjectId,
  SafePath,
  VerificationPlanId,
} from "@v31m4/domain";
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
import { canonicalJson, ExternalCommandExecutor } from "./external-command-executor.js";
import {
  LocalWorkspaceManager,
  ReferenceModelGateway,
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

const REFERENCE_MODEL_ID = "reference-model" as ModelId;

const NAME_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** An authoritative command handler running inside the serialized command transaction. */
export type CommandHandler = (
  payload: ApplicationJsonValue,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
) => Promise<ApplicationJsonValue>;

function asObject(value: ApplicationJsonValue): ApplicationJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Command payload must be an object.");
  }
  return value as ApplicationJsonObject;
}

function requireString(object: ApplicationJsonObject, key: string, pattern: RegExp): string {
  const value = object[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `Command field '${key}' is invalid.`, {
      details: { field: key },
    });
  }
  return value;
}

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

  // Built-in record write: authoritative CAS write plus a durable event, both in one transaction,
  // with the live fan-out registered only after commit so subscribers never see uncommitted state.
  service.register("record.put", async (payload, context, transaction) => {
    const object = asObject(payload);
    const recordType = requireString(object, "recordType", NAME_TOKEN_PATTERN);
    const recordId = requireString(object, "recordId", ID_PATTERN);
    const body = object["body"];
    if (!isApplicationJsonValue(body)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Record body must be safe JSON.");
    }
    const expectedRevision =
      object["expectedRevision"] === undefined ? undefined : String(object["expectedRevision"]);

    const current = await records.get<ApplicationJsonValue>(recordType, recordId);
    let condition: WriteCondition;
    if (expectedRevision === undefined) {
      condition = WriteConditions.mustNotExist();
    } else {
      if (current === null || current.revision !== expectedRevision) {
        throw new ApplicationError("VERSION_CONFLICT", "Record revision does not match expected.", {
          details: { expected: expectedRevision, found: current?.revision ?? null },
        });
      }
      condition = WriteConditions.matchRevision(expectedRevision);
    }
    const saved = await records.save(recordType, recordId, body, condition, transaction);
    const event = createDomainEvent({
      id: `event-${randomUUID()}`,
      type: current === null ? "record.created" : "record.updated",
      aggregateType: recordType,
      aggregateId: recordId,
      occurredAt: context.startedAt,
      payload: { revision: Number(saved.revision) },
      metadata: {},
    });
    const sequence = await outbox.append(event, transaction);
    transaction.afterCommit(() => coordinator.publish({ sequence, event }));
    return { recordType, recordId, revision: saved.revision, sequence };
  });

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

  // job.start is a DirectCommandHandler, not a CommandHandler: startJob opens its own create+queue
  // transaction, then calls the (here, reference) production kernel outside any transaction - Layer
  // 7 forbids external execution while a SQLite transaction is active, so it cannot run inside
  // ExternalCommandExecutor's single enclosing transaction. Idempotency is therefore enforced
  // explicitly, in the same two layers ExternalCommandExecutor uses internally:
  //   1. idempotency.lookup() is the authority for actor+key identity: a repeat of the same key
  //      with a different command payload (e.g. a different missionId/workflowId) throws CONFLICT
  //      here, before any job is looked up or created, closing the bug where a reused key with a
  //      different payload used to silently return whichever job the key happened to hash to.
  //   2. The deterministic jobId + Job.create's mustNotExist() write condition remain as the
  //      concurrency backstop for two genuinely identical concurrent retries racing each other
  //      before either has recorded a completed idempotency row; the catch below only treats the
  //      resulting CONFLICT as an idempotent match if the existing job's mission/workflow actually
  //      match this request, rather than returning it unconditionally.
  service.registerDirect("job.start", async (payload, context) => {
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const cached = await idempotency.lookup(
      context.actor.id,
      context.idempotencyKey,
      "job.start",
      payloadHash,
    );
    if (cached?.status === "completed") return cached.result as ApplicationJsonValue;

    const request = parseCommandPayload(startJobRequestSchema, payload);
    const jobId = `job-${createHash("sha256")
      .update(`${context.actor.id}:${context.idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`;
    const mission = await missions.getById(request.missionId, context);
    if (mission === null) {
      throw new ApplicationError("NOT_FOUND", "Mission does not exist.", {
        details: { missionId: request.missionId },
      });
    }

    const toResponse = (job: Job): ApplicationJsonValue =>
      startJobResponseSchema.parse({
        schemaVersion: request.schemaVersion,
        requestId: request.requestId,
        job,
      }) as unknown as ApplicationJsonValue;

    let response: ApplicationJsonValue;
    try {
      const saved = await startJob(
        {
          unitOfWork: database.unitOfWork,
          jobs,
          events: eventBus,
          kernel,
          audit,
          clock,
        },
        {
          jobId,
          projectId: mission.value.projectId,
          missionId: request.missionId,
          workflowId: request.workflowId,
          input: {},
          resourceBudget: mission.value.resourceBudget,
          createdEventId: `event-${randomUUID()}`,
          queuedEventId: `event-${randomUUID()}`,
          startedEventId: `event-${randomUUID()}`,
          failureEventId: `event-${randomUUID()}`,
          auditId: `audit-${randomUUID()}`,
        },
        context,
      );
      response = toResponse(saved.value);
    } catch (error) {
      if (isApplicationError(error) && error.code === "CONFLICT") {
        const current = await jobs.getById(JobId.parse(jobId), context);
        if (
          current !== null &&
          current.value.missionId === request.missionId &&
          current.value.workflowId === request.workflowId
        ) {
          response = toResponse(current.value);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    await idempotency.complete(
      context.actor.id,
      context.idempotencyKey,
      "job.start",
      payloadHash,
      response,
    );
    return response;
  });

  // job.execute drives one real solver -> verify -> select-champion -> (deliver) pass through the
  // real, unmodified Layer 6 use cases, using ReferenceModelGateway/ReferenceVerifier since no real
  // model or verifier is installed on this machine - see job-execution-infrastructure.ts. It is a
  // DirectCommandHandler for the same reason job.start is: models.invoke/verifier.execute are called
  // outside any transaction by the use cases themselves (runSolverForge, verifyCandidates), so this
  // cannot be wrapped in ExternalCommandExecutor's single enclosing transaction either.
  //
  // Idempotency has two layers:
  //   1. idempotency.lookup() gives true replay semantics: a repeat of the same actor+key+payload
  //      after this job has already completed or failed returns the original recorded result
  //      instead of failing closed on the job's terminal status.
  //   2. Before any external effect (kernel/model/verifier/candidate/evidence work) runs, an atomic
  //      claim transaction reads the job and, in the same transaction, requires currentStage is not
  //      already "executing" and moves it there via Job.updateProgress() under
  //      WriteConditions.matchRevision(). SQLite serializes concurrent transactions on the single
  //      connection, so two concurrent job.execute calls for the same job cannot both observe
  //      currentStage !== "executing" and proceed: the second either fails matchRevision or, having
  //      read after the first's commit, sees currentStage === "executing" and is rejected with
  //      CONFLICT before doing any external work. If the process crashes or throws after claiming
  //      but before the completing transaction runs (which is the only place the claim is ever
  //      cleared), the job is left claimed: a retry is rejected rather than silently re-executing or
  //      silently succeeding on stale state - fail-closed by construction, not by a recovery flag.
  service.registerDirect("job.execute", async (payload, context) => {
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const cached = await idempotency.lookup(
      context.actor.id,
      context.idempotencyKey,
      "job.execute",
      payloadHash,
    );
    if (cached?.status === "completed") return cached.result as ApplicationJsonValue;

    const object = asObject(payload);
    const jobIdRaw = requireString(object, "jobId", ID_PATTERN);
    const jobIdBranded = JobId.parse(jobIdRaw);

    const claimed = await database.unitOfWork.execute(context, async (transaction) => {
      const current = await jobs.getById(jobIdBranded, context, transaction);
      if (current === null) {
        throw new ApplicationError("NOT_FOUND", "Job does not exist.", {
          details: { jobId: jobIdRaw },
        });
      }
      if (current.value.status !== "running") {
        throw new ApplicationError("CONFLICT", "Job must be running to execute.", {
          details: { status: current.value.status },
        });
      }
      if (current.value.currentStage === "executing") {
        throw new ApplicationError("CONFLICT", "Job execution is already in progress.", {
          details: { jobId: jobIdRaw },
        });
      }
      const claim = Job.updateProgress(current.value, {
        eventId: `event-${randomUUID()}`,
        occurredAt: clock.now(),
        progress: current.value.progress,
        stage: "executing",
      });
      const saved = await jobs.save(
        claim.job,
        WriteConditions.matchRevision(current.revision),
        context,
        transaction,
      );
      await eventBus.publish([claim.event], context, transaction);
      return saved;
    });
    const job = claimed;

    const mission = await missions.getById(job.value.missionId, context);
    if (mission === null) {
      throw new ApplicationError("NOT_FOUND", "Mission does not exist.", {
        details: { missionId: job.value.missionId },
      });
    }

    const projectId = job.value.projectId;
    const modelGateway = new ReferenceModelGateway(artifacts, database.unitOfWork, projectId);
    const verifier = verifierFactory(artifacts, projectId);

    async function* textBytes(text: string): AsyncIterable<Uint8Array> {
      yield Buffer.from(text, "utf8");
    }

    const promptArtifactId = await database.unitOfWork.execute(context, async (transaction) => {
      const artifact = await artifacts.write(
        {
          id: ArtifactId.parse(`artifact-${randomUUID()}`),
          projectId,
          kind: "document",
          logicalPath: SafePath.parse(`job-${jobIdRaw}/prompt.txt`),
          mediaType: "text/plain",
          parentArtifactIds: [],
          bytes: textBytes(`${mission.value.title}\n${mission.value.objective}`),
        },
        context,
        transaction,
      );
      return artifact.value.id;
    });

    const candidateId = `candidate-${randomUUID()}`;
    const configuration = Object.freeze({
      modelId: REFERENCE_MODEL_ID,
      strategy: "direct" as const,
      contextArtifactIds: Object.freeze([]),
      toolIds: Object.freeze([]),
      constraints: Object.freeze([]),
    });
    const producedCandidates = await runSolverForge(
      { unitOfWork: database.unitOfWork, candidates, models: modelGateway, workspaces },
      {
        jobId: jobIdBranded,
        missionId: job.value.missionId,
        projectId,
        promptArtifactId,
        configurations: [configuration],
        candidateIds: [candidateId],
        invocationIds: [`invocation-${randomUUID()}`],
        createdAt: clock.now(),
        resourceBudget: mission.value.resourceBudget,
      },
      context,
    );
    const candidate = producedCandidates[0];
    if (candidate === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Solver forge produced no candidate.");
    }

    const plan = Object.freeze({
      id: VerificationPlanId.parse(`plan-${randomUUID()}`),
      missionId: job.value.missionId,
      candidateId: candidate.id,
      checks: Object.freeze([
        Object.freeze({
          id: "output-artifact-presence",
          criterionIds: Object.freeze(mission.value.acceptanceCriteria.map((entry) => entry.id)),
          verifierId: "reference-verifier",
          kind: "static_analysis" as const,
          mandatory: true,
          hidden: false,
          timeoutMs: 30_000,
        }),
      ]),
    });
    const [verifyOutcome] = await verifyCandidates(
      { unitOfWork: database.unitOfWork, evidence: evidenceRepo, verifier },
      [{ plan, candidate }],
      context,
    );
    if (verifyOutcome === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verification produced no outcome.");
    }

    const passed = verifyOutcome.result.status === "passed";
    const decisionSaved = await selectChampionUseCase(
      { unitOfWork: database.unitOfWork, candidates },
      {
        decisionId: `decision-${randomUUID()}`,
        missionId: job.value.missionId,
        decidedAt: clock.now(),
        candidates: [
          {
            candidateId: candidate.id,
            verification: verifyOutcome.result,
            metrics: Object.freeze({
              correctness: passed ? 1 : 0,
              coverage: passed ? 1 : 0,
              security: 1,
              performance: 1,
              complexity: 0,
              evidenceStrength: passed ? 1 : 0,
            }),
            unresolvedCriticalRisks: Object.freeze([]),
            evidenceIds: verifyOutcome.evidence.map((entry) => entry.id),
          },
        ],
      },
      context,
    );

    const receipt =
      decisionSaved.value.decision === "champion"
        ? await deliverResult(
            { unitOfWork: database.unitOfWork, candidates, clock },
            {
              receiptId: `receipt-${randomUUID()}`,
              decision: decisionSaved.value,
              deliveredArtifactIds: candidate.outputArtifactIds,
              requirementsCovered: mission.value.requirements.length,
              requirementsTotal: mission.value.requirements.length,
              mandatoryChecksPassed: verifyOutcome.result.mandatoryChecksPassed,
              mandatoryChecksTotal: verifyOutcome.result.mandatoryChecksTotal,
              unresolvedRiskIds: [],
              evidenceIds: verifyOutcome.evidence.map((entry) => entry.id),
            },
            context,
          )
        : null;

    const response = await database.unitOfWork.execute(context, async (transaction) => {
      const current = await jobs.getById(jobIdBranded, context, transaction);
      if (current === null) {
        throw new ApplicationError("INTEGRITY_FAILURE", "Job disappeared during execution.");
      }
      let finalJob: Versioned<Job>;
      if (receipt !== null) {
        const completed = Job.complete(current.value, {
          eventId: `event-${randomUUID()}`,
          occurredAt: clock.now(),
        });
        finalJob = await jobs.save(
          completed.job,
          WriteConditions.matchRevision(current.revision),
          context,
          transaction,
        );
        await eventBus.publish([completed.event], context, transaction);
      } else {
        const failed = Job.fail(current.value, {
          eventId: `event-${randomUUID()}`,
          occurredAt: clock.now(),
          failureReason: "No verified champion candidate.",
        });
        finalJob = await jobs.save(
          failed.job,
          WriteConditions.matchRevision(current.revision),
          context,
          transaction,
        );
        await eventBus.publish([failed.event], context, transaction);
      }

      const result = {
        job: finalJob.value,
        candidate,
        verification: verifyOutcome.result,
        decision: decisionSaved.value,
        receipt: receipt?.value ?? null,
      } as unknown as ApplicationJsonValue;
      // Written inside this same transaction so the job's terminal state and the durable
      // idempotency record that lets a later replay of this exact command return this exact
      // result commit together, atomically.
      await idempotency.complete(
        context.actor.id,
        context.idempotencyKey,
        "job.execute",
        payloadHash,
        result,
      );
      return result;
    });

    return response;
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
