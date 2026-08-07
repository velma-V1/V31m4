import { z } from "zod";
import {
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  candidateIdSchema,
  canonicalIdSchema,
  canonicalNameSchema,
  capabilityIdSchema,
  contentHashSchema,
  evidenceIdSchema,
  isoDateTimeSchema,
  issueIdSchema,
  missionIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  promotionIdSchema,
  repairIdSchema,
  scoreSchema,
  trainingPacketIdSchema,
} from "./common.schemas.js";

export const trainingViewKindSchema = z.enum([
  "sft",
  "preference",
  "failure_diagnosis",
  "repair",
  "tool_use",
  "verification",
  "planning",
]);
export const trainingViewSchema = z
  .object({ kind: trainingViewKindSchema, artifactId: artifactIdSchema })
  .strict();
export const trainingPacketStatusSchema = z.enum([
  "quarantined",
  "verified",
  "promoted",
  "rejected",
]);

export const trainingPacketSchema = z
  .object({
    id: trainingPacketIdSchema,
    missionId: missionIdSchema,
    status: trainingPacketStatusSchema,
    taskArtifactId: artifactIdSchema,
    contextArtifactIds: z.array(artifactIdSchema).max(10_000),
    originalCandidateIds: z.array(candidateIdSchema).min(1).max(10_000),
    preferredCandidateId: candidateIdSchema,
    rejectedCandidateIds: z.array(candidateIdSchema).max(10_000),
    issueIds: z.array(issueIdSchema).max(10_000),
    repairIds: z.array(repairIdSchema).max(10_000),
    verificationEvidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    trainingViews: z.array(trainingViewSchema).min(1).max(10_000),
    provenanceHash: contentHashSchema,
    evaluationLeakageChecked: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const originalIds = new Set(value.originalCandidateIds);
    if (!originalIds.has(value.preferredCandidateId)) {
      context.addIssue({
        code: "custom",
        message: "Preferred candidate must be an original candidate.",
        path: ["preferredCandidateId"],
      });
    }
    if (value.rejectedCandidateIds.includes(value.preferredCandidateId)) {
      context.addIssue({
        code: "custom",
        message: "Preferred candidate cannot be rejected.",
        path: ["rejectedCandidateIds"],
      });
    }
    if (
      (value.status === "verified" || value.status === "promoted") &&
      !value.evaluationLeakageChecked
    ) {
      context.addIssue({
        code: "custom",
        message: "Verified or promoted packets require leakage checks.",
        path: ["evaluationLeakageChecked"],
      });
    }
    for (const [path, ids, label] of [
      ["contextArtifactIds", value.contextArtifactIds, "Context artifact IDs"],
      ["originalCandidateIds", value.originalCandidateIds, "Original candidate IDs"],
      ["rejectedCandidateIds", value.rejectedCandidateIds, "Rejected candidate IDs"],
      ["issueIds", value.issueIds, "Issue IDs"],
      ["repairIds", value.repairIds, "Repair IDs"],
      ["verificationEvidenceIds", value.verificationEvidenceIds, "Verification evidence IDs"],
    ] as const) {
      addDuplicateStringIssue(ids, context, [path], label);
    }
  });

export const capabilityScoreSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    score: scoreSchema,
    sampleSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    difficultyRange: z.tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ]),
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    measuredAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.difficultyRange[0] > value.difficultyRange[1]) {
      context.addIssue({
        code: "custom",
        message: "Difficulty range must be ordered.",
        path: ["difficultyRange"],
      });
    }
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Capability evidence IDs");
  });

export const capabilityProfileSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    displayName: canonicalNameSchema,
    domain: canonicalIdSchema,
    current: capabilityScoreSchema,
    history: z.array(capabilityScoreSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.current.capabilityId !== value.capabilityId ||
      value.history.some((score) => score.capabilityId !== value.capabilityId)
    ) {
      context.addIssue({
        code: "custom",
        message: "All capability measurements must match the profile capability.",
        path: ["current"],
      });
    }
    const latest = value.history.at(-1);
    if (latest !== undefined && latest.measuredAt !== value.current.measuredAt) {
      context.addIssue({
        code: "custom",
        message: "Current measurement must equal the latest history entry.",
        path: ["current"],
      });
    }
  });

export const promotionDecisionSchema = z.enum(["promoted", "rejected", "rolled_back"]);
export const promotionRecordSchema = z
  .object({
    id: promotionIdSchema,
    capabilityId: capabilityIdSchema,
    sourcePacketIds: z.array(trainingPacketIdSchema).min(1).max(10_000),
    heldOutEvidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    regressionEvidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    decision: promotionDecisionSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.sourcePacketIds,
      context,
      ["sourcePacketIds"],
      "Source packet IDs",
    );
    addDuplicateStringIssue(
      value.heldOutEvidenceIds,
      context,
      ["heldOutEvidenceIds"],
      "Held-out evidence IDs",
    );
    addDuplicateStringIssue(
      value.regressionEvidenceIds,
      context,
      ["regressionEvidenceIds"],
      "Regression evidence IDs",
    );
  });

export const getCapabilityRequestSchema = z
  .object({ ...apiRequestMetadataShape, capabilityId: capabilityIdSchema })
  .strict();
export const getCapabilityResponseSchema = z
  .object({ ...apiResponseMetadataShape, capability: capabilityProfileSchema })
  .strict();
export const listCapabilitiesRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    domain: canonicalIdSchema.optional(),
    pagination: paginationRequestSchema,
  })
  .strict();
export const listCapabilitiesResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    capabilities: z.array(capabilityProfileSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type TrainingPacketPayload = z.infer<typeof trainingPacketSchema>;
export type CapabilityScorePayload = z.infer<typeof capabilityScoreSchema>;
export type CapabilityProfilePayload = z.infer<typeof capabilityProfileSchema>;
export type PromotionRecordPayload = z.infer<typeof promotionRecordSchema>;
