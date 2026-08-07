import {
  CapabilityProfile,
  type CapabilityProfile as CapabilityProfileType,
  type CapabilityScore,
  Score,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Capability Calculator.
 *
 * Computes an evidence-backed capability update from verified production measurements.
 * Difficulty and recency weight each measurement; a sample-size-weighted blend and a
 * per-update step cap prevent one easy success or single failure from swinging a score
 * built on extensive verified history. Practice evidence is separated from production
 * evidence, duplicates and leakage are rejected, and results are deterministic.
 */

export type MeasurementSource = "production" | "practice";

export interface CapabilityMeasurement {
  readonly evidenceId: string;
  readonly verified: boolean;
  readonly evaluationLeakage: boolean;
  readonly source: MeasurementSource;
  readonly outcomeScore: number;
  readonly difficulty: number;
  readonly measuredAt: string;
}

export interface CapabilityCalculatorInput {
  readonly current: CapabilityProfileType;
  readonly measurements: readonly CapabilityMeasurement[];
  readonly now: string;
  readonly minimumSampleSize?: number;
  readonly maxSingleStep?: number;
  readonly recencyHalfLifeMs?: number;
}

export type MeasurementRejection = "unverified" | "evaluation_leakage" | "duplicate_evidence";

export interface RejectedMeasurement {
  readonly evidenceId: string;
  readonly reason: MeasurementRejection;
}

export interface CapabilityUpdate {
  readonly outcome: "updated";
  readonly capabilityId: string;
  readonly previousScore: number;
  readonly newScore: number;
  readonly nextScore: CapabilityScore;
  readonly productionSampleSize: number;
  readonly practiceSampleSize: number;
  readonly totalSampleSize: number;
  readonly difficultyRange: readonly [number, number];
  readonly usedEvidenceIds: readonly string[];
  /** Support in [0, 1] reflecting sample volume. This is not verification. */
  readonly support: number;
  readonly rejectedMeasurements: readonly RejectedMeasurement[];
}

export interface CapabilityInsufficient {
  readonly outcome: "insufficient_evidence";
  readonly reason: "insufficient_sample";
  readonly productionSampleSize: number;
  readonly requiredSampleSize: number;
  readonly rejectedMeasurements: readonly RejectedMeasurement[];
  readonly detail: string;
}

export type CapabilityCalculatorResult = CapabilityUpdate | CapabilityInsufficient;

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DEFAULT_MIN_SAMPLE = 3;
const DEFAULT_MAX_STEP = 0.15;
const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1_000;
const SUPPORT_TARGET_SAMPLE = 20;

function parseIso(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (
    !(
      ISO_PATTERN.test(value) &&
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString() === value
    )
  ) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `${field} must be canonical UTC ISO-8601 with milliseconds.`,
      { details: { field } },
    );
  }
  return parsed;
}

function assertUnit(name: string, value: number): number {
  try {
    return Score.parse(value);
  } catch {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `${name} must be between 0 and 1.`);
  }
}

function existingEvidenceIds(profile: CapabilityProfileType): Set<string> {
  const ids = new Set<string>();
  for (const score of profile.history) {
    for (const evidenceId of score.evidenceIds) {
      ids.add(evidenceId);
    }
  }
  return ids;
}

interface WeightedMeasurement {
  readonly evidenceId: string;
  readonly outcomeScore: number;
  readonly difficulty: number;
  readonly weight: number;
}

