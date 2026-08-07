import {
  type ArtifactId,
  Checkpoint,
  type ContentHash,
  type EvidenceId,
  Job,
  type JobId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import type { JobRepositoryPort } from "../ports/job-repository.port.js";
import type { ProductionKernelPort } from "../ports/production-kernel.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { requireValue } from "./use-case-support.js";

export interface CheckpointJobDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly jobs: JobRepositoryPort;
  readonly events: EventBusPort;
  readonly kernel: ProductionKernelPort;
  readonly clock: ClockPort;
}

export interface CheckpointJobCommand {
  readonly jobId: JobId;
  readonly stage: string;
  readonly stateArtifactId: ArtifactId;
  readonly evidenceIds: readonly EvidenceId[];
  readonly contentHash: ContentHash;
  readonly verified: boolean;
  readonly beginEventId: string;
  readonly recordedEventId: string;
  readonly failureEventId: string;
}

export async function checkpointJob(
  dependencies: CheckpointJobDependencies,
  command: CheckpointJobCommand,
  context: OperationContext,
): Promise<Versioned<ReturnType<typeof Checkpoint.create>>> {
  await dependencies.unitOfWork.execute(context, async (transaction) => {
    const current = requireValue(
      await dependencies.jobs.getById(command.jobId, context, transaction),
      "Job does not exist.",
    );
    const transitioning = Job.beginCheckpoint(current.value, {
      eventId: command.beginEventId,
      occurredAt: dependencies.clock.now(),
      stage: command.stage,
    });
    await dependencies.jobs.save(
      transitioning.job,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await dependencies.events.publish([transitioning.event], context, transaction);
  });

  let checkpointId: string;
  try {
    checkpointId = await dependencies.kernel.checkpoint(command.jobId, context);
  } catch (error) {
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      const current = requireValue(
        await dependencies.jobs.getById(command.jobId, context, transaction),
        "Checkpointing job disappeared.",
      );
      const failed = Job.fail(current.value, {
        eventId: command.failureEventId,
        occurredAt: dependencies.clock.now(),
        failureReason: error instanceof Error ? error.message : "Kernel checkpoint failed.",
      });
      await dependencies.jobs.save(
        failed.job,
        WriteConditions.matchRevision(current.revision),
        context,
        transaction,
      );
      await dependencies.events.publish([failed.event], context, transaction);
    });
    throw new ApplicationError("DEPENDENCY_FAILURE", "Kernel checkpoint failed.", { cause: error });
  }

  const checkpoint = Checkpoint.create({
    id: checkpointId,
    jobId: command.jobId,
    stage: command.stage,
    stateArtifactId: command.stateArtifactId,
    evidenceIds: command.evidenceIds,
    contentHash: command.contentHash,
    verified: command.verified,
    createdAt: dependencies.clock.now(),
  });
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const current = requireValue(
      await dependencies.jobs.getById(command.jobId, context, transaction),
      "Checkpointing job disappeared.",
    );
    const recorded = Job.recordCheckpoint(current.value, {
      eventId: command.recordedEventId,
      occurredAt: dependencies.clock.now(),
      checkpointId,
      stage: command.stage,
    });
    const stored = await dependencies.jobs.appendCheckpoint(checkpoint, context, transaction);
    await dependencies.jobs.save(
      recorded.job,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await dependencies.events.publish([recorded.event], context, transaction);
    return stored;
  });
}
