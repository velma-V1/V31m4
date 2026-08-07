import { ChampionDecision, type CandidateId, type EvidenceId, type IssueRecord, type MissionId, type SolverCandidate, type VerificationResult } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export interface CandidateAssessment {
  readonly candidate: SolverCandidate;
  readonly verification: VerificationResult;
  readonly issues: readonly IssueRecord[];
  readonly correctness: number;
  readonly coverage: number;
  readonly security: number;
  readonly performance: number;
  readonly complexity: number;
  readonly evidenceStrength: number;
}

export interface SelectChampionInput {
  readonly decisionId: string;
  readonly missionId: MissionId;
  readonly assessments: readonly CandidateAssessment[];
  readonly decidedAt: string;
}

const DIMENSIONS = ["correctness", "coverage", "security", "performance", "complexity", "evidenceStrength"] as const;

function validatesScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function dominates(left: CandidateAssessment, right: CandidateAssessment): boolean {
  let strictlyBetter = false;
  for (const dimension of DIMENSIONS) {
    const leftValue = dimension === "complexity" ? 1 - left[dimension] : left[dimension];
    const rightValue = dimension === "complexity" ? 1 - right[dimension] : right[dimension];
    if (leftValue < rightValue) return false;
    if (leftValue > rightValue) strictlyBetter = true;
  }
  return strictlyBetter;
}

function totalScore(value: CandidateAssessment): number {
  return value.correctness * 0.3 + value.coverage * 0.2 + value.security * 0.2 + value.performance * 0.1 + (1 - value.complexity) * 0.05 + value.evidenceStrength * 0.15;
}

export function selectChampion(input: SelectChampionInput): ReturnType<typeof ChampionDecision.createChampion> | ReturnType<typeof ChampionDecision.createNoVerifiedSolution> {
  assertApplication(input.assessments.length > 0, "INVALID_APPLICATION_INPUT", "Champion selection requires candidate assessments.");
  const candidateIds = input.assessments.map((assessment) => assessment.candidate.id);
  assertApplication(new Set(candidateIds).size === candidateIds.length, "INVALID_APPLICATION_INPUT", "Candidate assessments must be unique.");
  for (const assessment of input.assessments) {
    assertApplication(
      assessment.verification.candidateId === assessment.candidate.id,
      "INTEGRITY_FAILURE",
      "Verification result does not belong to the assessed candidate.",
    );
    for (const dimension of DIMENSIONS) {
      assertApplication(validatesScore(assessment[dimension]), "INVALID_APPLICATION_INPUT", "Assessment scores must be between zero and one.");
    }
  }

  const eligible = input.assessments.filter(
    (assessment) =>
      assessment.verification.status === "passed" &&
      assessment.verification.mandatoryChecksPassed === assessment.verification.mandatoryChecksTotal &&
      !assessment.issues.some((issue) => issue.status !== "rejected" && issue.severity === "critical"),
  );
  const allEvidence = input.assessments.flatMap((assessment) => assessment.verification.evidenceIds).map(String);
  if (eligible.length === 0) {
    return ChampionDecision.createNoVerifiedSolution({
      id: input.decisionId,
      missionId: input.missionId,
      evidenceIds: [...new Set(allEvidence)] as EvidenceId[],
      rationale: [{
        dimension: "correctness",
        statement: "No candidate completed every mandatory verification check without an unresolved critical issue.",
        evidenceIds: [...new Set(allEvidence)] as EvidenceId[],
      }],
      decidedAt: input.decidedAt,
    });
  }

  const pareto = eligible.filter((candidate) => !eligible.some((other) => other !== candidate && dominates(other, candidate)));
  const ordered = [...pareto].sort(
    (left, right) => totalScore(right) - totalScore(left) || String(left.candidate.id).localeCompare(String(right.candidate.id)),
  );
  const winner = ordered[0];
  assertApplication(winner !== undefined, "INTEGRITY_FAILURE", "Eligible candidate set unexpectedly became empty.");
  const evidenceIds = [...new Set(winner.verification.evidenceIds.map(String))] as EvidenceId[];
  const rationale = [
    { dimension: "correctness" as const, statement: "Candidate passed every mandatory independent verification check.", evidenceIds },
    { dimension: "coverage" as const, statement: `Candidate achieved ${(winner.coverage * 100).toFixed(1)} percent assessed coverage.`, evidenceIds },
    { dimension: "evidence" as const, statement: "Candidate has the strongest deterministic weighted score among the non-dominated verified candidates.", evidenceIds },
  ];
  return ChampionDecision.createChampion({
    id: input.decisionId,
    missionId: input.missionId,
    candidateId: winner.candidate.id,
    paretoCandidateIds: ordered.map((assessment) => assessment.candidate.id) as CandidateId[],
    evidenceIds,
    rationale,
    decidedAt: input.decidedAt,
  });
}
