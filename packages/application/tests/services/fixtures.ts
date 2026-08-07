import {
  ArtifactId,
  AvatarState,
  CapabilityProfile,
  CandidateId,
  EvidenceId,
  EvidenceRecord,
  IssueRecord,
  MissionContract,
  ModelId,
  Requirement,
  ResourceBudget,
  SolverCandidate,
  ToolId,
  VerificationResult,
  type AchievementRule,
  type CapabilityProfile as CapabilityProfileType,
  type EvidenceRecord as EvidenceRecordType,
  type IssueRecord as IssueRecordType,
  type MissionContract as MissionContractType,
  type SolverCandidate as SolverCandidateType,
  type VerificationResult as VerificationResultType,
} from "@v31m4/domain";

export const T0 = "2026-08-06T20:00:00.000Z";
export const T1 = "2026-08-06T20:01:00.000Z";

export function budget(overrides: Partial<ReturnType<typeof ResourceBudget.create>> = {}) {
  return ResourceBudget.create({
    maxWallClockMs: 60_000,
    maxModelInvocations: 8,
    maxToolInvocations: 8,
    maxRepairRounds: 3,
    maxConcurrentWorkers: 4,
    maxInputTokens: 20_000,
    maxOutputTokens: 10_000,
    ...overrides,
  });
}

export function mission(): MissionContractType {
  return MissionContract.create({
    id: "mission-1",
    projectId: "project-1",
    title: "Verified mission",
    objective: "Produce a verified output.",
    requiredOutputs: [{ id: "output-1", kind: "source", description: "Verified source." }],
    requirements: [Requirement.create({ id: "requirement-1", statement: "Output must pass tests.", priority: "required", source: "user" })],
    constraints: [{ id: "constraint-1", statement: "Preserve architecture.", category: "architecture" }],
    acceptanceCriteria: [
      { id: "criterion-1", statement: "Unit tests pass.", verificationMethod: "unit", mandatory: true },
      { id: "criterion-2", statement: "Static analysis passes.", verificationMethod: "static", mandatory: false },
    ],
    forbiddenChanges: [],
    evidenceRequirements: [{ criterionId: "criterion-1", requiredEvidenceKinds: ["unit_test"] }],
    resourceBudget: budget(),
    createdAt: T0,
  });
}

export function evidence(input: Partial<{
  id: string;
  subjectId: string;
  kind: "unit_test" | "static_analysis" | "benchmark";
  status: "passed" | "failed" | "inconclusive";
  verifierId: string;
  subjectType: string;
}> = {}): EvidenceRecordType {
  return EvidenceRecord.create({
    id: input.id ?? "evidence-1",
    projectId: "project-1",
    kind: input.kind ?? "unit_test",
    subjectType: input.subjectType ?? "acceptance_criterion",
    subjectId: input.subjectId ?? "criterion-1",
    status: input.status ?? "passed",
    summary: "Verification result.",
    artifactIds: ["artifact-evidence-1"],
    verifierId: input.verifierId ?? "verifier-1",
    verifierVersion: "1.0.0",
    createdAt: T0,
  });
}

export function candidate(id = "candidate-1"): SolverCandidateType {
  return SolverCandidate.createOriginal({
    id,
    missionId: "mission-1",
    configuration: {
      modelId: "model-1",
      strategy: "direct",
      contextArtifactIds: ["artifact-context-1"],
      toolIds: ["tool-1"],
      constraints: ["Preserve architecture."],
    },
    responseArtifactId: `artifact-response-${id}`,
    outputArtifactIds: [`artifact-output-${id}`],
    createdAt: T0,
  });
}

export function verification(candidateId = "candidate-1", status: "passed" | "failed" | "inconclusive" = "passed"): VerificationResultType {
  const plan = VerificationResult.createPlan({
    id: `plan-${candidateId}`,
    missionId: "mission-1",
    candidateId,
    checks: [{ id: "check-1", criterionIds: ["criterion-1"], verifierId: "verifier-1", kind: "unit_test", mandatory: true, hidden: false, timeoutMs: 1000 }],
  });
  return VerificationResult.calculate({
    id: `verification-${candidateId}`,
    plan,
    completedChecks: [{ checkId: "check-1", status, evidenceIds: [`evidence-${candidateId}`] }],
  });
}

export function issue(candidateId = "candidate-1", severity: "critical" | "high" | "medium" | "low" = "high"): IssueRecordType {
  return IssueRecord.create({
    id: `issue-${candidateId}-${severity}`,
    candidateId,
    title: "Verified defect",
    exactDeficiency: "The output violates a requirement.",
    severity,
    evidenceIds: [`evidence-${candidateId}`],
    expectedConsequence: "The result may fail.",
    proposedCorrection: "Apply a targeted repair.",
    verificationMethod: "unit",
    regressionRisk: "Low when focused tests pass.",
  });
}

export function capability(id = "capability-1", score = 0.4, evidenceIds: readonly string[] = ["evidence-capability-1"]): CapabilityProfileType {
  return CapabilityProfile.create({
    capabilityId: id,
    displayName: id,
    domain: "software",
    initialScore: {
      capabilityId: id,
      score,
      sampleSize: 5,
      difficultyRange: [0.2, 0.8],
      evidenceIds,
      measuredAt: T0,
    },
  });
}

export function achievementRule(): AchievementRule {
  return AvatarState.createRule({
    id: "rule-1",
    title: "Verified Builder",
    requiredCapabilityIds: ["capability-1"],
    minimumScores: { "capability-1": 0.5 },
    requiredEvidenceKinds: ["unit_test"],
    minimumIndependentVerifiers: 2,
    forbiddenEvidenceSources: ["model-self"],
    unlockItemId: "item-1",
  });
}

export const ids = Object.freeze({
  artifact: ArtifactId.parse("artifact-1"),
  candidate: CandidateId.parse("candidate-1"),
  evidence: EvidenceId.parse("evidence-1"),
  model: ModelId.parse("model-1"),
  tool: ToolId.parse("tool-1"),
});
