import {
  SandboxId,
  type SandboxId as SandboxIdType,
  TaskId,
  type TaskId as TaskIdType,
} from "@v31m4/domain";
import { z } from "zod";
import {
  adapterLogNotificationSchema,
  adapterProgressNotificationSchema,
  adapterRpcResponseSchema,
  jsonRpcVersionSchema,
  rpcIdSchema,
} from "./adapter-rpc.schemas.js";
import {
  ADAPTER_PROTOCOL_VERSION,
  adapterIdSchema,
  artifactIdSchema,
  canonicalIdSchema,
  guardForbiddenKeys,
  invocationIdSchema,
  jobIdSchema,
  resourceBudgetSchema,
  runtimeIdSchema,
  safeJsonObjectSchema,
  toolIdSchema,
} from "./common.schemas.js";

/**
 * Adapter protocol 1.1 — additive, separately negotiated, and side by side with 1.0.
 *
 * `docs/contract-versioning.md` forbids silent coercion and forbids adding fields to a
 * published strict schema. Nothing in this module mutates `adapter-rpc.schemas.ts`: the
 * 1.0 constant, method union, and per-method shapes remain exactly as published, and a 1.0
 * parser still rejects every construct defined here.
 *
 * 1.1 exists because strict 1.0 cannot express task/workspace/sandbox scope for a governed
 * semantic operation. Autonomous agent-turn and embedding capabilities are deliberately not
 * defined here; they belong to their own later program phases.
 */
export const ADAPTER_PROTOCOL_VERSION_1_1 = "1.1.0" as const;

/** Exact versions this runtime speaks, most preferred first. */
export const SUPPORTED_ADAPTER_PROTOCOL_VERSIONS = Object.freeze([
  ADAPTER_PROTOCOL_VERSION_1_1,
  ADAPTER_PROTOCOL_VERSION,
] as const);

export type SupportedAdapterProtocolVersion = (typeof SUPPORTED_ADAPTER_PROTOCOL_VERSIONS)[number];

export const adapterProtocolVersion1_1Schema = z.literal(ADAPTER_PROTOCOL_VERSION_1_1);
export const supportedAdapterProtocolVersionSchema = z.enum([
  ADAPTER_PROTOCOL_VERSION_1_1,
  ADAPTER_PROTOCOL_VERSION,
]);

export const taskIdSchema = z.custom<TaskIdType>((value) => TaskId.is(value), {
  message: "Invalid TaskId.",
});
export const sandboxIdSchema = z.custom<SandboxIdType>((value) => SandboxId.is(value), {
  message: "Invalid SandboxId.",
});

/**
 * Syntax of a V31M4 semantic operation ID (`repo.search`, `code.patch`, ...). The closed set
 * of operations is owned by the runtime `SemanticOperationDefinition` registry; duplicating
 * that list here would create a second source of truth, so the wire contract validates form
 * only and the registry rejects any unknown operation.
 */
export const semanticOperationIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
    "Semantic operation ID must be a lowercase `group.operation` pair.",
  );

/** Opaque workspace identifier assigned by `WorkspaceManagerPort`; never a host path. */
export const workspaceScopeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, "Workspace ID must use canonical opaque syntax.");

const rpcRequestBaseShape = {
  jsonrpc: jsonRpcVersionSchema,
  id: rpcIdSchema,
} as const;

export const adapterInitializeV1_1RequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("adapter.initialize"),
    params: z
      .object({
        protocolVersion: adapterProtocolVersion1_1Schema,
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

/**
 * Task/workspace/sandbox/semantic-operation-scoped tool invocation. The 1.0 `tool.invoke`
 * method keeps its exact published shape; this is a distinct method so a 1.0 peer rejects it
 * rather than partially understanding it.
 */
export const toolInvokeScopedV1_1RequestSchema = z
  .object({
    ...rpcRequestBaseShape,
    method: z.literal("tool.invoke_scoped"),
    params: z
      .object({
        invocationId: invocationIdSchema,
        jobId: jobIdSchema,
        taskId: taskIdSchema,
        workspaceId: workspaceScopeIdSchema,
        sandboxId: sandboxIdSchema,
        toolId: toolIdSchema,
        operation: semanticOperationIdSchema,
        inputArtifactIds: z.array(artifactIdSchema).max(10_000),
        parameters: safeJsonObjectSchema,
        expectedOutputs: z.array(canonicalIdSchema).min(1).max(1_000),
        resourceBudget: resourceBudgetSchema,
      })
      .strict(),
  })
  .strict();

/**
 * Scoped-invocation result. The status union deliberately matches the immutable public v1
 * tool status: an unreconciled effect is internal Sandbox/Ledger state and must never travel
 * as a fourth wire status.
 */
export const toolInvokeScopedV1_1ResultSchema = z
  .object({
    invocationId: invocationIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    outputArtifactIds: z.array(artifactIdSchema).max(10_000),
    logArtifactIds: z.array(artifactIdSchema).max(10_000),
    exitCode: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    metadata: safeJsonObjectSchema,
  })
  .strict();

export const adapterRpcV1_1RequestSchema = z.discriminatedUnion("method", [
  adapterInitializeV1_1RequestSchema,
  toolInvokeScopedV1_1RequestSchema,
]);

export const adapterRpcV1_1NotificationSchema = z.discriminatedUnion("method", [
  adapterProgressNotificationSchema,
  adapterLogNotificationSchema,
]);

export const adapterRpcV1_1MessageSchema = guardForbiddenKeys(
  z.union([
    adapterRpcV1_1RequestSchema,
    adapterRpcV1_1NotificationSchema,
    adapterRpcResponseSchema,
  ]),
);

export function isAdapterProtocolVersionSupported(
  version: string,
): version is SupportedAdapterProtocolVersion {
  return (SUPPORTED_ADAPTER_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function assertAdapterProtocolVersionSupported(
  version: string,
): asserts version is SupportedAdapterProtocolVersion {
  if (!isAdapterProtocolVersionSupported(version)) {
    throw new Error(
      `Unsupported adapter protocol version ${JSON.stringify(version)}; expected one of ${SUPPORTED_ADAPTER_PROTOCOL_VERSIONS.join(", ")}.`,
    );
  }
}

/**
 * Explicit negotiation: picks the highest exact version both peers speak. There is no
 * range matching, no prerelease tolerance, and no fallback to "closest" — an unsupported
 * offer is rejected, never coerced.
 */
export function negotiateAdapterProtocolVersion(
  offeredVersions: readonly string[],
): SupportedAdapterProtocolVersion {
  for (const supported of SUPPORTED_ADAPTER_PROTOCOL_VERSIONS) {
    if (offeredVersions.includes(supported)) {
      return supported;
    }
  }
  throw new Error(
    `Unsupported adapter protocol offer ${JSON.stringify(offeredVersions)}; no mutually supported version among ${SUPPORTED_ADAPTER_PROTOCOL_VERSIONS.join(", ")}.`,
  );
}

export type AdapterInitializeV1_1Request = z.infer<typeof adapterInitializeV1_1RequestSchema>;
export type ToolInvokeScopedV1_1Request = z.infer<typeof toolInvokeScopedV1_1RequestSchema>;
export type ToolInvokeScopedV1_1Result = z.infer<typeof toolInvokeScopedV1_1ResultSchema>;
export type AdapterRpcV1_1Request = z.infer<typeof adapterRpcV1_1RequestSchema>;
export type AdapterRpcV1_1Message = z.infer<typeof adapterRpcV1_1MessageSchema>;
