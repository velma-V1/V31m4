import { z } from "zod";
import {
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  canonicalIdSchema,
  canonicalSummarySchema,
  hasUniqueStrings,
  isoDateTimeSchema,
  paginationRequestSchema,
  paginationResultSchema,
  safeJsonObjectSchema,
} from "./common.schemas.js";
import { pluginManifestContractSchema, pluginProfileSchema } from "./plugins.schemas.js";

export const approvalStatusSchema = z.enum(["pending", "granted", "denied", "expired", "consumed"]);

export const approvalActorSchema = z
  .object({
    id: canonicalIdSchema,
    kind: z.enum(["user", "system", "model", "plugin", "scheduler"]),
    roles: z.array(canonicalIdSchema).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueStrings(value.roles)) {
      context.addIssue({ code: "custom", message: "Actor roles must be unique.", path: ["roles"] });
    }
  });

export const approvalRequestSchema = z
  .object({
    id: canonicalIdSchema,
    action: canonicalIdSchema,
    resourceType: canonicalIdSchema,
    resourceId: canonicalIdSchema.optional(),
    requestedBy: approvalActorSchema,
    requiredScopes: z.array(canonicalIdSchema).max(128),
    context: safeJsonObjectSchema,
    status: approvalStatusSchema,
    requestedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    decidedBy: approvalActorSchema.optional(),
    decidedAt: isoDateTimeSchema.optional(),
    decisionReason: canonicalSummarySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueStrings(value.requiredScopes)) {
      context.addIssue({
        code: "custom",
        message: "Approval scopes must be unique.",
        path: ["requiredScopes"],
      });
    }
    if (Date.parse(value.expiresAt) <= Date.parse(value.requestedAt)) {
      context.addIssue({
        code: "custom",
        message: "Approval expiry must follow its request time.",
        path: ["expiresAt"],
      });
    }
    const hasDecision =
      value.decidedBy !== undefined ||
      value.decidedAt !== undefined ||
      value.decisionReason !== undefined;
    const requiresDecision = ["granted", "denied", "consumed"].includes(value.status);
    if (
      requiresDecision &&
      (value.decidedBy === undefined ||
        value.decidedAt === undefined ||
        value.decisionReason === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Decided and consumed approvals require complete decision metadata.",
        path: ["status"],
      });
    }
    if (!requiresDecision && hasDecision) {
      context.addIssue({
        code: "custom",
        message: "Pending and expired approvals cannot carry decision metadata.",
        path: ["status"],
      });
    }
    if (
      value.decidedAt !== undefined &&
      (Date.parse(value.decidedAt) < Date.parse(value.requestedAt) ||
        Date.parse(value.decidedAt) >= Date.parse(value.expiresAt))
    ) {
      context.addIssue({
        code: "custom",
        message: "Approval decision time must fall within its active interval.",
        path: ["decidedAt"],
      });
    }
  });

export const registerGovernedPluginRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    manifest: pluginManifestContractSchema,
    approvalId: canonicalIdSchema.optional(),
  })
  .strict();

const approvalRequiredResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    outcome: z.literal("approval_required"),
    approval: approvalRequestSchema,
  })
  .strict();

const pluginRegisteredResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    outcome: z.literal("registered"),
    plugin: pluginProfileSchema,
  })
  .strict();

export const registerGovernedPluginResponseSchema = z.discriminatedUnion("outcome", [
  approvalRequiredResponseSchema,
  pluginRegisteredResponseSchema,
]);

export const decideApprovalRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    approvalId: canonicalIdSchema,
    decision: z.enum(["grant", "deny"]),
    reason: canonicalSummarySchema,
  })
  .strict();

export const decideApprovalResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    approval: approvalRequestSchema,
  })
  .strict();

export const listApprovalsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    status: approvalStatusSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listApprovalsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    approvals: z.array(approvalRequestSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueStrings(value.approvals.map((approval) => approval.id))) {
      context.addIssue({
        code: "custom",
        message: "Approvals must be unique.",
        path: ["approvals"],
      });
    }
  });

export type ApprovalStatusPayload = z.infer<typeof approvalStatusSchema>;
export type ApprovalActorPayload = z.infer<typeof approvalActorSchema>;
export type ApprovalRequestPayload = z.infer<typeof approvalRequestSchema>;
export type RegisterGovernedPluginRequest = z.infer<typeof registerGovernedPluginRequestSchema>;
export type RegisterGovernedPluginResponse = z.infer<typeof registerGovernedPluginResponseSchema>;
export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;
export type DecideApprovalResponse = z.infer<typeof decideApprovalResponseSchema>;
export type ListApprovalsRequest = z.infer<typeof listApprovalsRequestSchema>;
export type ListApprovalsResponse = z.infer<typeof listApprovalsResponseSchema>;
