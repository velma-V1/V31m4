import { assertDomain } from "../domain-errors.js";
import { createDomainEvent, type DomainEvent } from "../domain-events.js";
import {
  CheckpointId,
  JobId,
  MissionId,
  ProjectId,
  type CheckpointId as CheckpointIdType,
  type JobId as JobIdType,
  type MissionId as MissionIdType,
  type ProjectId as ProjectIdType,
} from "../value-objects/ids.js";

export type JobStatus =
  | "created"
  | "queued"
  | "running"
  | "checkpointing"
  | "paused"
  | "finish_stopping"
  | "emergency_stopping"
  | "completed"
  | "failed"
  | "cancelled";

export interface Job {
  readonly id: JobIdType;
  readonly projectId: ProjectIdType;
  readonly missionId: MissionIdType;
  readonly workflowId: string;
  readonly status: JobStatus;
  readonly currentStage: string;
  readonly progress: number;
  readonly latestCheckpointId?: CheckpointIdType;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobTransitionResult {
  readonly job: Job;
  readonly event: DomainEvent;
}

export interface CreateJobInput {
  readonly id: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly workflowId: string;
  readonly eventId: string;
  readonly occurredAt: string;
}

export interface JobTransitionContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly stage?: string;
  readonly checkpointId?: string;
  readonly progress?: number;
  readonly failureReason?: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TERMINAL = new Set<JobStatus>(["completed", "failed", "cancelled"]);

function validateTimestamp(value: string): number {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_JOB",
    "Job timestamps must be canonical UTC ISO-8601 with milliseconds.",
    { value },
  );
  return parsed;
}

function validateStage(value: string): string {
  assertDomain(
    value.length > 0 && value === value.trim() && value.length <= 240,
    "INVALID_JOB",
    "Job stage must be canonical and contain between 1 and 240 characters.",
    { value },
  );
  return value;
}

function validateProgress(value: number): number {
  assertDomain(
    Number.isFinite(value) && value >= 0 && value <= 1,
    "INVALID_JOB",
    "Job progress must be between 0 and 1.",
    { value },
  );
  return value;
}

function performTransition(
  job: Job,
  targetStatus: JobStatus,
  allowed: readonly JobStatus[],
  context: JobTransitionContext,
  eventType: string,
): JobTransitionResult {
  assertDomain(
    allowed.includes(job.status),
    "INVALID_STATE_TRANSITION",
    `Job cannot transition from ${job.status} to ${targetStatus}.`,
    { currentStatus: job.status, targetStatus },
  );
  assertDomain(
    !TERMINAL.has(job.status),
    "INVALID_STATE_TRANSITION",
    "Terminal jobs cannot transition.",
    { currentStatus: job.status },
  );
  const occurredAt = validateTimestamp(context.occurredAt);
  assertDomain(
    occurredAt >= validateTimestamp(job.updatedAt),
    "INVALID_STATE_TRANSITION",
    "Job update time cannot move backward.",
  );

  const next: Job = Object.freeze({
    ...job,
    status: targetStatus,
    currentStage: context.stage === undefined ? job.currentStage : validateStage(context.stage),
    progress: context.progress === undefined ? job.progress : validateProgress(context.progress),
    ...(context.checkpointId === undefined
      ? {}
      : { latestCheckpointId: CheckpointId.parse(context.checkpointId) }),
    updatedAt: context.occurredAt,
  });

  const payload = {
    previousStatus: job.status,
    currentStatus: targetStatus,
    currentStage: next.currentStage,
    progress: next.progress,
    ...(next.latestCheckpointId === undefined ? {} : { checkpointId: next.latestCheckpointId }),
    ...(context.failureReason === undefined ? {} : { failureReason: context.failureReason }),
  };

  return Object.freeze({
    job: next,
    event: createDomainEvent({
      id: context.eventId,
      type: eventType,
      aggregateType: "job",
      aggregateId: job.id,
      occurredAt: context.occurredAt,
      payload,
    }),
  });
}

export const Job = Object.freeze({
  create(input: CreateJobInput): JobTransitionResult {
    validateTimestamp(input.occurredAt);
    const workflowId = validateStage(input.workflowId);
    const job: Job = Object.freeze({
      id: JobId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      missionId: MissionId.parse(input.missionId),
      workflowId,
      status: "created",
      currentStage: "created",
      progress: 0,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    });
    return Object.freeze({
      job,
      event: createDomainEvent({
        id: input.eventId,
        type: "job.created",
        aggregateType: "job",
        aggregateId: job.id,
        occurredAt: input.occurredAt,
        payload: { status: job.status, workflowId },
      }),
    });
  },

  queue(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "queued", ["created"], context, "job.queued");
  },

  start(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "running", ["queued"], context, "job.started");
  },

  resume(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "running", ["paused"], context, "job.resumed");
  },

  updateProgress(job: Job, context: JobTransitionContext & { readonly progress: number }): JobTransitionResult {
    return performTransition(job, job.status, ["running", "checkpointing"], context, "job.progressed");
  },

  beginCheckpoint(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "checkpointing", ["running"], context, "job.checkpointing");
  },

  recordCheckpoint(
    job: Job,
    context: JobTransitionContext & { readonly checkpointId: string },
  ): JobTransitionResult {
    return performTransition(job, "running", ["checkpointing"], context, "job.checkpointed");
  },

  pause(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "paused", ["running"], context, "job.paused");
  },

  beginFinishStop(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(
      job,
      "finish_stopping",
      ["running", "paused", "checkpointing"],
      context,
      "job.finish_stopping",
    );
  },

  beginEmergencyStop(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(
      job,
      "emergency_stopping",
      ["created", "queued", "running", "checkpointing", "paused", "finish_stopping"],
      context,
      "job.emergency_stopping",
    );
  },

  complete(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(
      job,
      "completed",
      ["running", "finish_stopping"],
      { ...context, progress: 1 },
      "job.completed",
    );
  },

  fail(
    job: Job,
    context: JobTransitionContext & { readonly failureReason: string },
  ): JobTransitionResult {
    assertDomain(
      context.failureReason.length > 0 && context.failureReason === context.failureReason.trim(),
      "INVALID_JOB",
      "Failure reason must be canonical and non-empty.",
    );
    return performTransition(
      job,
      "failed",
      ["created", "queued", "running", "checkpointing", "paused", "finish_stopping", "emergency_stopping"],
      context,
      "job.failed",
    );
  },

  cancel(job: Job, context: JobTransitionContext): JobTransitionResult {
    return performTransition(job, "cancelled", ["created", "queued", "paused", "emergency_stopping"], context, "job.cancelled");
  },
});
