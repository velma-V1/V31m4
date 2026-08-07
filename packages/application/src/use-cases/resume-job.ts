import { type CheckpointId, Job, type JobId, type Job as JobType } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import type { JobRepositoryPort } from "../ports/job-repository.port.js";
import type { ProductionKernelPort } from "../ports/production-kernel.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { requireValue } from "./use-case-support.js";

export interface ResumeJobDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly jobs: JobRepositoryPort;
  readonly events: EventBusPort;
  readonly kernel: ProductionKernelPort;
  readonly clock: ClockPort;
}

export interface ResumeJobCommand {
  readonly jobId: JobId;
  readonly checkpointId?: CheckpointId;
  readonly resumedEventId: string;
  readonly failureEventId: string;
}

export async function resumeJob(
  dependencies: ResumeJobDependencies,
  command: ResumeJobCommand,
  context: OperationContext,
): Promise<Versioned<JobType>> {
  const prepared = await dependencies.unitOfWork.execute(context, async (transaction) => {
    const current = requireValue(
      await dependencies.jobs.getById(command.jobId, context, transaction),
      "Job does not exist.",
    );
    const checkpoint =
      command.checkpointId === undefined
        ? requireValue(
            await dependencies.jobs.getLatestVerifiedCheckpoint(
              command.jobId,
              context,
              transaction,
            ),
            "No verified checkpoint is available.",
          )
        : requireValue(
            await dependencies.jobs.getCheckpoint(command.checkpointId, context, transaction),
            "Checkpoint does not exist.",
          );
    if (!checkpoint.value.verified || checkpoint.value.jobId !== command.jobId) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "Resume requires a verified checkpoint belonging to the requested job.",
      );
    }
    const resumed = Job.resume(current.value, {
      eventId: command.resumedEventId,
      occurredAt: dependencies.clock.now(),
      checkpointId: checkpoint.value.id,
      stage: checkpoint.value.stage,
    });
    const stored = await dependencies.jobs.save(
      resumed.job,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await dependencies.events.publish([resumed.event], context, transaction);
    return Object.freeze({ stored, checkpointId: checkpoint.value.id });
  });

  try {
    await dependencies.kernel.resume(command.jobId, prepared.checkpointId, context);
    return prepared.stored;
  } catch (error) {
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      const current = requireValue(
        await dependencies.jobs.getById(command.jobId, context, transaction),
        "Resumed job disappeared after kernel failure.",
      );
      const failed = Job.fail(current.value, {
        eventId: command.failureEventId,
        occurredAt: dependencies.clock.now(),
        failureReason: error instanceof Error ? error.message : "Kernel resume failed.",
      });
      await dependencies.jobs.save(
        failed.job,
        WriteConditions.matchRevision(current.revision),
        context,
        transaction,
      );
      await dependencies.events.publish([failed.event], context, transaction);
    });
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Production kernel could not resume the job.",
      { cause: error },
    );
  }
}
