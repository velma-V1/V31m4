import { CapabilityProfile, type CapabilityProfile as CapabilityProfileType, type CapabilityScore, type EvidenceId } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export interface CapabilityObservation {
  readonly evidenceId: EvidenceId;
  readonly outcome: number;
  readonly difficulty: number;
  readonly measuredAt: string;
  readonly source: "production" | "practice";
  readonly leakageChecked: boolean;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function canonicalTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  assertApplication(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_APPLICATION_INPUT",
    `${label} must be canonical UTC ISO-8601 with milliseconds.`,
  );
  return parsed;
}

export interface CapabilityCalculationInput {
  readonly profile: CapabilityProfileType;
  readonly observations: readonly CapabilityObservation[];
  readonly measuredAt: string;
  readonly minimumSampleSize: number;
  readonly practiceWeight: number;
}

export function calculateCapabilityScore(input: CapabilityCalculationInput): CapabilityScore {
  assertApplication(Number.isSafeInteger(input.minimumSampleSize) && input.minimumSampleSize > 0, "INVALID_APPLICATION_INPUT", "Minimum sample size must be positive.");
  assertApplication(Number.isFinite(input.practiceWeight) && input.practiceWeight >= 0 && input.practiceWeight <= 1, "INVALID_APPLICATION_INPUT", "Practice weight must be between zero and one.");
  assertApplication(input.observations.length >= input.minimumSampleSize, "POLICY_REJECTED", "Insufficient verified observations for a capability update.");
  const evidenceIds = input.observations.map((observation) => observation.evidenceId);
  assertApplication(new Set(evidenceIds).size === evidenceIds.length, "INTEGRITY_FAILURE", "Capability observations cannot reuse evidence.");
  assertApplication(input.observations.every((observation) => observation.leakageChecked), "POLICY_REJECTED", "Every observation must pass evaluation-leakage checks.");

  let weightedOutcome = 0;
  let totalWeight = 0;
  let minimumDifficulty = Number.POSITIVE_INFINITY;
  let maximumDifficulty = 0;
  const measuredTime = canonicalTime(input.measuredAt, "measuredAt");
  for (const observation of input.observations) {
    assertApplication(Number.isFinite(observation.outcome) && observation.outcome >= 0 && observation.outcome <= 1, "INVALID_APPLICATION_INPUT", "Observation outcomes must be between zero and one.");
    assertApplication(Number.isFinite(observation.difficulty) && observation.difficulty >= 0, "INVALID_APPLICATION_INPUT", "Observation difficulty must be non-negative.");
    const observationTime = canonicalTime(observation.measuredAt, "observation.measuredAt");
    assertApplication(observationTime <= measuredTime, "INVALID_APPLICATION_INPUT", "Capability observations cannot be measured in the future.");
    const ageDays = (measuredTime - observationTime) / 86_400_000;
    const recency = 1 / (1 + ageDays / 30);
    const difficulty = Math.max(0.25, Math.min(2, 0.5 + observation.difficulty));
    const sourceWeight = observation.source === "practice" ? input.practiceWeight : 1;
    const weight = recency * difficulty * sourceWeight;
    weightedOutcome += observation.outcome * weight;
    totalWeight += weight;
    minimumDifficulty = Math.min(minimumDifficulty, observation.difficulty);
    maximumDifficulty = Math.max(maximumDifficulty, observation.difficulty);
  }
  assertApplication(totalWeight > 0, "POLICY_REJECTED", "Observations have no eligible production or practice weight.");
  const observedScore = weightedOutcome / totalWeight;
  const sampleInfluence = Math.min(0.5, input.observations.length / (input.observations.length + 10));
  const score = input.profile.current.score * (1 - sampleInfluence) + observedScore * sampleInfluence;
  return CapabilityProfile.createScore({
    capabilityId: input.profile.capabilityId,
    score: Math.max(0, Math.min(1, score)),
    sampleSize: input.observations.length,
    difficultyRange: [minimumDifficulty, maximumDifficulty],
    evidenceIds: evidenceIds.map(String),
    measuredAt: input.measuredAt,
  });
}
