import { Job, type JobId, type Job as JobType } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import type { JobRepositoryPort } from "../ports/job-repository.port.js";
import type { ProductionKernelPort } from "../ports/production-kernel.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { requireValue } from "./use-case-support.js";

export interface StopJobDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly jobs: JobRepositoryPort;
  readonly events: EventBusPort;
  readonly kernel: ProductionKernelPort;
  readonly clock: ClockPort;
}

export interface StopJobCommand {
  readonly jobId: JobId;
  readonly mode: "finish_and_stop" | "emergency_stop";
  readonly stopEventId: string;
  readonly failureEventId: string;
}

export async function stopJob(
  dependencies: StopJobDependencies,
  command: StopJobCommand,
  context: OperationContext,
): Promise<Versioned<JobType>> {
  const stored = await dependencies.unitOfWork.execute(context, async (transaction) => {
    const current = requireValue(
      await dependencies.jobs.getById(command.jobId, context, transaction),
      "Job does not exist.",
    );
    if (command.mode === "finish_and_stop") {
      requireValue(
        await dependencies.jobs.getLatestVerifiedCheckpoint(command.jobId, context, transaction),
        "Finish-stop requires a verified checkpoint.",
      );
    }
    const stopping =
      command.mode === "finish_and_stop"
        ? Job.beginFinishStop(current.value, {
            eventId: command.stopEventId,
            occurredAt: dependencies.clock.now(),
          })
        : Job.beginEmergencyStop(current.value, {
            eventId: command.stopEventId,
            occurredAt: dependencies.clock.now(),
          });
    const updated = await dependencies.jobs.save(
      stopping.job,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await dependencies.events.publish([stopping.event], context, transaction);
    return updated;
  });

  try {
    await dependencies.kernel.stop(command.jobId, command.mode, context);
    return stored;
  } catch (error) {
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      const current = requireValue(
        await dependencies.jobs.getById(command.jobId, context, transaction),
        "Stopping job disappeared after kernel failure.",
      );
      const failed = Job.fail(current.value, {
        eventId: command.failureEventId,
        occurredAt: dependencies.clock.now(),
        failureReason: error instanceof Error ? error.message : "Kernel stop failed.",
      });
      await dependencies.jobs.save(
        failed.job,
        WriteConditions.matchRevision(current.revision),
        context,
        transaction,
      );
      await dependencies.events.publish([failed.event], context, transaction);
    });
    throw new ApplicationError("DEPENDENCY_FAILURE", "Production kernel could not stop the job.", {
      cause: error,
    });
  }
}
