import { z } from "zod";
import {
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  canonicalIdSchema,
  canonicalStatementSchema,
  canonicalSummarySchema,
  claimIdSchema,
  contentHashSchema,
  evidenceIdSchema,
  hasUniqueStrings,
  isoDateTimeSchema,
  jobIdSchema,
  mediaTypeSchema,
  paginationRequestSchema,
  paginationResultSchema,
  projectIdSchema,
  safePathSchema,
  semanticVersionSchema,
  verifierIdSchema,
} from "./common.schemas.js";

export const artifactKindSchema = z.enum([
  "source",
  "document",
  "image",
  "video",
  "audio",
  "three_d_scene",
  "game_project",
  "mod_package",
  "test_report",
  "log",
  "dataset",
  "model_checkpoint",
  "other",
]);

export const artifactSchema = z
  .object({
    id: artifactIdSchema,
    projectId: projectIdSchema,
    jobId: jobIdSchema.optional(),
    kind: artifactKindSchema,
    logicalPath: safePathSchema,
    contentHash: contentHashSchema,
    byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mediaType: mediaTypeSchema,
    createdAt: isoDateTimeSchema,
    parentArtifactIds: z.array(artifactIdSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.parentArtifactIds,
      context,
      ["parentArtifactIds"],
      "Parent artifact IDs",
    );
    if (value.parentArtifactIds.includes(value.id)) {
      context.addIssue({
        code: "custom",
        message: "An artifact cannot list itself as a parent.",
        path: ["parentArtifactIds"],
      });
    }
  });

export const evidenceKindSchema = z.enum([
  "unit_test",
  "integration_test",
  "hidden_test",
  "property_test",
  "mutation_test",
  "static_analysis",
  "benchmark",
  "visual_inspection",
  "audio_inspection",
  "source",
  "tool_log",
  "runtime_log",
  "artifact_comparison",
  "human_approval",
]);

export const evidenceStatusSchema = z.enum(["passed", "failed", "inconclusive"]);

export const evidenceRecordSchema = z
  .object({
    id: evidenceIdSchema,
    projectId: projectIdSchema,
    jobId: jobIdSchema.optional(),
    kind: evidenceKindSchema,
    subjectType: canonicalIdSchema,
    subjectId: canonicalIdSchema,
    status: evidenceStatusSchema,
    summary: canonicalSummarySchema,
    artifactIds: z.array(artifactIdSchema).min(1).max(10_000),
    verifierId: verifierIdSchema,
    verifierVersion: semanticVersionSchema,
    createdAt: isoDateTimeSchema,
    immutable: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.artifactIds, context, ["artifactIds"], "Evidence artifact IDs");
  });

export const claimStatusSchema = z.enum(["proposed", "supported", "refuted", "inconclusive"]);

export const claimSchema = z
  .object({
    id: claimIdSchema,
    projectId: projectIdSchema,
    statement: canonicalStatementSchema,
    status: claimStatusSchema,
    evidenceIds: z.array(evidenceIdSchema).max(10_000),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Claim updatedAt cannot precede createdAt.",
        path: ["updatedAt"],
      });
    }
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Claim evidence IDs");
    if (value.status !== "proposed" && value.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Evaluated claims require evidence.",
        path: ["evidenceIds"],
      });
    }
  });

export const getEvidenceRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    evidenceId: evidenceIdSchema,
  })
  .strict();

export const getEvidenceResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    evidence: evidenceRecordSchema,
    artifacts: z.array(artifactSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const artifactIds = new Set(value.artifacts.map((artifact) => artifact.id));
    if (!value.evidence.artifactIds.every((id) => artifactIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "Evidence response must include every referenced artifact.",
        path: ["artifacts"],
      });
    }
  });

export const listEvidenceRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema,
    jobId: jobIdSchema.optional(),
    kind: evidenceKindSchema.optional(),
    status: evidenceStatusSchema.optional(),
    subjectType: canonicalIdSchema.optional(),
    subjectId: canonicalIdSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();

export const listEvidenceResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    evidence: z.array(evidenceRecordSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueStrings(value.evidence.map((item) => item.id))) {
      context.addIssue({
        code: "custom",
        message: "Evidence records must be unique.",
        path: ["evidence"],
      });
    }
  });

export type ArtifactKindPayload = z.infer<typeof artifactKindSchema>;
export type ArtifactPayload = z.infer<typeof artifactSchema>;
export type EvidenceKindPayload = z.infer<typeof evidenceKindSchema>;
export type EvidenceStatusPayload = z.infer<typeof evidenceStatusSchema>;
export type EvidenceRecordPayload = z.infer<typeof evidenceRecordSchema>;
export type ClaimPayload = z.infer<typeof claimSchema>;
export type GetEvidenceRequest = z.infer<typeof getEvidenceRequestSchema>;
export type GetEvidenceResponse = z.infer<typeof getEvidenceResponseSchema>;
export type ListEvidenceRequest = z.infer<typeof listEvidenceRequestSchema>;
export type ListEvidenceResponse = z.infer<typeof listEvidenceResponseSchema>;
