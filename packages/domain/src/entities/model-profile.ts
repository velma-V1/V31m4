import { assertDomain } from "../domain-errors.js";
import {
  AdapterId,
  ModelId,
  type AdapterId as AdapterIdType,
  type ModelId as ModelIdType,
} from "../value-objects/ids.js";
import { CapabilityProfile, type CapabilityScore } from "./capability-profile.js";

export type ProfileAvailability = "available" | "unavailable" | "degraded";

export interface ModelProfile {
  readonly modelId: ModelIdType;
  readonly adapterId: AdapterIdType;
  readonly displayName: string;
  readonly status: ProfileAvailability;
  readonly local: boolean;
  readonly contextLimit?: number;
  readonly measuredCapabilities: readonly CapabilityScore[];
  readonly supportedModalities: readonly string[];
}

const STATUSES = new Set<ProfileAvailability>(["available", "unavailable", "degraded"]);

export const ModelProfile = Object.freeze({
  create(input: {
    readonly modelId: string;
    readonly adapterId: string;
    readonly displayName: string;
    readonly status: ProfileAvailability;
    readonly local: boolean;
    readonly contextLimit?: number;
    readonly measuredCapabilities?: readonly CapabilityScore[];
    readonly supportedModalities: readonly string[];
  }): ModelProfile {
    assertDomain(STATUSES.has(input.status), "INVALID_MODEL_PROFILE", "Model status is invalid.");
    assertDomain(
      input.displayName.length > 0 &&
        input.displayName === input.displayName.trim() &&
        input.displayName.length <= 160,
      "INVALID_MODEL_PROFILE",
      "Model display name must be canonical.",
    );
    if (input.contextLimit !== undefined) {
      assertDomain(
        Number.isSafeInteger(input.contextLimit) && input.contextLimit > 0,
        "INVALID_MODEL_PROFILE",
        "Model context limit must be a positive safe integer.",
      );
    }
    const modalities = input.supportedModalities.map((value) => value.trim());
    assertDomain(
      modalities.length > 0 &&
        modalities.every((value) => value.length > 0 && value.length <= 80) &&
        new Set(modalities).size === modalities.length,
      "INVALID_MODEL_PROFILE",
      "Model modalities must contain unique canonical values.",
    );
    const measuredCapabilities = (input.measuredCapabilities ?? []).map((value) =>
      CapabilityProfile.createScore({
        capabilityId: value.capabilityId,
        score: value.score,
        sampleSize: value.sampleSize,
        difficultyRange: value.difficultyRange,
        evidenceIds: value.evidenceIds,
        measuredAt: value.measuredAt,
      }),
    );
    const capabilityIds = measuredCapabilities.map((value) => value.capabilityId);
    assertDomain(
      new Set(capabilityIds).size === capabilityIds.length,
      "INVALID_MODEL_PROFILE",
      "Model capability measurements must be unique by capability.",
    );
    return Object.freeze({
      modelId: ModelId.parse(input.modelId),
      adapterId: AdapterId.parse(input.adapterId),
      displayName: input.displayName,
      status: input.status,
      local: input.local,
      ...(input.contextLimit === undefined ? {} : { contextLimit: input.contextLimit }),
      measuredCapabilities: Object.freeze(measuredCapabilities),
      supportedModalities: Object.freeze(modalities),
    });
  },
});
