import { z } from "zod";
import {
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  canonicalIdSchema,
  capabilityIdSchema,
  evidenceIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  practiceTaskIdSchema,
  resourceBudgetSchema,
  safePathSchema,
} from "./common.schemas.js";

export const practiceTaskStatusSchema = z.enum([
  "planned",
  "running",
  "checkpointed",
  "completed",
  "stopped",
  "quarantined",
]);

export const practiceTaskSchema = z
  .object({
    id: practiceTaskIdSchema,
    capabilityId: capabilityIdSchema,
    targetDifficulty: z.number().finite().nonnegative().max(100),
    status: practiceTaskStatusSchema,
    workspaceId: canonicalIdSchema,
    isolatedWorkspacePath: safePathSchema,
    resourceBudget: resourceBudgetSchema,
    traceArtifactIds: z.array(artifactIdSchema).max(10_000),
    evidenceIds: z.array(evidenceIdSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.traceArtifactIds,
      context,
      ["traceArtifactIds"],
      "Trace artifact IDs",
    );
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Practice evidence IDs");
    if (
      (value.status === "completed" || value.status === "quarantined") &&
      value.evidenceIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed or quarantined practice tasks require verification evidence.",
        path: ["evidenceIds"],
      });
    }
    if (
      ["checkpointed", "completed", "quarantined"].includes(value.status) &&
      value.traceArtifactIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpointed and completed practice tasks require trace artifacts.",
        path: ["traceArtifactIds"],
      });
    }
  });

export const runPracticeRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    capabilityId: capabilityIdSchema.optional(),
    maximumDifficulty: z.number().finite().nonnegative().max(100).optional(),
  })
  .strict();

export const stopPracticeModeSchema = z.enum(["finish_and_stop", "emergency_stop"]);
export const stopPracticeRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    mode: stopPracticeModeSchema,
  })
  .strict();

export const practiceStateResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    activeTask: practiceTaskSchema.optional(),
    idleEligible: z.boolean(),
    idleDurationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const listPracticeTasksRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    capabilityId: capabilityIdSchema.optional(),
    status: practiceTaskStatusSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listPracticeTasksResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    tasks: z.array(practiceTaskSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type PracticeTaskStatusPayload = z.infer<typeof practiceTaskStatusSchema>;
export type PracticeTaskPayload = z.infer<typeof practiceTaskSchema>;
export type RunPracticeRequest = z.infer<typeof runPracticeRequestSchema>;
export type StopPracticeMode = z.infer<typeof stopPracticeModeSchema>;
export type StopPracticeRequest = z.infer<typeof stopPracticeRequestSchema>;
export type PracticeStateResponse = z.infer<typeof practiceStateResponseSchema>;
