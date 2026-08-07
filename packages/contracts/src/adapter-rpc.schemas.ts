import { z } from "zod";
import { solverConfigurationSchema } from "./capabilities.schemas.js";
import {
  adapterIdSchema,
  adapterProtocolVersionSchema,
  artifactIdSchema,
  canonicalIdSchema,
  canonicalStatementSchema,
  checkpointIdSchema,
  guardForbiddenKeys,
  invocationIdSchema,
  jobIdSchema,
  missionIdSchema,
  modelIdSchema,
  projectIdSchema,
  resourceBudgetSchema,
  runtimeIdSchema,
  safeJsonObjectSchema,
  safeJsonValueSchema,
  scoreSchema,
  toolIdSchema,
  workflowIdSchema,
} from "./common.schemas.js";

export const jsonRpcVersionSchema = z.literal("2.0");
export const rpcIdSchema = z.union([
  canonicalIdSchema,
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);

const rpcRequestBaseShape = {
  jsonrpc: jsonRpcVersionSchema,
  id: rpcIdSchema,
} as const;
const rpcNotificationBaseShape = {
  jsonrpc: jsonRpcVersionSchema,
} as const;

export const adapterInitializeRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("adapter.initialize"),
    params: z
      .object({
        protocolVersion: adapterProtocolVersionSchema,
        adapterId: adapterIdSchema,
        runtimeId: runtimeIdSchema,
        capabilities: z.array(canonicalIdSchema).min(1).max(10_000),
      })
      .strict()
      .superRefine((value, context) => {
        if (new Set(value.capabilities).size !== value.capabilities.length) {
          context.addIssue({
            code: "custom",
            message: "Adapter capabilities must be unique.",
            path: ["capabilities"],
          });
        }
      }),
  })
  .strict();

export const adapterHealthRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("adapter.health"),
    params: z.object({}).strict(),
  })
  .strict();

export const adapterCancelRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("adapter.cancel"),
    params: z.object({ invocationId: invocationIdSchema }).strict(),
  })
  .strict();

export const adapterShutdownRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("adapter.shutdown"),
    params: z.object({ reason: canonicalStatementSchema.optional() }).strict(),
  })
  .strict();

export const modelInvokeRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("model.invoke"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        modelId: modelIdSchema,
        promptArtifactId: artifactIdSchema,
        configuration: solverConfigurationSchema,
        resourceBudget: resourceBudgetSchema,
      })
      .strict(),
  })
  .strict();

export const toolInvokeRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("tool.invoke"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        toolId: toolIdSchema,
        operation: canonicalIdSchema,
        inputArtifactIds: z.array(artifactIdSchema).max(10_000),
        parameters: safeJsonObjectSchema,
        expectedOutputs: z.array(canonicalIdSchema).min(1).max(1_000),
        resourceBudget: resourceBudgetSchema,
      })
      .strict(),
  })
  .strict();

export const kernelStartJobRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("kernel.start_job"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        projectId: projectIdSchema,
        missionId: missionIdSchema,
        workflowId: workflowIdSchema,
        input: safeJsonObjectSchema,
        resourceBudget: resourceBudgetSchema,
      })
      .strict(),
  })
  .strict();

export const kernelCheckpointJobRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("kernel.checkpoint_job"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        stage: canonicalIdSchema,
      })
      .strict(),
  })
  .strict();

export const kernelResumeJobRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("kernel.resume_job"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        checkpointId: checkpointIdSchema,
      })
      .strict(),
  })
  .strict();

export const kernelStopJobRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("kernel.stop_job"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        mode: z.enum(["finish_and_stop", "emergency_stop"]),
      })
      .strict(),
  })
  .strict();

export const kernelJobStatusRpcRequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("kernel.job_status"),
    params: z.object({ jobId: jobIdSchema }).strict(),
  })
  .strict();

export const adapterRpcRequestSchema = z.discriminatedUnion("method", [
  adapterInitializeRequestSchema,
  adapterHealthRequestSchema,
  adapterCancelRequestSchema,
  adapterShutdownRequestSchema,
  modelInvokeRpcRequestSchema,
  toolInvokeRpcRequestSchema,
  kernelStartJobRpcRequestSchema,
  kernelCheckpointJobRpcRequestSchema,
  kernelResumeJobRpcRequestSchema,
  kernelStopJobRpcRequestSchema,
  kernelJobStatusRpcRequestSchema,
]);

export const adapterProgressNotificationSchema = z
  .object({
    ...rpcNotificationBaseShape,
    method: z.literal("adapter.progress"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        progress: scoreSchema,
        stage: canonicalIdSchema,
        message: canonicalStatementSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const adapterLogNotificationSchema = z
  .object({
    ...rpcNotificationBaseShape,
    method: z.literal("adapter.log"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        level: z.enum(["debug", "info", "warn", "error"]),
        message: canonicalStatementSchema,
        fields: safeJsonObjectSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const adapterRpcNotificationSchema = z.discriminatedUnion("method", [
  adapterProgressNotificationSchema,
  adapterLogNotificationSchema,
]);

export const rpcErrorCodeSchema = z
  .number()
  .int()
  .refine(
    (code) =>
      [-32700, -32600, -32601, -32602, -32603].includes(code) || (code >= -32099 && code <= -32000),
    "RPC error code must be a standard JSON-RPC code or V31M4 server error code.",
  );

export const adapterRpcErrorSchema = z
  .object({
    code: rpcErrorCodeSchema,
    message: canonicalStatementSchema,
    retryable: z.boolean(),
    data: safeJsonValueSchema.optional(),
  })
  .strict();

export const adapterRpcSuccessResponseSchema = z
  .object({
    jsonrpc: jsonRpcVersionSchema,
    id: rpcIdSchema,
    result: safeJsonValueSchema,
  })
  .strict();

export const adapterRpcErrorResponseSchema = z
  .object({
    jsonrpc: jsonRpcVersionSchema,
    id: rpcIdSchema.nullable(),
    error: adapterRpcErrorSchema,
  })
  .strict();

export const adapterRpcResponseSchema = z.union([
  adapterRpcSuccessResponseSchema,
  adapterRpcErrorResponseSchema,
]);

export const adapterRpcMessageSchema = guardForbiddenKeys(
  z.union([adapterRpcRequestSchema, adapterRpcNotificationSchema, adapterRpcResponseSchema]),
);

export type AdapterRpcRequest = z.infer<typeof adapterRpcRequestSchema>;
export type AdapterRpcNotification = z.infer<typeof adapterRpcNotificationSchema>;
export type AdapterRpcResponse = z.infer<typeof adapterRpcResponseSchema>;
export type AdapterRpcMessage = z.infer<typeof adapterRpcMessageSchema>;
