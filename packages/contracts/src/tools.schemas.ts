import { z } from "zod";
import {
  addDuplicateStringIssue,
  adapterIdSchema,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  canonicalIdSchema,
  canonicalNameSchema,
  canonicalStatementSchema,
  invocationIdSchema,
  isoDateTimeSchema,
  jobIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  safeJsonObjectSchema,
  semanticVersionSchema,
  toolIdSchema,
} from "./common.schemas.js";
import { profileAvailabilitySchema } from "./models.schemas.js";

export const toolAutomationMethodSchema = z.enum([
  "native_api",
  "python",
  "cli",
  "structured_file",
  "gui",
]);

export const toolProfileSchema = z
  .object({
    toolId: toolIdSchema,
    adapterId: adapterIdSchema,
    displayName: canonicalNameSchema,
    status: profileAvailabilitySchema,
    operations: z.array(canonicalIdSchema).min(1).max(1_000),
    installedVersion: semanticVersionSchema.optional(),
    automationMethod: toolAutomationMethodSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.operations, context, ["operations"], "Tool operations");
  });

export const invokeToolRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    jobId: jobIdSchema,
    toolId: toolIdSchema,
    operation: canonicalIdSchema,
    inputArtifactIds: z.array(artifactIdSchema).max(10_000),
    parameters: safeJsonObjectSchema,
    expectedOutputs: z.array(canonicalIdSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.inputArtifactIds, context, ["inputArtifactIds"], "Input artifact IDs");
    addDuplicateStringIssue(value.expectedOutputs, context, ["expectedOutputs"], "Expected outputs");
  });

export const toolInvocationResultSchema = z
  .object({
    invocationId: invocationIdSchema,
    jobId: jobIdSchema,
    toolId: toolIdSchema,
    operation: canonicalIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    outputArtifactIds: z.array(artifactIdSchema).max(10_000),
    logArtifactIds: z.array(artifactIdSchema).max(10_000),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema,
    exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
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
      context.addIssue({ code: "custom", message: "Tool invocation completion cannot precede start.", path: ["completedAt"] });
    }
    if ((value.status === "failed") !== (value.error !== undefined)) {
      context.addIssue({ code: "custom", message: "Only failed tool invocations carry an error.", path: ["error"] });
    }
    if (value.status === "completed" && value.outputArtifactIds.length === 0) {
      context.addIssue({ code: "custom", message: "Completed tool invocation requires output artifacts.", path: ["outputArtifactIds"] });
    }
    addDuplicateStringIssue(value.outputArtifactIds, context, ["outputArtifactIds"], "Output artifact IDs");
    addDuplicateStringIssue(value.logArtifactIds, context, ["logArtifactIds"], "Log artifact IDs");
  });

export const invokeToolResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    invocation: toolInvocationResultSchema,
  })
  .strict();

export const listToolsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    status: profileAvailabilitySchema.optional(),
    automationMethod: toolAutomationMethodSchema.optional(),
    operation: canonicalIdSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listToolsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    tools: z.array(toolProfileSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type ToolAutomationMethodPayload = z.infer<typeof toolAutomationMethodSchema>;
export type ToolProfilePayload = z.infer<typeof toolProfileSchema>;
export type InvokeToolRequest = z.infer<typeof invokeToolRequestSchema>;
export type ToolInvocationResultPayload = z.infer<typeof toolInvocationResultSchema>;
export type InvokeToolResponse = z.infer<typeof invokeToolResponseSchema>;
export type ListToolsRequest = z.infer<typeof listToolsRequestSchema>;
export type ListToolsResponse = z.infer<typeof listToolsResponseSchema>;
