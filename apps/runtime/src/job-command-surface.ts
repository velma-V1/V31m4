import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type ApplicationJsonValue,
  type ArtifactStorePort,
  type AuditStorePort,
  type CandidateRepositoryPort,
  type ClockPort,
  deliverResult,
  type EventBusPort,
  type EvidenceRepositoryPort,
  isApplicationError,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type ProductionKernelPort,
  runSolverForge,
  selectChampionUseCase,
  startJob,
  type VerifierPort,
  type Versioned,
  verifyCandidates,
  type WorkspaceManagerPort,
  WriteConditions,
} from "@v31m4/application";
import { startJobRequestSchema, startJobResponseSchema } from "@v31m4/contracts";
import {
  ArtifactId,
  Job,
  JobId,
  type ModelId,
  type ProjectId,
  SafePath,
  VerificationPlanId,
} from "@v31m4/domain";
import type { SqliteIdempotencyStore, SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import type { RuntimeService } from "./composition-root.js";
import { canonicalJson } from "./external-command-executor.js";
import { ReferenceModelGateway } from "./job-execution-infrastructure.js";
import { parseCommandPayload } from "./use-case-infrastructure.js";

const REFERENCE_MODEL_ID = "reference-model" as ModelId;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface JobCommandDependencies {
  readonly service: RuntimeService;
  readonly database: SqliteRuntimeDatabase;
  readonly missions: MissionRepositoryPort;
  readonly jobs: JobRepositoryPort;
  readonly eventBus: EventBusPort;
  readonly idempotency: SqliteIdempotencyStore;
  readonly kernel: ProductionKernelPort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
  readonly artifacts: ArtifactStorePort;
  readonly candidates: CandidateRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly workspaces: WorkspaceManagerPort;
  readonly verifierFactory: (artifacts: ArtifactStorePort, projectId: ProjectId) => VerifierPort;
}

function asObject(value: ApplicationJsonValue): ApplicationJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Command payload must be an object.");
  }
  return value as ApplicationJsonObject;
}

function requireId(object: ApplicationJsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `Command field '${key}' is invalid.`, {
      details: { field: key },
    });
  }
  return value;
}

/** Registers direct job commands whose external calls cannot run inside the command executor UoW. */
export function registerJobCommands(dependencies: JobCommandDependencies): void {
  const {
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
    evidence,
    workspaces,
    verifierFactory,
  } = dependencies;

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
        { unitOfWork: database.unitOfWork, jobs, events: eventBus, kernel, audit, clock },
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

  service.registerDirect("job.execute", async (payload, context) => {
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const cached = await idempotency.lookup(
      context.actor.id,
      context.idempotencyKey,
      "job.execute",
      payloadHash,
    );
    if (cached?.status === "completed") return cached.result as ApplicationJsonValue;

    const jobIdRaw = requireId(asObject(payload), "jobId");
    const jobId = JobId.parse(jobIdRaw);
    const job = await database.unitOfWork.execute(context, async (transaction) => {
      const current = await jobs.getById(jobId, context, transaction);
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
    const [candidate] = await runSolverForge(
      { unitOfWork: database.unitOfWork, candidates, models: modelGateway, workspaces },
      {
        jobId,
        missionId: job.value.missionId,
        projectId,
        promptArtifactId,
        configurations: [
          Object.freeze({
            modelId: REFERENCE_MODEL_ID,
            strategy: "direct" as const,
            contextArtifactIds: Object.freeze([]),
            toolIds: Object.freeze([]),
            constraints: Object.freeze([]),
          }),
        ],
        candidateIds: [candidateId],
        invocationIds: [`invocation-${randomUUID()}`],
        createdAt: clock.now(),
        resourceBudget: mission.value.resourceBudget,
      },
      context,
    );
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
    const [verification] = await verifyCandidates(
      { unitOfWork: database.unitOfWork, evidence, verifier },
      [{ plan, candidate }],
      context,
    );
    if (verification === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verification produced no outcome.");
    }
    const passed = verification.result.status === "passed";
    const decision = await selectChampionUseCase(
      { unitOfWork: database.unitOfWork, candidates },
      {
        decisionId: `decision-${randomUUID()}`,
        missionId: job.value.missionId,
        decidedAt: clock.now(),
        candidates: [
          {
            candidateId: candidate.id,
            verification: verification.result,
            metrics: Object.freeze({
              correctness: passed ? 1 : 0,
              coverage: passed ? 1 : 0,
              security: 1,
              performance: 1,
              complexity: 0,
              evidenceStrength: passed ? 1 : 0,
            }),
            unresolvedCriticalRisks: Object.freeze([]),
            evidenceIds: verification.evidence.map((entry) => entry.id),
          },
        ],
      },
      context,
    );
    const receipt =
      decision.value.decision === "champion"
        ? await deliverResult(
            { unitOfWork: database.unitOfWork, candidates, clock },
            {
              receiptId: `receipt-${randomUUID()}`,
              decision: decision.value,
              deliveredArtifactIds: candidate.outputArtifactIds,
              requirementsCovered: mission.value.requirements.length,
              requirementsTotal: mission.value.requirements.length,
              mandatoryChecksPassed: verification.result.mandatoryChecksPassed,
              mandatoryChecksTotal: verification.result.mandatoryChecksTotal,
              unresolvedRiskIds: [],
              evidenceIds: verification.evidence.map((entry) => entry.id),
            },
            context,
          )
        : null;

    return database.unitOfWork.execute(context, async (transaction) => {
      const current = await jobs.getById(jobId, context, transaction);
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
        verification: verification.result,
        decision: decision.value,
        receipt: receipt?.value ?? null,
      } as unknown as ApplicationJsonValue;
      await idempotency.complete(
        context.actor.id,
        context.idempotencyKey,
        "job.execute",
        payloadHash,
        result,
      );
      return result;
    });
  });
}
