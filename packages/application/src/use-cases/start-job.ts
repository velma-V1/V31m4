import {
  Job,
  type Job as JobType,
  type MissionId,
  type ProjectId,
  type ResourceBudget,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";
import type { JobRepositoryPort } from "../ports/job-repository.port.js";
import type { ProductionKernelPort } from "../ports/production-kernel.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { appendAudit, requireValue } from "./use-case-support.js";

export interface StartJobDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly jobs: JobRepositoryPort;
  readonly events: EventBusPort;
  readonly kernel: ProductionKernelPort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export interface StartJobCommand {
  readonly jobId: string;
  readonly projectId: ProjectId;
  readonly missionId: MissionId;
  readonly workflowId: string;
  readonly input: ApplicationJsonObject;
  readonly resourceBudget: ResourceBudget;
  readonly createdEventId: string;
  readonly queuedEventId: string;
  readonly startedEventId: string;
  readonly failureEventId: string;
  readonly auditId: string;
}

export async function startJob(
  dependencies: StartJobDependencies,
  command: StartJobCommand,
  context: OperationContext,
): Promise<Versioned<JobType>> {
  const created = Job.create({
    id: command.jobId,
    projectId: command.projectId,
    missionId: command.missionId,
    workflowId: command.workflowId,
    eventId: command.createdEventId,
    occurredAt: dependencies.clock.now(),
  });
  const queued = Job.queue(created.job, {
    eventId: command.queuedEventId,
    occurredAt: dependencies.clock.now(),
    stage: "queued",
  });
  await dependencies.unitOfWork.execute(context, async (transaction) => {
    const stored = await dependencies.jobs.save(
      queued.job,
      WriteConditions.mustNotExist(),
      context,
      transaction,
    );
    await dependencies.events.publish([created.event, queued.event], context, transaction);
    await appendAudit(
      dependencies.audit,
      dependencies.clock,
      {
        id: command.auditId,
        action: "job.start",
        resourceType: "job",
        resourceId: queued.job.id,
        outcome: "accepted",
        details: { workflowId: command.workflowId, revision: stored.revision },
      },
      context,
      transaction,
    );
  });

  try {
    await dependencies.kernel.start(
      {
        jobId: queued.job.id,
        projectId: queued.job.projectId,
        missionId: queued.job.missionId,
        workflowId: queued.job.workflowId,
        input: command.input,
        resourceBudget: command.resourceBudget,
      },
      context,
    );
  } catch (error) {
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      const current = requireValue(
        await dependencies.jobs.getById(queued.job.id, context, transaction),
        "Queued job disappeared after kernel failure.",
      );
      const failed = Job.fail(current.value, {
        eventId: command.failureEventId,
        occurredAt: dependencies.clock.now(),
        failureReason: error instanceof Error ? error.message : "Kernel start failed.",
      });
      await dependencies.jobs.save(
        failed.job,
        WriteConditions.matchRevision(current.revision),
        context,
        transaction,
      );
      await dependencies.events.publish([failed.event], context, transaction);
    });
    throw new ApplicationError("DEPENDENCY_FAILURE", "Production kernel could not start the job.", {
      cause: error,
    });
  }

  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const current = requireValue(
      await dependencies.jobs.getById(queued.job.id, context, transaction),
      "Queued job disappeared after kernel acceptance.",
    );
    const running = Job.start(current.value, {
      eventId: command.startedEventId,
      occurredAt: dependencies.clock.now(),
      stage: "running",
    });
    const stored = await dependencies.jobs.save(
      running.job,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await dependencies.events.publish([running.event], context, transaction);
    return stored;
  });
}
