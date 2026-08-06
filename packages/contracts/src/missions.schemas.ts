import { z } from "zod";
import {
  addDuplicateStringIssue,
  type ContractRefinementContext,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  canonicalIdSchema,
  canonicalNameSchema,
  canonicalStatementSchema,
  isoDateTimeSchema,
  missionIdSchema,
  projectIdSchema,
  requirementIdSchema,
  resourceBudgetSchema,
} from "./common.schemas.js";
import { evidenceKindSchema } from "./evidence.schemas.js";

export const requirementPrioritySchema = z.enum(["required", "important", "optional"]);
export const requirementSourceSchema = z.enum(["user", "system", "plugin", "derived"]);

export const requirementSchema = z
  .object({
    id: requirementIdSchema,
    statement: canonicalStatementSchema,
    priority: requirementPrioritySchema,
    source: requirementSourceSchema,
  })
  .strict();

export const requiredOutputSchema = z
  .object({
    id: canonicalIdSchema,
    kind: canonicalIdSchema,
    description: canonicalStatementSchema,
    requiredFormat: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => value === value.trim(), "Required format cannot contain outer whitespace.")
      .optional(),
  })
  .strict();

export const missionConstraintCategorySchema = z.enum([
  "architecture",
  "behavior",
  "performance",
  "resource",
  "compatibility",
  "security",
]);

export const missionConstraintSchema = z
  .object({
    id: canonicalIdSchema,
    statement: canonicalStatementSchema,
    category: missionConstraintCategorySchema,
  })
  .strict();

export const acceptanceCriterionSchema = z
  .object({
    id: canonicalIdSchema,
    statement: canonicalStatementSchema,
    verificationMethod: canonicalStatementSchema,
    mandatory: z.boolean(),
  })
  .strict();

export const forbiddenChangeSchema = z
  .object({
    id: canonicalIdSchema,
    statement: canonicalStatementSchema,
  })
  .strict();

export const evidenceRequirementSchema = z
  .object({
    criterionId: canonicalIdSchema,
    requiredEvidenceKinds: z.array(evidenceKindSchema).min(1).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.requiredEvidenceKinds,
      context,
      ["requiredEvidenceKinds"],
      "Required evidence kinds",
    );
  });

const missionContentShape = {
  projectId: projectIdSchema,
  title: canonicalNameSchema,
  objective: canonicalStatementSchema,
  requiredOutputs: z.array(requiredOutputSchema).min(1).max(1_000),
  requirements: z.array(requirementSchema).min(1).max(10_000),
  constraints: z.array(missionConstraintSchema).max(10_000),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(10_000),
  forbiddenChanges: z.array(forbiddenChangeSchema).max(10_000),
  evidenceRequirements: z.array(evidenceRequirementSchema).max(10_000),
  resourceBudget: resourceBudgetSchema,
} as const;

function validateMissionContent(
  value: {
    readonly requiredOutputs: readonly { readonly id: string }[];
    readonly requirements: readonly { readonly id: string }[];
    readonly constraints: readonly { readonly id: string }[];
    readonly acceptanceCriteria: readonly { readonly id: string; readonly mandatory: boolean }[];
    readonly forbiddenChanges: readonly { readonly id: string }[];
    readonly evidenceRequirements: readonly { readonly criterionId: string }[];
  },
  context: ContractRefinementContext,
): void {
  addDuplicateStringIssue(
    value.requiredOutputs.map((item) => item.id),
    context,
    ["requiredOutputs"],
    "Required output IDs",
  );
  addDuplicateStringIssue(
    value.requirements.map((item) => item.id),
    context,
    ["requirements"],
    "Requirement IDs",
  );
  addDuplicateStringIssue(
    value.constraints.map((item) => item.id),
    context,
    ["constraints"],
    "Constraint IDs",
  );
  addDuplicateStringIssue(
    value.acceptanceCriteria.map((item) => item.id),
    context,
    ["acceptanceCriteria"],
    "Acceptance criterion IDs",
  );
  addDuplicateStringIssue(
    value.forbiddenChanges.map((item) => item.id),
    context,
    ["forbiddenChanges"],
    "Forbidden change IDs",
  );
  addDuplicateStringIssue(
    value.evidenceRequirements.map((item) => item.criterionId),
    context,
    ["evidenceRequirements"],
    "Evidence requirement criterion IDs",
  );

  const criterionIds = new Set(value.acceptanceCriteria.map((item) => item.id));
  for (const [index, requirement] of value.evidenceRequirements.entries()) {
    if (!criterionIds.has(requirement.criterionId)) {
      context.addIssue({
        code: "custom",
        message: "Evidence requirement references an unknown acceptance criterion.",
        path: ["evidenceRequirements", index, "criterionId"],
      });
    }
  }

  const coveredCriterionIds = new Set(
    value.evidenceRequirements.map((requirement) => requirement.criterionId),
  );
  for (const [index, criterion] of value.acceptanceCriteria.entries()) {
    if (criterion.mandatory && !coveredCriterionIds.has(criterion.id)) {
      context.addIssue({
        code: "custom",
        message: "Every mandatory acceptance criterion requires explicit evidence coverage.",
        path: ["acceptanceCriteria", index, "id"],
      });
    }
  }
}

export const missionContractSchema = z
  .object({
    id: missionIdSchema,
    ...missionContentShape,
    createdAt: isoDateTimeSchema,
    revision: z.literal(1),
  })
  .strict()
  .superRefine(validateMissionContent);

export const submitMissionRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    ...missionContentShape,
  })
  .strict()
  .superRefine(validateMissionContent);

export const submitMissionResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    mission: missionContractSchema,
  })
  .strict();

export const getMissionRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    missionId: missionIdSchema,
  })
  .strict();

export const getMissionResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    mission: missionContractSchema,
  })
  .strict();

export type RequirementPriorityPayload = z.infer<typeof requirementPrioritySchema>;
export type RequirementSourcePayload = z.infer<typeof requirementSourceSchema>;
export type RequirementPayload = z.infer<typeof requirementSchema>;
export type RequiredOutputPayload = z.infer<typeof requiredOutputSchema>;
export type MissionConstraintPayload = z.infer<typeof missionConstraintSchema>;
export type AcceptanceCriterionPayload = z.infer<typeof acceptanceCriterionSchema>;
export type ForbiddenChangePayload = z.infer<typeof forbiddenChangeSchema>;
export type EvidenceRequirementPayload = z.infer<typeof evidenceRequirementSchema>;
export type MissionContractPayload = z.infer<typeof missionContractSchema>;
export type SubmitMissionRequest = z.infer<typeof submitMissionRequestSchema>;
export type SubmitMissionResponse = z.infer<typeof submitMissionResponseSchema>;
export type GetMissionRequest = z.infer<typeof getMissionRequestSchema>;
export type GetMissionResponse = z.infer<typeof getMissionResponseSchema>;
