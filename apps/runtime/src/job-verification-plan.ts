import { randomUUID } from "node:crypto";
import type { Job, MissionContract, ModelId, SolverCandidate } from "@v31m4/domain";
import { VerificationPlanId, VerificationResult } from "@v31m4/domain";
import { stableDigest } from "./job-command-helpers.js";

export function createJobModelConfiguration(modelId: ModelId) {
  return Object.freeze({
    modelId,
    strategy: "direct" as const,
    contextArtifactIds: Object.freeze([]),
    toolIds: Object.freeze([]),
    constraints: Object.freeze([]),
  });
}

export function createJobVerificationPlan(input: {
  readonly job: Job;
  readonly mission: MissionContract;
  readonly candidate: SolverCandidate;
  readonly verifierId: string;
  readonly deterministic: boolean;
}) {
  const checkId =
    input.job.workflowId === "software.production.v1"
      ? (input.mission.acceptanceCriteria[0]?.id ?? "software.production.check")
      : input.deterministic
        ? "stage4.tiny-code.tests"
        : "output-artifact-presence";
  return VerificationResult.createPlan({
    id: VerificationPlanId.parse(
      input.deterministic
        ? `plan-${stableDigest(input.job.id).slice(0, 32)}`
        : `plan-${randomUUID()}`,
    ),
    missionId: input.job.missionId,
    candidateId: input.candidate.id,
    checks: [
      {
        id: checkId,
        criterionIds: Object.freeze(input.mission.acceptanceCriteria.map((entry) => entry.id)),
        verifierId: input.verifierId,
        kind: input.deterministic ? ("unit_test" as const) : ("static_analysis" as const),
        mandatory: true,
        hidden: false,
        timeoutMs: 30_000,
      },
    ],
  });
}
