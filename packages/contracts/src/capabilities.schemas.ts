import { z } from "zod";
import {
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  artifactIdSchema,
  candidateIdSchema,
  canonicalIdSchema,
  canonicalNameSchema,
  canonicalStatementSchema,
  championDecisionIdSchema,
  deliveryReceiptIdSchema,
  evidenceIdSchema,
  hasUniqueStrings,
  isoDateTimeSchema,
  issueIdSchema,
  missionIdSchema,
  modelIdSchema,
  paginationRequestSchema,
  paginationResultSchema,
  projectIdSchema,
  repairIdSchema,
  toolIdSchema,
  verificationPlanIdSchema,
  verificationResultIdSchema,
} from "./common.schemas.js";
import { evidenceKindSchema, evidenceStatusSchema } from "./evidence.schemas.js";

// Learning, capability, promotion, and capability-endpoint schemas live in a focused
// sibling module (keeps this file under the 500-line limit); re-exported for a stable API.
export * from "./learning.schemas.js";

export const solverStrategySchema = z.enum([
  "direct",
  "minimal_change",
  "specification_first",
  "failure_first",
  "performance_constrained",
  "clean_room",
  "adversarial",
]);

export const solverConfigurationSchema = z
  .object({
    modelId: modelIdSchema,
    strategy: solverStrategySchema,
    contextArtifactIds: z.array(artifactIdSchema).max(10_000),
    toolIds: z.array(toolIdSchema).max(1_000),
    temperature: z.number().finite().min(0).max(2).optional(),
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    constraints: z.array(canonicalStatementSchema).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.contextArtifactIds,
      context,
      ["contextArtifactIds"],
      "Context artifact IDs",
    );
    addDuplicateStringIssue(value.toolIds, context, ["toolIds"], "Tool IDs");
    addDuplicateStringIssue(value.constraints, context, ["constraints"], "Solver constraints");
  });

export const solverCandidateSchema = z
  .object({
    id: candidateIdSchema,
    missionId: missionIdSchema,
    parentCandidateIds: z.array(candidateIdSchema).max(10_000),
    configuration: solverConfigurationSchema,
    responseArtifactId: artifactIdSchema,
    outputArtifactIds: z.array(artifactIdSchema).min(1).max(10_000),
    toolTraceArtifactId: artifactIdSchema.optional(),
    original: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.parentCandidateIds,
      context,
      ["parentCandidateIds"],
      "Parent candidate IDs",
    );
    addDuplicateStringIssue(
      value.outputArtifactIds,
      context,
      ["outputArtifactIds"],
      "Output artifact IDs",
    );
    if (value.parentCandidateIds.includes(value.id)) {
      context.addIssue({
        code: "custom",
        message: "A candidate cannot be its own parent.",
        path: ["parentCandidateIds"],
      });
    }
    if (value.original !== (value.parentCandidateIds.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Original candidates have no parents; reconstructed candidates require parents.",
        path: ["original"],
      });
    }
  });

export const listCandidatesRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema,
    missionId: missionIdSchema,
    pagination: paginationRequestSchema,
  })
  .strict();

export const listCandidatesResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    candidates: z.array(solverCandidateSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueStrings(value.candidates.map((candidate) => candidate.id))) {
      context.addIssue({
        code: "custom",
        message: "Candidates must be unique.",
        path: ["candidates"],
      });
    }
  });

export const verificationCheckSchema = z
  .object({
    id: canonicalIdSchema,
    criterionIds: z.array(canonicalIdSchema).min(1).max(1_000),
    verifierId: canonicalIdSchema,
    kind: evidenceKindSchema,
    mandatory: z.boolean(),
    hidden: z.boolean(),
    timeoutMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.criterionIds, context, ["criterionIds"], "Criterion IDs");
  });

export const verificationPlanSchema = z
  .object({
    id: verificationPlanIdSchema,
    missionId: missionIdSchema,
    candidateId: candidateIdSchema,
    checks: z.array(verificationCheckSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.checks.map((check) => check.id),
      context,
      ["checks"],
      "Verification check IDs",
    );
  });

export const verificationResultSchema = z
  .object({
    id: verificationResultIdSchema,
    planId: verificationPlanIdSchema,
    candidateId: candidateIdSchema,
    status: evidenceStatusSchema,
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    mandatoryChecksPassed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mandatoryChecksTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    optionalChecksPassed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    optionalChecksTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.evidenceIds,
      context,
      ["evidenceIds"],
      "Verification evidence IDs",
    );
    if (value.mandatoryChecksPassed > value.mandatoryChecksTotal) {
      context.addIssue({
        code: "custom",
        message: "Mandatory passed count exceeds total.",
        path: ["mandatoryChecksPassed"],
      });
    }
    if (value.optionalChecksPassed > value.optionalChecksTotal) {
      context.addIssue({
        code: "custom",
        message: "Optional passed count exceeds total.",
        path: ["optionalChecksPassed"],
      });
    }
    if (value.status === "passed" && value.mandatoryChecksPassed !== value.mandatoryChecksTotal) {
      context.addIssue({
        code: "custom",
        message: "Passed verification requires every mandatory check.",
        path: ["status"],
      });
    }
  });

