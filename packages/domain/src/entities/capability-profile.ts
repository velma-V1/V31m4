import { assertDomain } from "../domain-errors.js";
import {
  CapabilityId,
  EvidenceId,
  type CapabilityId as CapabilityIdType,
  type EvidenceId as EvidenceIdType,
} from "../value-objects/ids.js";
import { Score, type Score as ScoreType } from "../value-objects/score.js";

export interface CapabilityScore {
  readonly capabilityId: CapabilityIdType;
  readonly score: ScoreType;
  readonly sampleSize: number;
  readonly difficultyRange: readonly [number, number];
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly measuredAt: string;
}

export interface CapabilityProfile {
  readonly capabilityId: CapabilityIdType;
  readonly displayName: string;
  readonly domain: string;
  readonly current: CapabilityScore;
  readonly history: readonly CapabilityScore[];
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function validateTimestamp(value: string): number {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_CAPABILITY_PROFILE",
    "Capability measurement time must be canonical UTC ISO-8601 with milliseconds.",
  );
  return parsed;
}

function createScore(input: {
  readonly capabilityId: string;
  readonly score: number;
  readonly sampleSize: number;
  readonly difficultyRange: readonly [number, number];
  readonly evidenceIds: readonly string[];
  readonly measuredAt: string;
}): CapabilityScore {
  validateTimestamp(input.measuredAt);
  assertDomain(
    Number.isSafeInteger(input.sampleSize) && input.sampleSize > 0,
    "INVALID_CAPABILITY_PROFILE",
    "Capability sample size must be a positive safe integer.",
  );
  const [minimum, maximum] = input.difficultyRange;
  assertDomain(
    Number.isFinite(minimum) &&
      Number.isFinite(maximum) &&
      minimum >= 0 &&
      maximum >= minimum,
    "INVALID_CAPABILITY_PROFILE",
    "Capability difficulty range must be finite, non-negative, and ordered.",
  );
  const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
  assertDomain(
    evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
    "INVALID_CAPABILITY_PROFILE",
    "Capability scores require at least one unique evidence record.",
  );
  return Object.freeze({
    capabilityId: CapabilityId.parse(input.capabilityId),
    score: Score.parse(input.score),
    sampleSize: input.sampleSize,
    difficultyRange: Object.freeze([minimum, maximum]) as readonly [number, number],
    evidenceIds: Object.freeze(evidenceIds),
    measuredAt: input.measuredAt,
  });
}

export const CapabilityProfile = Object.freeze({
  createScore,

  create(input: {
    readonly capabilityId: string;
    readonly displayName: string;
    readonly domain: string;
    readonly initialScore: Parameters<typeof createScore>[0];
  }): CapabilityProfile {
    assertDomain(
      input.displayName.length > 0 &&
        input.displayName === input.displayName.trim() &&
        input.displayName.length <= 160,
      "INVALID_CAPABILITY_PROFILE",
      "Capability display name must be canonical.",
    );
    assertDomain(
      input.domain.length > 0 && input.domain === input.domain.trim() && input.domain.length <= 160,
      "INVALID_CAPABILITY_PROFILE",
      "Capability domain must be canonical.",
    );
    const capabilityId = CapabilityId.parse(input.capabilityId);
    assertDomain(
      input.initialScore.capabilityId === capabilityId,
      "INVALID_CAPABILITY_PROFILE",
      "Initial score capability ID must match the profile.",
    );
    const current = createScore(input.initialScore);
    return Object.freeze({
      capabilityId,
      displayName: input.displayName,
      domain: input.domain,
      current,
      history: Object.freeze([current]),
    });
  },

  record(profile: CapabilityProfile, scoreInput: Parameters<typeof createScore>[0]): CapabilityProfile {
    assertDomain(
      scoreInput.capabilityId === profile.capabilityId,
      "INVALID_CAPABILITY_PROFILE",
      "Capability score must match the profile.",
    );
    const next = createScore(scoreInput);
    assertDomain(
      validateTimestamp(next.measuredAt) >= validateTimestamp(profile.current.measuredAt),
      "INVALID_STATE_TRANSITION",
      "Capability measurement time cannot move backward.",
    );
    return Object.freeze({
      ...profile,
      current: next,
      history: Object.freeze([...profile.history, next]),
    });
  },
});
