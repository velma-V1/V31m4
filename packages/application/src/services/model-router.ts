import type { ModelProfile } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";

export interface ModelRoutingRequest {
  readonly profiles: readonly ModelProfile[];
  readonly requiredModality: string;
  readonly requiredCapabilityId?: string;
  readonly minimumContextTokens: number;
  readonly preferredModelId?: string;
  readonly maxInvocations: number;
}

export interface ModelRoutingPlan {
  readonly modelIds: readonly string[];
  readonly reason: string;
}

interface RankedModel {
  readonly profile: ModelProfile;
  readonly measuredScore?: number;
  readonly sampleSize: number;
}

/**
 * Produces a bounded, provider-neutral escalation plan. Verified measurements outrank
 * operator preference; preference is only a deterministic tie-break when measurements
 * cannot distinguish otherwise eligible models.
 */
export function routeModels(request: ModelRoutingRequest): ModelRoutingPlan {
  validateRequest(request);
  const ranked = request.profiles
    .filter((profile) => eligible(profile, request))
    .map((profile): RankedModel => {
      const measurement =
        request.requiredCapabilityId === undefined
          ? undefined
          : profile.measuredCapabilities.find(
              (candidate) => candidate.capabilityId === request.requiredCapabilityId,
            );
      return {
        profile,
        ...(measurement === undefined ? {} : { measuredScore: measurement.score }),
        sampleSize: measurement?.sampleSize ?? 0,
      };
    });

  if (ranked.length === 0) {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No available model satisfies the routing requirements.",
      { retryable: true },
    );
  }

  ranked.sort((left, right) => compareRanked(left, right, request.preferredModelId));
  const selected = ranked.slice(0, request.maxInvocations);
  const usesMeasurements = selected.some((candidate) => candidate.measuredScore !== undefined);
  return Object.freeze({
    modelIds: Object.freeze(selected.map((candidate) => candidate.profile.modelId as string)),
    reason: usesMeasurements
      ? "Ordered by verified measured capability, availability, and bounded escalation."
      : "No distinguishing verified measurement; ordered by availability and explicit preference.",
  });
}

function validateRequest(request: ModelRoutingRequest): void {
  if (
    request.requiredModality.length === 0 ||
    request.requiredModality !== request.requiredModality.trim() ||
    !Number.isSafeInteger(request.minimumContextTokens) ||
    request.minimumContextTokens < 0 ||
    !Number.isSafeInteger(request.maxInvocations) ||
    request.maxInvocations <= 0
  ) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "Model routing requirements are invalid.",
    );
  }
}

function eligible(profile: ModelProfile, request: ModelRoutingRequest): boolean {
  if (profile.status === "unavailable") return false;
  if (!profile.supportedModalities.includes(request.requiredModality)) return false;
  if (request.minimumContextTokens === 0) return true;
  return profile.contextLimit !== undefined && profile.contextLimit >= request.minimumContextTokens;
}

function compareRanked(
  left: RankedModel,
  right: RankedModel,
  preferredModelId: string | undefined,
): number {
  const measured =
    Number(right.measuredScore !== undefined) - Number(left.measuredScore !== undefined);
  if (measured !== 0) return measured;
  const score = (right.measuredScore ?? 0) - (left.measuredScore ?? 0);
  if (score !== 0) return score;
  const samples = right.sampleSize - left.sampleSize;
  if (samples !== 0) return samples;
  const availability =
    Number(left.profile.status === "degraded") - Number(right.profile.status === "degraded");
  if (availability !== 0) return availability;
  const preference =
    Number(right.profile.modelId === preferredModelId) -
    Number(left.profile.modelId === preferredModelId);
  if (preference !== 0) return preference;
  return left.profile.modelId.localeCompare(right.profile.modelId);
}