export const issueSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const issueStatusSchema = z.enum(["open", "accepted", "rejected", "repaired"]);

export const issueRecordSchema = z
  .object({
    id: issueIdSchema,
    candidateId: candidateIdSchema,
    title: canonicalNameSchema,
    exactDeficiency: canonicalStatementSchema,
    location: z.string().min(1).max(1_024).optional(),
    severity: issueSeveritySchema,
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    expectedConsequence: canonicalStatementSchema,
    proposedCorrection: canonicalStatementSchema,
    verificationMethod: canonicalStatementSchema,
    regressionRisk: canonicalStatementSchema,
    status: issueStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Issue evidence IDs");
  });

export const repairStatusSchema = z.enum(["passed", "failed", "rolled_back"]);
export const repairRecordSchema = z
  .object({
    id: repairIdSchema,
    issueId: issueIdSchema,
    sourceCandidateId: candidateIdSchema,
    repairedCandidateId: candidateIdSchema,
    changedArtifactIds: z.array(artifactIdSchema).min(1).max(10_000),
    focusedEvidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    regressionEvidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    status: repairStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceCandidateId === value.repairedCandidateId) {
      context.addIssue({
        code: "custom",
        message: "Repair must create a distinct candidate.",
        path: ["repairedCandidateId"],
      });
    }
    addDuplicateStringIssue(
      value.changedArtifactIds,
      context,
      ["changedArtifactIds"],
      "Changed artifact IDs",
    );
    addDuplicateStringIssue(
      value.focusedEvidenceIds,
      context,
      ["focusedEvidenceIds"],
      "Focused evidence IDs",
    );
    addDuplicateStringIssue(
      value.regressionEvidenceIds,
      context,
      ["regressionEvidenceIds"],
      "Regression evidence IDs",
    );
  });

export const decisionDimensionSchema = z.enum([
  "correctness",
  "coverage",
  "security",
  "performance",
  "complexity",
  "evidence",
]);
export const decisionReasonSchema = z
  .object({
    dimension: decisionDimensionSchema,
    statement: canonicalStatementSchema,
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
  })
  .strict();

export const championDecisionSchema = z
  .object({
    id: championDecisionIdSchema,
    missionId: missionIdSchema,
    decision: z.enum(["champion", "no_verified_solution"]),
    candidateId: candidateIdSchema.optional(),
    paretoCandidateIds: z.array(candidateIdSchema).max(10_000),
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    rationale: z.array(decisionReasonSchema).min(1).max(1_000),
    decidedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "champion") !== (value.candidateId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Champion decisions require one candidate; no-solution decisions forbid one.",
        path: ["candidateId"],
      });
    }
    addDuplicateStringIssue(
      value.paretoCandidateIds,
      context,
      ["paretoCandidateIds"],
      "Pareto candidate IDs",
    );
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Decision evidence IDs");
  });

export const deliveryReceiptSchema = z
  .object({
    id: deliveryReceiptIdSchema,
    missionId: missionIdSchema,
    decision: z.enum(["champion", "no_verified_solution"]),
    deliveredArtifactIds: z.array(artifactIdSchema).max(10_000),
    requirementsCovered: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    requirementsTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mandatoryChecksPassed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mandatoryChecksTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    unresolvedRiskIds: z.array(issueIdSchema).max(10_000),
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requirementsCovered > value.requirementsTotal) {
      context.addIssue({
        code: "custom",
        message: "Requirement coverage exceeds total.",
        path: ["requirementsCovered"],
      });
    }
    if (value.mandatoryChecksPassed > value.mandatoryChecksTotal) {
      context.addIssue({
        code: "custom",
        message: "Mandatory passed count exceeds total.",
        path: ["mandatoryChecksPassed"],
      });
    }
    if (value.decision === "champion") {
      if (value.deliveredArtifactIds.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Champion delivery requires artifacts.",
          path: ["deliveredArtifactIds"],
        });
      }
      if (
        value.requirementsCovered !== value.requirementsTotal ||
        value.mandatoryChecksPassed !== value.mandatoryChecksTotal
      ) {
        context.addIssue({
          code: "custom",
          message: "Champion delivery requires complete mandatory coverage.",
          path: ["decision"],
        });
      }
    }
  });

export type SolverConfigurationPayload = z.infer<typeof solverConfigurationSchema>;
export type SolverCandidatePayload = z.infer<typeof solverCandidateSchema>;
export type ListCandidatesRequest = z.infer<typeof listCandidatesRequestSchema>;
export type ListCandidatesResponse = z.infer<typeof listCandidatesResponseSchema>;
export type VerificationPlanPayload = z.infer<typeof verificationPlanSchema>;
export type VerificationResultPayload = z.infer<typeof verificationResultSchema>;
export type IssueRecordPayload = z.infer<typeof issueRecordSchema>;
export type RepairRecordPayload = z.infer<typeof repairRecordSchema>;
export type ChampionDecisionPayload = z.infer<typeof championDecisionSchema>;
export type DeliveryReceiptPayload = z.infer<typeof deliveryReceiptSchema>;
