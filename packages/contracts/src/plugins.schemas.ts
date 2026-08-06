import { z } from "zod";
import {
  addDuplicateStringIssue,
  type ContractRefinementContext,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  capabilityIdSchema,
  canonicalIdSchema,
  canonicalNameSchema,
  contractVersionSchema,
  paginationRequestSchema,
  paginationResultSchema,
  pluginIdSchema,
  safePathSchema,
  schemaReferenceSchema,
  semanticVersionSchema,
  toolIdSchema,
  verifierIdSchema,
  workflowIdSchema,
} from "./common.schemas.js";

export const pluginStatusSchema = z.enum(["registered", "active", "inactive", "failed"]);

export const filesystemPermissionSchema = z.enum([
  "project_read",
  "working_copy_write",
  "artifact_read",
  "artifact_write",
  "cache_read",
  "cache_write",
]);

export const pluginPermissionsSchema = z
  .object({
    filesystem: z.array(filesystemPermissionSchema).max(16),
    network: z.boolean(),
    process: z.array(canonicalIdSchema).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.filesystem, context, ["filesystem"], "Filesystem permissions");
    addDuplicateStringIssue(value.process, context, ["process"], "Process permissions");
  });

export const workflowStageSchema = z
  .object({
    id: canonicalIdSchema,
    capabilityId: capabilityIdSchema,
    dependsOn: z.array(canonicalIdSchema).max(1_000),
    timeoutMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxAttempts: z.number().int().min(1).max(100),
    checkpoint: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.dependsOn, context, ["dependsOn"], "Workflow dependencies");
    if (value.dependsOn.includes(value.id)) {
      context.addIssue({ code: "custom", message: "Workflow stage cannot depend on itself.", path: ["dependsOn"] });
    }
  });

function validateWorkflowGraph(
  stages: readonly z.infer<typeof workflowStageSchema>[],
  context: ContractRefinementContext,
): void {
  const stageIds = stages.map((stage) => stage.id);
  addDuplicateStringIssue(stageIds, context, ["stages"], "Workflow stage IDs");
  const known = new Set(stageIds);
  for (const [stageIndex, stage] of stages.entries()) {
    for (const [dependencyIndex, dependency] of stage.dependsOn.entries()) {
      if (!known.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: "Workflow dependency references an unknown stage.",
          path: ["stages", stageIndex, "dependsOn", dependencyIndex],
        });
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  function visit(stageId: string): boolean {
    const current = state.get(stageId);
    if (current === "visiting") {
      return false;
    }
    if (current === "visited") {
      return true;
    }
    state.set(stageId, "visiting");
    const stage = byId.get(stageId);
    if (stage !== undefined) {
      for (const dependency of stage.dependsOn) {
        if (byId.has(dependency) && !visit(dependency)) {
          return false;
        }
      }
    }
    state.set(stageId, "visited");
    return true;
  }

  for (const stageId of stageIds) {
    if (!visit(stageId)) {
      context.addIssue({ code: "custom", message: "Workflow dependency graph must be acyclic.", path: ["stages"] });
      break;
    }
  }
}

export const workflowDefinitionSchema = z
  .object({
    schemaVersion: contractVersionSchema,
    workflowId: workflowIdSchema,
    version: semanticVersionSchema,
    displayName: canonicalNameSchema,
    inputSchemaRef: schemaReferenceSchema,
    outputSchemaRef: schemaReferenceSchema,
    stages: z.array(workflowStageSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => validateWorkflowGraph(value.stages, context));

export const pluginManifestContractSchema = z
  .object({
    schemaVersion: contractVersionSchema,
    pluginId: pluginIdSchema,
    displayName: canonicalNameSchema,
    version: semanticVersionSchema,
    minimumRuntimeVersion: semanticVersionSchema,
    entrypoint: safePathSchema,
    capabilities: z.array(capabilityIdSchema).min(1).max(10_000),
    requiredToolIds: z.array(toolIdSchema).max(10_000),
    optionalToolIds: z.array(toolIdSchema).max(10_000),
    workflowIds: z.array(workflowIdSchema).max(10_000),
    verifierIds: z.array(verifierIdSchema).max(10_000),
    permissions: pluginPermissionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values, label] of [
      ["capabilities", value.capabilities, "Capabilities"],
      ["requiredToolIds", value.requiredToolIds, "Required tool IDs"],
      ["optionalToolIds", value.optionalToolIds, "Optional tool IDs"],
      ["workflowIds", value.workflowIds, "Workflow IDs"],
      ["verifierIds", value.verifierIds, "Verifier IDs"],
    ] as const) {
      addDuplicateStringIssue(values, context, [path], label);
    }
    const required = new Set(value.requiredToolIds);
    if (value.optionalToolIds.some((toolId) => required.has(toolId))) {
      context.addIssue({
        code: "custom",
        message: "A tool cannot be both required and optional.",
        path: ["optionalToolIds"],
      });
    }
  });

export const pluginProfileSchema = z
  .object({
    pluginId: pluginIdSchema,
    version: semanticVersionSchema,
    status: pluginStatusSchema,
    capabilities: z.array(capabilityIdSchema).min(1).max(10_000),
    requiredToolIds: z.array(toolIdSchema).max(10_000),
    optionalToolIds: z.array(toolIdSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.capabilities, context, ["capabilities"], "Capabilities");
    addDuplicateStringIssue(value.requiredToolIds, context, ["requiredToolIds"], "Required tool IDs");
    addDuplicateStringIssue(value.optionalToolIds, context, ["optionalToolIds"], "Optional tool IDs");
    const required = new Set(value.requiredToolIds);
    if (value.optionalToolIds.some((toolId) => required.has(toolId))) {
      context.addIssue({ code: "custom", message: "Tool requirement sets must be disjoint.", path: ["optionalToolIds"] });
    }
  });

export const registerPluginRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    manifestPath: safePathSchema,
  })
  .strict();

export const registerPluginResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    plugin: pluginProfileSchema,
  })
  .strict();

export const setPluginStatusRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    pluginId: pluginIdSchema,
    action: z.enum(["activate", "deactivate"]),
  })
  .strict();

export const listPluginsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    status: pluginStatusSchema.optional(),
    capabilityId: capabilityIdSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listPluginsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    plugins: z.array(pluginProfileSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type PluginStatusPayload = z.infer<typeof pluginStatusSchema>;
export type PluginPermissionsPayload = z.infer<typeof pluginPermissionsSchema>;
export type WorkflowStagePayload = z.infer<typeof workflowStageSchema>;
export type WorkflowDefinitionPayload = z.infer<typeof workflowDefinitionSchema>;
export type PluginManifestContractPayload = z.infer<typeof pluginManifestContractSchema>;
export type PluginProfilePayload = z.infer<typeof pluginProfileSchema>;
export type RegisterPluginRequest = z.infer<typeof registerPluginRequestSchema>;
export type RegisterPluginResponse = z.infer<typeof registerPluginResponseSchema>;
export type SetPluginStatusRequest = z.infer<typeof setPluginStatusRequestSchema>;
export type ListPluginsRequest = z.infer<typeof listPluginsRequestSchema>;
export type ListPluginsResponse = z.infer<typeof listPluginsResponseSchema>;
