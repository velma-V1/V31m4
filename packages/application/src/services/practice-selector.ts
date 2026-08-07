import { ResourceBudget, Score } from "@v31m4/domain";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Practice Selector.
 *
 * Selects a safe, isolated practice task that targets a measured weak capability. It
 * honours the idle-only policy, cooldowns, and resource budgets, rotates across
 * capabilities to avoid starvation, and excludes any task that would touch production
 * state, use production secrets, or lack independent verification. It returns no task
 * when practice is unsafe or unjustified, always with a recorded rationale.
 */

export interface PracticeCandidate {
  readonly taskId: string;
  readonly capabilityId: string;
  readonly requiresProductionWrite: boolean;
  readonly usesProductionSecrets: boolean;
  readonly hasIndependentVerification: boolean;
  readonly hasMeasurableOutcome: boolean;
  readonly estimatedCost: ResourceBudget;
  readonly targetDifficulty: number;
}

export interface CapabilityWeakness {
  readonly capabilityId: string;
  readonly score: number;
  readonly sampleSize: number;
}

export interface PracticeSelectorInput {
  readonly candidates: readonly PracticeCandidate[];
  readonly weakCapabilities: readonly CapabilityWeakness[];
  readonly systemIdle: boolean;
  readonly availableBudget: ResourceBudget;
  readonly cooldownCapabilityIds?: readonly string[];
  readonly recentlyPracticedCapabilityIds?: readonly string[];
  readonly weaknessThreshold?: number;
}

export type PracticeExclusionReason =
  | "capability_not_weak"
  | "capability_in_cooldown"
  | "requires_production_write"
  | "uses_production_secrets"
  | "no_independent_verification"
  | "budget_exceeded";

export interface ExcludedPractice {
  readonly taskId: string;
  readonly reason: PracticeExclusionReason;
}

export interface PracticeSelection {
  readonly outcome: "selected";
  readonly taskId: string;
  readonly capabilityId: string;
  readonly targetDifficulty: number;
  readonly rationale: readonly string[];
  readonly excluded: readonly ExcludedPractice[];
}

export interface PracticeNoSelection {
  readonly outcome: "no_task";
  readonly reason: "not_idle" | "no_eligible_task";
  readonly detail: string;
  readonly excluded: readonly ExcludedPractice[];
}

export type PracticeSelectorResult = PracticeSelection | PracticeNoSelection;

const DEFAULT_WEAKNESS_THRESHOLD = 0.6;

function budgetFits(cost: ResourceBudget, available: ResourceBudget): boolean {
  return (
    cost.maxWallClockMs <= available.maxWallClockMs &&
    cost.maxModelInvocations <= available.maxModelInvocations &&
    cost.maxToolInvocations <= available.maxToolInvocations &&
    cost.maxRepairRounds <= available.maxRepairRounds &&
    cost.maxConcurrentWorkers <= available.maxConcurrentWorkers
  );
}

/** Selects a single safe practice task, or returns no task with a recorded reason. */
export function selectPracticeTask(input: PracticeSelectorInput): PracticeSelectorResult {
  ResourceBudget.create(input.availableBudget);
  const threshold = input.weaknessThreshold ?? DEFAULT_WEAKNESS_THRESHOLD;
  Score.parse(threshold);

  if (!input.systemIdle) {
    return Object.freeze({
      outcome: "no_task",
      reason: "not_idle",
      detail: "Practice only runs while the system is idle.",
      excluded: Object.freeze([]),
    });
  }

  const cooldown = new Set(input.cooldownCapabilityIds ?? []);
  const recentlyPracticed = new Set(input.recentlyPracticedCapabilityIds ?? []);
  const weakScores = new Map<string, number>();
  for (const weakness of input.weakCapabilities) {
    Score.parse(weakness.score);
    if (weakness.sampleSize > 0 && weakness.score < threshold) {
      weakScores.set(weakness.capabilityId, weakness.score);
    }
  }

  const excluded: ExcludedPractice[] = [];
  const eligible: { candidate: PracticeCandidate; score: number }[] = [];
  for (const candidate of input.candidates) {
    Score.parse(candidate.targetDifficulty);
    ResourceBudget.create(candidate.estimatedCost);
    const reason = classify(candidate, weakScores, cooldown, input.availableBudget);
    if (reason === undefined) {
      eligible.push({ candidate, score: weakScores.get(candidate.capabilityId) as number });
    } else {
      excluded.push(Object.freeze({ taskId: candidate.taskId, reason }));
    }
  }
  const orderedExcluded = stableSortBy(excluded, (entry) => entry.taskId);

  if (eligible.length === 0) {
    return Object.freeze({
      outcome: "no_task",
      reason: "no_eligible_task",
      detail: "No safe, verifiable practice task targets a measured weak capability within budget.",
      excluded: Object.freeze(orderedExcluded),
    });
  }

  const ranked = stableSortBy(eligible, ({ candidate, score }) => {
    const recent = recentlyPracticed.has(candidate.capabilityId) ? 1 : 0;
    const measurable = candidate.hasMeasurableOutcome ? 0 : 1;
    return `${recent}:${measurable}:${score.toFixed(6)}:${candidate.capabilityId}:${candidate.taskId}`;
  });
  const chosen = ranked[0] as { candidate: PracticeCandidate; score: number };

  const rationale = [
    `capability ${chosen.candidate.capabilityId} is weak (score ${chosen.score.toFixed(3)} below ${threshold})`,
    recentlyPracticed.has(chosen.candidate.capabilityId)
      ? "no less-recently-practiced weak capability was eligible"
      : "capability was not practiced in the recent rotation window",
    chosen.candidate.hasMeasurableOutcome
      ? "task has a measurable outcome"
      : "task selected despite no preferred measurable outcome",
    "task is isolated: no production writes, no production secrets, independent verification present",
  ];

  return Object.freeze({
    outcome: "selected",
    taskId: chosen.candidate.taskId,
    capabilityId: chosen.candidate.capabilityId,
    targetDifficulty: chosen.candidate.targetDifficulty,
    rationale: Object.freeze(rationale),
    excluded: Object.freeze(orderedExcluded),
  });
}

function classify(
  candidate: PracticeCandidate,
  weakScores: ReadonlyMap<string, number>,
  cooldown: ReadonlySet<string>,
  availableBudget: ResourceBudget,
): PracticeExclusionReason | undefined {
  if (!weakScores.has(candidate.capabilityId)) {
    return "capability_not_weak";
  }
  if (cooldown.has(candidate.capabilityId)) {
    return "capability_in_cooldown";
  }
  if (candidate.requiresProductionWrite) {
    return "requires_production_write";
  }
  if (candidate.usesProductionSecrets) {
    return "uses_production_secrets";
  }
  if (!candidate.hasIndependentVerification) {
    return "no_independent_verification";
  }
  if (!budgetFits(candidate.estimatedCost, availableBudget)) {
    return "budget_exceeded";
  }
  return undefined;
}

export const PracticeSelector = Object.freeze({ select: selectPracticeTask });
