import { z } from "zod";
import {
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  checkpointIdSchema,
  contentHashSchema,
  evidenceIdSchema,
  isoDateTimeSchema,
  jobIdSchema,
  missionIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  projectIdSchema,
  scoreSchema,
  workflowIdSchema,
} from "./common.schemas.js";

export const jobStatusSchema = z.enum([
  "created",
  "queued",
  "running",
  "checkpointing",
  "paused",
  "finish_stopping",
  "emergency_stopping",
  "completed",
  "failed",
  "cancelled",
]);

export const jobSchema = z
  .object({
    id: jobIdSchema,
    projectId: projectIdSchema,
    missionId: missionIdSchema,
    workflowId: workflowIdSchema,
    status: jobStatusSchema,
    currentStage: z
      .string()
      .min(1)
      .max(240)
      .refine((value) => value === value.trim(), "Job stage cannot contain outer whitespace."),
    progress: scoreSchema,
    latestCheckpointId: checkpointIdSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Job updatedAt cannot precede createdAt.",
        path: ["updatedAt"],
      });
    }
    if (value.status === "completed" && value.progress !== 1) {
      context.addIssue({
        code: "custom",
        message: "Completed jobs must report progress 1.",
        path: ["progress"],
      });
    }
    if (value.status === "checkpointing" && value.latestCheckpointId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Checkpointing jobs must identify the checkpoint being persisted.",
        path: ["latestCheckpointId"],
      });
    }
  });

export const checkpointSchema = z
  .object({
    id: checkpointIdSchema,
    jobId: jobIdSchema,
    stage: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) => value === value.trim(),
        "Checkpoint stage cannot contain outer whitespace.",
      ),
    stateArtifactId: artifactIdSchema,
    evidenceIds: z.array(evidenceIdSchema).max(10_000),
    contentHash: contentHashSchema,
    verified: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Checkpoint evidence IDs");
    if (value.verified && value.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Verified checkpoints require evidence.",
        path: ["evidenceIds"],
      });
    }
  });

export const startJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    missionId: missionIdSchema,
    workflowId: workflowIdSchema,
  })
  .strict();

export const startJobResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    job: jobSchema,
  })
  .strict();

export const getJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
  })
  .strict();

export const getJobResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    job: jobSchema,
    latestCheckpoint: checkpointSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.latestCheckpoint !== undefined &&
      value.job.latestCheckpointId !== value.latestCheckpoint.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Returned checkpoint must match the job latestCheckpointId.",
        path: ["latestCheckpoint"],
      });
    }
  });

export const pauseJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    expectedStatus: jobStatusSchema,
  })
  .strict();

export const resumeJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    checkpointId: checkpointIdSchema,
  })
  .strict();

export const checkpointJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    stage: z.string().min(1).max(240),
    stateArtifactId: artifactIdSchema,
    evidenceIds: z.array(evidenceIdSchema).max(10_000),
    contentHash: contentHashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Checkpoint evidence IDs");
  });

export const stopJobModeSchema = z.enum(["finish_and_stop", "emergency_stop"]);

export const stopJobRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    mode: stopJobModeSchema,
  })
  .strict();

export const stopJobResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    job: jobSchema,
    preservedCheckpointId: checkpointIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.job.status === "emergency_stopping" &&
      value.job.latestCheckpointId !== undefined &&
      value.preservedCheckpointId !== value.job.latestCheckpointId
    ) {
      context.addIssue({
        code: "custom",
        message: "Emergency-stop response must preserve the latest checkpoint.",
        path: ["preservedCheckpointId"],
      });
    }
  });

export const listJobsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema.optional(),
    missionId: missionIdSchema.optional(),
    status: jobStatusSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listJobsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    jobs: z.array(jobSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type JobStatusPayload = z.infer<typeof jobStatusSchema>;
export type JobPayload = z.infer<typeof jobSchema>;
export type CheckpointPayload = z.infer<typeof checkpointSchema>;
export type StartJobRequest = z.infer<typeof startJobRequestSchema>;
export type StartJobResponse = z.infer<typeof startJobResponseSchema>;
export type GetJobRequest = z.infer<typeof getJobRequestSchema>;
export type GetJobResponse = z.infer<typeof getJobResponseSchema>;
export type PauseJobRequest = z.infer<typeof pauseJobRequestSchema>;
export type ResumeJobRequest = z.infer<typeof resumeJobRequestSchema>;
export type CheckpointJobRequest = z.infer<typeof checkpointJobRequestSchema>;
export type StopJobMode = z.infer<typeof stopJobModeSchema>;
export type StopJobRequest = z.infer<typeof stopJobRequestSchema>;
export type StopJobResponse = z.infer<typeof stopJobResponseSchema>;
export type ListJobsRequest = z.infer<typeof listJobsRequestSchema>;
export type ListJobsResponse = z.infer<typeof listJobsResponseSchema>;
