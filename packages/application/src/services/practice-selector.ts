import type { CapabilityProfile, ResourceBudget } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export interface PracticeCandidate {
  readonly id: string;
  readonly capabilityId: string;
  readonly targetDifficulty: number;
  readonly estimatedBudget: ResourceBudget;
  readonly requiresProductionWrite: boolean;
  readonly requiresSecret: boolean;
  readonly independentlyVerifiable: boolean;
  readonly lastSelectedAt?: string;
}

export interface PracticeSelectionInput {
  readonly profiles: readonly CapabilityProfile[];
  readonly candidates: readonly PracticeCandidate[];
  readonly now: string;
  readonly idleForMs: number;
  readonly requiredIdleMs: number;
  readonly cooldownMs: number;
  readonly availableBudget: ResourceBudget;
  readonly recentCapabilityIds: readonly string[];
}

export type PracticeSelection =
  | Readonly<{ selected: PracticeCandidate; reason: string }>
  | Readonly<{ selected: null; reason: string }>;

function fits(candidate: PracticeCandidate, budget: ResourceBudget): boolean {
  return candidate.estimatedBudget.maxWallClockMs <= budget.maxWallClockMs &&
    candidate.estimatedBudget.maxModelInvocations <= budget.maxModelInvocations &&
    candidate.estimatedBudget.maxToolInvocations <= budget.maxToolInvocations &&
    candidate.estimatedBudget.maxConcurrentWorkers <= budget.maxConcurrentWorkers;
}

export function selectPracticeTask(input: PracticeSelectionInput): PracticeSelection {
  assertApplication(Number.isSafeInteger(input.idleForMs) && input.idleForMs >= 0, "INVALID_APPLICATION_INPUT", "Idle duration is invalid.");
  assertApplication(Number.isSafeInteger(input.requiredIdleMs) && input.requiredIdleMs >= 0, "INVALID_APPLICATION_INPUT", "Required idle duration is invalid.");
  assertApplication(Number.isSafeInteger(input.cooldownMs) && input.cooldownMs >= 0, "INVALID_APPLICATION_INPUT", "Cooldown is invalid.");
  const now = Date.parse(input.now);
  assertApplication(Number.isFinite(now), "INVALID_APPLICATION_INPUT", "Practice selection time is invalid.");
  if (input.idleForMs < input.requiredIdleMs) {
    return Object.freeze({ selected: null, reason: "The runtime is not idle long enough for practice." });
  }
  const profileById = new Map(input.profiles.map((profile) => [String(profile.capabilityId), profile]));
  const recent = new Set(input.recentCapabilityIds);
  const eligible = input.candidates.filter((candidate) => {
    const last = candidate.lastSelectedAt === undefined ? undefined : Date.parse(candidate.lastSelectedAt);
    const cooled = last === undefined || Number.isFinite(last) && now - last >= input.cooldownMs;
    return profileById.has(candidate.capabilityId) && cooled && !candidate.requiresProductionWrite && !candidate.requiresSecret && candidate.independentlyVerifiable && fits(candidate, input.availableBudget);
  });
  if (eligible.length === 0) {
    return Object.freeze({ selected: null, reason: "No safe, independently verifiable practice task is eligible." });
  }
  eligible.sort((left, right) => {
    const leftProfile = profileById.get(left.capabilityId);
    const rightProfile = profileById.get(right.capabilityId);
    assertApplication(leftProfile !== undefined && rightProfile !== undefined, "INTEGRITY_FAILURE", "Practice candidate lacks a capability profile.");
    const rotationPenaltyLeft = recent.has(left.capabilityId) ? 1 : 0;
    const rotationPenaltyRight = recent.has(right.capabilityId) ? 1 : 0;
    return rotationPenaltyLeft - rotationPenaltyRight || leftProfile.current.score - rightProfile.current.score || left.id.localeCompare(right.id);
  });
  const selected = eligible[0];
  assertApplication(selected !== undefined, "INTEGRITY_FAILURE", "Eligible practice set unexpectedly became empty.");
  return Object.freeze({ selected: Object.freeze({ ...selected }), reason: "Selected the weakest eligible capability while respecting cooldown and rotation." });
}
