import {
  CapabilityProfile,
  type CapabilityProfile as CapabilityProfileType,
  type CreateEvidenceRecordInput,
  type CreateMissionContractInput,
  EvidenceRecord,
  type EvidenceRecord as EvidenceRecordType,
  MissionContract,
  type MissionContract as MissionContractType,
  Requirement,
  ResourceBudget,
  VerificationResult,
  type VerificationResult as VerificationResultType,
} from "@v31m4/domain";

export function makeCapabilityProfile(
  overrides: {
    readonly score?: number;
    readonly sampleSize?: number;
    readonly capabilityId?: string;
  } = {},
): CapabilityProfileType {
  const capabilityId = overrides.capabilityId ?? "capability:render";
  return CapabilityProfile.create({
    capabilityId,
    displayName: "Rendering",
    domain: "graphics",
    initialScore: {
      capabilityId,
      score: overrides.score ?? 0.5,
      sampleSize: overrides.sampleSize ?? 10,
      difficultyRange: [0.2, 0.8],
      evidenceIds: ["evidence:seed"],
      measuredAt: "2026-07-01T12:00:00.000Z",
    },
  });
}

let verificationCounter = 0;

export type VerificationOutcome = "passed" | "failed" | "inconclusive" | "optional_only";

/** Builds a domain VerificationResult with the requested overall shape. */
export function makeVerification(outcome: VerificationOutcome): VerificationResultType {
  verificationCounter += 1;
  const planId = `vplan:${verificationCounter}`;
  const candidateId = `candidate:${verificationCounter}`;
  const mandatory = outcome !== "optional_only";
  const plan = VerificationResult.createPlan({
    id: planId,
    missionId: "mission:1",
    candidateId,
    checks: [
      {
        id: "check:1",
        criterionIds: ["criterion:1"],
        verifierId: "verifier:1",
        kind: "hidden_test",
        mandatory,
        hidden: true,
        timeoutMs: 1_000,
      },
    ],
  });
  const completedChecks =
    outcome === "inconclusive"
      ? []
      : [
          {
            checkId: "check:1",
            status: outcome === "failed" ? ("failed" as const) : ("passed" as const),
            evidenceIds: [`evidence:v${verificationCounter}`],
          },
        ];
  return VerificationResult.calculate({
    id: `vresult:${verificationCounter}`,
    plan,
    completedChecks,
  });
}

let evidenceCounter = 0;

export function makeEvidence(
  overrides: Partial<CreateEvidenceRecordInput> = {},
): EvidenceRecordType {
  evidenceCounter += 1;
  const base: CreateEvidenceRecordInput = {
    id: `evidence:${evidenceCounter}`,
    projectId: "project:1",
    kind: "hidden_test",
    subjectType: "acceptance_criterion",
    subjectId: "criterion:1",
    status: "passed",
    summary: "Verification passed.",
    artifactIds: ["artifact:1"],
    verifierId: "verifier:hidden",
    verifierVersion: "1.0.0",
    createdAt: "2026-08-06T12:00:00.000Z",
  };
  return EvidenceRecord.create({ ...base, ...overrides });
}

export const budget = ResourceBudget.create({
  maxWallClockMs: 60_000,
  maxModelInvocations: 8,
  maxToolInvocations: 8,
  maxRepairRounds: 3,
  maxConcurrentWorkers: 4,
});

export function makeMission(
  overrides: Partial<CreateMissionContractInput> = {},
): MissionContractType {
  const base: CreateMissionContractInput = {
    id: "mission:1",
    projectId: "project:1",
    title: "Deliver renderer",
    objective: "Implement a deterministic renderer that passes the golden-image suite.",
    requiredOutputs: [{ id: "output:1", kind: "source", description: "Renderer source module." }],
    requirements: [
      Requirement.create({
        id: "req:1",
        statement: "Frames must match the golden images.",
        priority: "required",
        source: "user",
      }),
    ],
    constraints: [
      { id: "constraint:1", statement: "Rendering must be deterministic.", category: "behavior" },
    ],
    acceptanceCriteria: [
      {
        id: "criterion:1",
        statement: "Golden-image suite passes.",
        verificationMethod: "hidden_test",
        mandatory: true,
      },
      {
        id: "criterion:2",
        statement: "Docs updated.",
        verificationMethod: "human_approval",
        mandatory: false,
      },
    ],
    forbiddenChanges: [{ id: "forbidden:1", statement: "Do not modify the public API." }],
    evidenceRequirements: [{ criterionId: "criterion:1", requiredEvidenceKinds: ["hidden_test"] }],
    resourceBudget: budget,
    createdAt: "2026-08-06T12:00:00.000Z",
  };
  return MissionContract.create({ ...base, ...overrides });
}
