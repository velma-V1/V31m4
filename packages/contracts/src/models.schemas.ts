import { z } from "zod";
import { capabilityScoreSchema, solverConfigurationSchema } from "./capabilities.schemas.js";
import {
  adapterIdSchema,
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  canonicalNameSchema,
  canonicalStatementSchema,
  invocationIdSchema,
  isoDateTimeSchema,
  jobIdSchema,
  modelIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  safeJsonObjectSchema,
} from "./common.schemas.js";

export const profileAvailabilitySchema = z.enum(["available", "unavailable", "degraded"]);
export const modelModalitySchema = z.enum(["text", "image", "audio", "video", "embedding"]);

export const modelProfileSchema = z
  .object({
    modelId: modelIdSchema,
    adapterId: adapterIdSchema,
    displayName: canonicalNameSchema,
    status: profileAvailabilitySchema,
    local: z.boolean(),
    contextLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    measuredCapabilities: z.array(capabilityScoreSchema).max(10_000),
    supportedModalities: z.array(modelModalitySchema).min(1).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.measuredCapabilities.map((score) => score.capabilityId),
      context,
      ["measuredCapabilities"],
      "Measured capability IDs",
    );
    addDuplicateStringIssue(
      value.supportedModalities,
      context,
      ["supportedModalities"],
      "Supported modalities",
    );
  });

export const invokeModelRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    configuration: solverConfigurationSchema,
    promptArtifactId: artifactIdSchema,
  })
  .strict();

export const modelInvocationUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    wallClockMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const modelInvocationResultSchema = z
  .object({
    invocationId: invocationIdSchema,
    jobId: jobIdSchema,
    modelId: modelIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    responseArtifactId: artifactIdSchema.optional(),
    outputArtifactIds: z.array(artifactIdSchema).max(10_000),
    usage: modelInvocationUsageSchema,
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema,
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: canonicalStatementSchema,
        retryable: z.boolean(),
        details: safeJsonObjectSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "Model invocation completion cannot precede start.",
        path: ["completedAt"],
      });
    }
    if (value.status === "completed" && value.responseArtifactId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Completed model invocation requires a response artifact.",
        path: ["responseArtifactId"],
      });
    }
    if ((value.status === "failed") !== (value.error !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only failed model invocations carry an error.",
        path: ["error"],
      });
    }
    addDuplicateStringIssue(
      value.outputArtifactIds,
      context,
      ["outputArtifactIds"],
      "Output artifact IDs",
    );
  });

export const invokeModelResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    invocation: modelInvocationResultSchema,
  })
  .strict();

export const listModelsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    status: profileAvailabilitySchema.optional(),
    local: z.boolean().optional(),
    modality: modelModalitySchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listModelsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    models: z.array(modelProfileSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type ProfileAvailabilityPayload = z.infer<typeof profileAvailabilitySchema>;
export type ModelModalityPayload = z.infer<typeof modelModalitySchema>;
export type ModelProfilePayload = z.infer<typeof modelProfileSchema>;
export type InvokeModelRequest = z.infer<typeof invokeModelRequestSchema>;
export type ModelInvocationResultPayload = z.infer<typeof modelInvocationResultSchema>;
export type InvokeModelResponse = z.infer<typeof invokeModelResponseSchema>;
export type ListModelsRequest = z.infer<typeof listModelsRequestSchema>;
export type ListModelsResponse = z.infer<typeof listModelsResponseSchema>;
