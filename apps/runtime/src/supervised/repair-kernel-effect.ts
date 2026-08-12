import {
  ApplicationError,
  type ArtifactStorePort,
  type ClockPort,
  checkpointJob,
  type EventBusPort,
  type JobRepositoryPort,
  type OperationContext,
  type ProductionKernelPort,
  type UnitOfWorkPort,
} from "@v31m4/application";
import type { JobId, SolverCandidate } from "@v31m4/domain";
import { stableDigest } from "../job-command-helpers.js";

export interface RepairKernelDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly jobs: JobRepositoryPort;
  readonly events: EventBusPort;
  readonly kernel: ProductionKernelPort;
  readonly clock: ClockPort;
  readonly artifacts: ArtifactStorePort;
  readonly materialize: (
    jobId: string,
    artifactId: string,
    context: OperationContext,
    workflowId: string,
    allowReplacement: boolean,
  ) => Promise<void>;
  readonly runtimeInstanceId: string;
  readonly interruptAfterEffect?: boolean;
}

/** Applies one repaired candidate through a durable kernel checkpoint, safely reusable on retry. */
export async function applyRepairKernelEffect(
  dependencies: RepairKernelDependencies,
  jobId: JobId,
  candidate: SolverCandidate,
  round: number,
  context: OperationContext,
): Promise<void> {
  const artifactId = candidate.outputArtifactIds[0];
  if (artifactId === undefined) {
    throw new ApplicationError("INTEGRITY_FAILURE", "Repair candidate has no work product.");
  }
  const artifact = await dependencies.artifacts.get(artifactId, context);
  if (artifact === null) {
    throw new ApplicationError("INTEGRITY_FAILURE", "Repair work product disappeared.");
  }
  await dependencies.materialize(
    String(jobId),
    artifactId,
    context,
    "software.production.v1",
    true,
  );
  const expectedCheckpoint = `checkpoint-${stableDigest(`${jobId}:${artifact.value.contentHash}`).slice(0, 32)}`;
  const storedJob = await dependencies.jobs.getById(jobId, context);
  if (storedJob === null)
    throw new ApplicationError("INTEGRITY_FAILURE", "Repair job disappeared.");
  let checkpointId = storedJob.value.latestCheckpointId;
  if (checkpointId !== expectedCheckpoint) {
    const checkpoint = await checkpointJob(
      {
        unitOfWork: dependencies.unitOfWork,
        jobs: dependencies.jobs,
        events: dependencies.events,
        kernel: dependencies.kernel,
        clock: dependencies.clock,
      },
      {
        jobId,
        stage: `repair:${round}:${dependencies.runtimeInstanceId}`,
        stateArtifactId: artifactId,
        evidenceIds: [],
        contentHash: artifact.value.contentHash,
        verified: false,
        beginEventId: `event-repair-begin-${stableDigest(`${jobId}:${round}`).slice(0, 32)}`,
        recordedEventId: `event-repair-recorded-${stableDigest(`${jobId}:${round}`).slice(0, 32)}`,
        failureEventId: `event-repair-failed-${stableDigest(`${jobId}:${round}`).slice(0, 32)}`,
      },
      context,
    );
    checkpointId = checkpoint.value.id;
  }
  const state = await dependencies.kernel.status(jobId, context);
  if (state.checkpointId !== checkpointId) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Kernel state does not match the durable repair checkpoint.",
      { retryable: false },
    );
  }
  if (state.status === "paused") {
    await dependencies.kernel.resume(jobId, checkpointId, context);
  } else if (state.status !== "completed") {
    throw new ApplicationError("DEPENDENCY_FAILURE", "Repair kernel is not resumable.", {
      details: { status: state.status },
      retryable: false,
    });
  }
  if (dependencies.interruptAfterEffect === true) {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Controlled interruption after repair kernel effect.",
      { retryable: true },
    );
  }
}
