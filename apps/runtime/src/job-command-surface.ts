import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonValue,
  type ArtifactStorePort,
  type AuditStorePort,
  type CandidateRepositoryPort,
  type CandidateVerificationOutcome,
  type ClockPort,
  checkpointJob,
  deliverResult,
  type EventBusPort,
  type EvidenceRepositoryPort,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type ModelGatewayPort,
  type ProductionKernelPort,
  type ProjectRepositoryPort,
  selectChampionUseCase,
  type VerifierPort,
  type Versioned,
  verifyCandidates,
  type WorkspaceManagerPort,
  WriteConditions,
} from "@v31m4/application";
import {
  ArtifactId,
  Job,
  JobId,
  type ModelId,
  type ProjectId,
  SafePath,
  type SolverConfiguration,
  VerificationResult,
} from "@v31m4/domain";
import type { SqliteIdempotencyStore, SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import type { RuntimeService } from "./composition-root.js";
import { canonicalJson } from "./external-command-executor.js";
import { asCommandObject, requireCommandId, stableDigest } from "./job-command-helpers.js";
import { registerJobStartCommand } from "./job-start-command.js";
import { createJobModelConfiguration, createJobVerificationPlan } from "./job-verification-plan.js";
import { runRoutedSolver } from "./routed-solver.js";
import { applyRepairKernelEffect } from "./supervised/repair-kernel-effect.js";
import { runBoundedRepairRounds } from "./supervised/repair-orchestrator.js";
import { supervisedEvidenceId } from "./supervised/supervised-verifier.js";

export interface JobCommandDependencies {
  readonly service: RuntimeService;
  readonly database: SqliteRuntimeDatabase;
  readonly missions: MissionRepositoryPort;
  readonly projects: ProjectRepositoryPort;
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
  readonly modelId: ModelId;
  readonly modelFactory: (projectId: ProjectId) => ModelGatewayPort;
  readonly verifierId: string;
  readonly verifierFactory: (projectId: ProjectId, jobId: string) => VerifierPort;
  readonly runtimeInstanceId: string;
  readonly reconcileInterrupted: boolean;
  readonly materializeCandidate?: (
    jobId: string,
    artifactId: string,
    context: Parameters<ModelGatewayPort["invoke"]>[1],
    workflowId: string,
    allowReplacement?: boolean,
  ) => Promise<void>;
  readonly prepareSoftwareJob?: (
    projectPath: string,
    projectId: ProjectId,
    jobId: string,
  ) => Promise<void>;
  readonly softwarePrompt?: (
    jobId: string,
    missionTitle: string,
    missionObjective: string,
  ) => Promise<string>;
  readonly softwareRepairRounds?: (jobId: string) => Promise<number>;
  readonly interruptAfterKernelEffect?: boolean;
  readonly interruptAfterRepairKernelEffect?: boolean;
}
/** Registers direct job commands whose external calls cannot run inside the command executor UoW. */
export function registerJobCommands(dependencies: JobCommandDependencies): void {
  registerJobStartCommand(dependencies);
  const {
    service,
    database,
    missions,
    jobs,
    eventBus,
    idempotency,
    kernel,
    clock,
    artifacts,
    candidates,
    evidence,
    workspaces,
    modelId,
    modelFactory,
    verifierId,
    verifierFactory,
    runtimeInstanceId,
    reconcileInterrupted,
    materializeCandidate,
    softwarePrompt,
    softwareRepairRounds,
    interruptAfterKernelEffect,
    interruptAfterRepairKernelEffect,
  } = dependencies;

  service.registerDirect("job.execute", async (payload, context) => {
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const cached = await idempotency.lookup(
      context.actor.id,
      context.idempotencyKey,
      "job.execute",
      payloadHash,
    );
    if (cached?.status === "completed") return cached.result as ApplicationJsonValue;

    const jobIdRaw = requireCommandId(asCommandObject(payload), "jobId");
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
      const executionStage = reconcileInterrupted ? `executing:${runtimeInstanceId}` : "executing";
      if (
        current.value.currentStage === "executing" ||
        current.value.currentStage === executionStage ||
        (current.value.currentStage.startsWith("executing:") && !reconcileInterrupted)
      ) {
        throw new ApplicationError("CONFLICT", "Job execution is already in progress.", {
          details: { jobId: jobIdRaw },
        });
      }
      const claim = Job.updateProgress(current.value, {
        eventId: `event-${randomUUID()}`,
        occurredAt: clock.now(),
        progress: current.value.progress,
        stage: executionStage,
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
    const modelGateway = modelFactory(projectId);
    const verifier = verifierFactory(projectId, jobIdRaw);
    let configuration: SolverConfiguration = createJobModelConfiguration(modelId);
    async function* textBytes(text: string): AsyncIterable<Uint8Array> {
      yield Buffer.from(text, "utf8");
    }
    const deterministic = reconcileInterrupted;
    const promptArtifactIdValue = deterministic
      ? `artifact-prompt-${stableDigest(jobIdRaw).slice(0, 32)}`
      : `artifact-${randomUUID()}`;
    const promptArtifactId = ArtifactId.parse(promptArtifactIdValue);
    if ((await artifacts.get(promptArtifactId, context)) === null) {
      const prompt =
        job.value.workflowId === "software.production.v1"
          ? await softwarePrompt?.(jobIdRaw, mission.value.title, mission.value.objective)
          : `${mission.value.title}\n${mission.value.objective}`;
      if (prompt === undefined) {
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Software production prompt materialization is unavailable.",
        );
      }
      await database.unitOfWork.execute(context, async (transaction) => {
        const artifact = await artifacts.write(
          {
            id: promptArtifactId,
            projectId,
            kind: "document",
            logicalPath: SafePath.parse(`job-${jobIdRaw}/prompt.txt`),
            mediaType: "text/plain",
            parentArtifactIds: [],
            bytes: textBytes(prompt),
          },
          context,
          transaction,
        );
        return artifact.value.id;
      });
    }

    const candidateId = deterministic
      ? `candidate-${stableDigest(jobIdRaw).slice(0, 32)}`
      : `candidate-${randomUUID()}`;
    let candidate = (await candidates.getCandidate(candidateId as never, context))?.value;
    if (candidate === undefined) {
      const routed = await runRoutedSolver(
        { unitOfWork: database.unitOfWork, candidates, models: modelGateway, workspaces },
        {
          jobId,
          missionId: job.value.missionId,
          projectId,
          promptArtifactId,
          candidateId,
          preferredModelId: modelId,
          invocationId: (index) =>
            deterministic
              ? `invocation-model-${stableDigest(`${jobIdRaw}:${index}`).slice(0, 32)}`
              : `invocation-${randomUUID()}`,
          createdAt: clock.now(),
          resourceBudget: mission.value.resourceBudget,
        },
        context,
      );
      candidate = routed.candidate;
      configuration = routed.configuration;
    } else {
      configuration = candidate.configuration;
    }
    if (candidate === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Solver forge produced no candidate.");
    }
    const plan = createJobVerificationPlan({
      job: job.value,
      mission: mission.value,
      candidate,
      verifierId,
      deterministic,
    });
    const existingEvidence = deterministic
      ? await evidence.getById(supervisedEvidenceId(plan.id, candidate.id) as never, context)
      : null;

    if (materializeCandidate !== undefined && existingEvidence === null) {
      const outputArtifactId = candidate.outputArtifactIds[0];
      if (outputArtifactId === undefined) {
        throw new ApplicationError("INTEGRITY_FAILURE", "Candidate has no kernel work product.");
      }
      await materializeCandidate(jobIdRaw, outputArtifactId, context, job.value.workflowId);
      let checkpointId = job.value.latestCheckpointId;
      if (checkpointId === undefined) {
        const artifact = await artifacts.get(outputArtifactId, context);
        if (artifact === null) {
          throw new ApplicationError("INTEGRITY_FAILURE", "Candidate artifact disappeared.");
        }
        const checkpoint = await checkpointJob(
          { unitOfWork: database.unitOfWork, jobs, events: eventBus, kernel, clock },
          {
            jobId,
            stage: `executing:${runtimeInstanceId}`,
            stateArtifactId: outputArtifactId,
            evidenceIds: [],
            contentHash: artifact.value.contentHash,
            verified: false,
            beginEventId: `event-${randomUUID()}`,
            recordedEventId: `event-${randomUUID()}`,
            failureEventId: `event-${randomUUID()}`,
          },
          context,
        );
        checkpointId = checkpoint.value.id;
      }
      const kernelState = await kernel.status(jobId, context);
      if (
        kernelState.checkpointId !== checkpointId ||
        (kernelState.status !== "paused" && kernelState.status !== "completed")
      ) {
        throw new ApplicationError(
          "DEPENDENCY_FAILURE",
          "Kernel state does not match the durable resume checkpoint.",
          { details: { jobId: jobIdRaw, kernelStatus: kernelState.status }, retryable: false },
        );
      }
      await kernel.resume(jobId, checkpointId, context);
      if (interruptAfterKernelEffect === true) {
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Controlled interruption after kernel effect.",
          {
            retryable: true,
          },
        );
      }
    }

    let verification: CandidateVerificationOutcome | undefined;
    if (existingEvidence !== null) {
      verification = {
        candidate,
        evidence: [existingEvidence.value],
        result: VerificationResult.calculate({
          id: `verification-${candidate.id}`,
          plan,
          completedChecks: [
            {
              checkId: plan.checks[0]?.id ?? "stage4.tiny-code.tests",
              status: existingEvidence.value.status,
              evidenceIds: [existingEvidence.value.id],
            },
          ],
        }),
      };
    } else {
      [verification] = await verifyCandidates(
        { unitOfWork: database.unitOfWork, evidence, verifier },
        [{ plan, candidate }],
        context,
      );
    }
    if (verification === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verification produced no outcome.");
    }
    const primaryCheck = plan.checks[0];
    if (primaryCheck === undefined) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verification plan has no check.");
    }
    if (
      verification.result.status !== "passed" &&
      job.value.workflowId === "software.production.v1" &&
      materializeCandidate !== undefined &&
      softwarePrompt !== undefined &&
      softwareRepairRounds !== undefined
    ) {
      const repaired = await runBoundedRepairRounds(
        {
          unitOfWork: database.unitOfWork,
          artifacts,
          candidates,
          evidence,
          models: modelGateway,
          verifier,
          workspaces,
          createBasePrompt: () =>
            softwarePrompt(jobIdRaw, mission.value.title, mission.value.objective),
          applyWorkProduct: (repairCandidate, round) =>
            applyRepairKernelEffect(
              {
                unitOfWork: database.unitOfWork,
                jobs,
                events: eventBus,
                kernel,
                clock,
                artifacts,
                materialize: materializeCandidate,
                runtimeInstanceId,
                ...(interruptAfterRepairKernelEffect === undefined
                  ? {}
                  : { interruptAfterEffect: interruptAfterRepairKernelEffect }),
              },
              jobId,
              repairCandidate,
              round,
              context,
            ),
        },
        {
          projectId,
          jobId,
          source: verification,
          configuration: { ...configuration, strategy: "failure_first" },
          check: primaryCheck,
          maxRepairRounds: Math.min(
            mission.value.resourceBudget.maxRepairRounds,
            await softwareRepairRounds(jobIdRaw),
          ),
          resourceBudget: mission.value.resourceBudget,
          createdAt: clock.now(),
        },
        context,
      );
      candidate = repaired.candidate;
      verification = repaired.verification;
    }
    const passed = verification.result.status === "passed";
    const existingDecision = deterministic
      ? await candidates.getChampionDecision(job.value.missionId, context)
      : null;
    const decision =
      existingDecision ??
      (await selectChampionUseCase(
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
      ));
    const receipt =
      decision.value.decision === "champion"
        ? ((deterministic
            ? await candidates.getDeliveryReceipt(job.value.missionId, context)
            : null) ??
          (await deliverResult(
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
          )))
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