/** Computes an evidence-backed capability update or reports insufficient evidence. */
export function calculateCapability(input: CapabilityCalculatorInput): CapabilityCalculatorResult {
  const now = parseIso(input.now, "now");
  const minimumSample = input.minimumSampleSize ?? DEFAULT_MIN_SAMPLE;
  if (!Number.isSafeInteger(minimumSample) || minimumSample <= 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "minimumSampleSize must be a positive safe integer.",
    );
  }
  const maxStep = input.maxSingleStep ?? DEFAULT_MAX_STEP;
  if (!(Number.isFinite(maxStep) && maxStep > 0 && maxStep <= 1)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "maxSingleStep must be within (0, 1].");
  }
  const halfLife = input.recencyHalfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  if (!(Number.isFinite(halfLife) && halfLife > 0)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "recencyHalfLifeMs must be positive.");
  }

  const seen = existingEvidenceIds(input.current);
  const rejected: RejectedMeasurement[] = [];
  const production: WeightedMeasurement[] = [];
  let practiceSampleSize = 0;

  for (const measurement of input.measurements) {
    assertUnit("outcomeScore", measurement.outcomeScore);
    assertUnit("difficulty", measurement.difficulty);
    const measuredAt = parseIso(measurement.measuredAt, "measurement.measuredAt");
    if (seen.has(measurement.evidenceId)) {
      rejected.push(
        Object.freeze({ evidenceId: measurement.evidenceId, reason: "duplicate_evidence" }),
      );
      continue;
    }
    seen.add(measurement.evidenceId);
    if (!measurement.verified) {
      rejected.push(Object.freeze({ evidenceId: measurement.evidenceId, reason: "unverified" }));
      continue;
    }
    if (measurement.evaluationLeakage) {
      rejected.push(
        Object.freeze({ evidenceId: measurement.evidenceId, reason: "evaluation_leakage" }),
      );
      continue;
    }
    if (measurement.source === "practice") {
      practiceSampleSize += 1;
      continue; // practice evidence is isolated from the production score.
    }
    const ageMs = Math.max(0, now - measuredAt);
    const recencyWeight = 0.5 ** (ageMs / halfLife);
    const difficultyWeight = 0.25 + 0.75 * measurement.difficulty;
    production.push({
      evidenceId: measurement.evidenceId,
      outcomeScore: measurement.outcomeScore,
      difficulty: measurement.difficulty,
      weight: difficultyWeight * recencyWeight,
    });
  }

  const orderedRejected = stableSortBy(rejected, (entry) => entry.evidenceId);

  if (production.length < minimumSample) {
    return Object.freeze({
      outcome: "insufficient_evidence",
      reason: "insufficient_sample",
      productionSampleSize: production.length,
      requiredSampleSize: minimumSample,
      rejectedMeasurements: Object.freeze(orderedRejected),
      detail: `Need at least ${minimumSample} verified production measurements; found ${production.length}.`,
    });
  }

  const weightSum = production.reduce((sum, item) => sum + item.weight, 0);
  const observed =
    weightSum > 0
      ? production.reduce((sum, item) => sum + item.weight * item.outcomeScore, 0) / weightSum
      : production.reduce((sum, item) => sum + item.outcomeScore, 0) / production.length;

  const previousScore = input.current.current.score;
  const priorWeight = input.current.current.sampleSize;
  const n = production.length;
  const blended = (previousScore * priorWeight + observed * n) / (priorWeight + n);
  const step = Math.max(-maxStep, Math.min(maxStep, blended - previousScore));
  const newScore = Score.parse(Math.max(0, Math.min(1, previousScore + step)));

  const difficulties = production.map((item) => item.difficulty);
  const difficultyRange: readonly [number, number] = [
    Math.min(...difficulties),
    Math.max(...difficulties),
  ];
  const usedEvidenceIds = stableSortBy(
    production.map((item) => item.evidenceId),
    (id) => id,
  );
  const totalSampleSize = priorWeight + n;
  const support = Math.min(1, totalSampleSize / SUPPORT_TARGET_SAMPLE);

  const nextScore = CapabilityProfile.createScore({
    capabilityId: input.current.capabilityId,
    score: newScore,
    sampleSize: totalSampleSize,
    difficultyRange,
    evidenceIds: usedEvidenceIds,
    measuredAt: input.now,
  });

  return Object.freeze({
    outcome: "updated",
    capabilityId: input.current.capabilityId,
    previousScore,
    newScore,
    nextScore,
    productionSampleSize: n,
    practiceSampleSize,
    totalSampleSize,
    difficultyRange: Object.freeze(difficultyRange),
    usedEvidenceIds: Object.freeze(usedEvidenceIds),
    support,
    rejectedMeasurements: Object.freeze(orderedRejected),
  });
}

export const CapabilityCalculator = Object.freeze({ calculate: calculateCapability });
