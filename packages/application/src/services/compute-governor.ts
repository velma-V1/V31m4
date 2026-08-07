import { ResourceBudget, Score } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";

/**
 * Compute Governor.
 *
 * Selects the execution depth (mode) and a resource budget for a mission from its
 * risk profile, verification availability, deadline, available capacity, and the
 * user-approved ceiling. The service is a pure decision function: it returns a
 * selection, a refusal, or a deferral and never performs side effects.
 */

export type ExecutionMode = "direct" | "checked" | "competitive" | "adversarial";

export type ReversibilityLevel = "reversible" | "irreversible";

export type EvidenceStrength = "standard" | "high" | "critical";

export interface AvailableResources {
  readonly wallClockMs: number;
  readonly modelInvocations: number;
  readonly toolInvocations: number;
  readonly concurrentWorkers: number;
}

export interface ComputeGovernorInput {
  /** Normalised mission complexity in the inclusive range [0, 1]. */
  readonly complexity: number;
  /** Normalised mission risk in the inclusive range [0, 1]. */
  readonly risk: number;
  readonly reversibility: ReversibilityLevel;
  /** Whether independent deterministic verification exists for this mission. */
  readonly deterministicVerificationAvailable: boolean;
  readonly securityCritical: boolean;
  readonly requiredEvidenceStrength: EvidenceStrength;
  /** Estimated cost of a single solving pass. */
  readonly estimatedCost: ResourceBudget;
  /** Capacity currently available on the host. */
  readonly available: AvailableResources;
  /** User-approved resource ceiling that budgets may never exceed. */
  readonly approvedCeiling: ResourceBudget;
  /** Remaining wall-clock time budget in milliseconds, when a deadline applies. */
  readonly deadlineMs?: number;
}

export interface ComputeGovernorSelection {
  readonly outcome: "selected";
  readonly mode: ExecutionMode;
  readonly budget: ResourceBudget;
  readonly reasons: readonly string[];
}

export interface ComputeGovernorRefusal {
  readonly outcome: "refused" | "deferred";
  readonly reason: "insufficient_resources" | "deadline_unattainable" | "verification_unavailable";
  readonly detail: string;
  readonly reasons: readonly string[];
}

export type ComputeGovernorDecision = ComputeGovernorSelection | ComputeGovernorRefusal;

const LOW_RISK = 0.25;
const MEDIUM_RISK = 0.5;
const HIGH_RISK = 0.75;
const HIGH_COMPLEXITY = 0.6;

const MODE_RANK: Readonly<Record<ExecutionMode, number>> = {
  direct: 0,
  checked: 1,
  competitive: 2,
  adversarial: 3,
};
const RANKED_MODES: readonly ExecutionMode[] = ["direct", "checked", "competitive", "adversarial"];

/** Candidate multiplier applied to per-pass model/tool work for each mode. */
const CANDIDATE_MULTIPLIER: Readonly<Record<ExecutionMode, number>> = {
  direct: 1,
  checked: 1,
  competitive: 3,
  adversarial: 4,
};
/** Serial time weight for each mode (verification and repair rounds add latency). */
const TIME_WEIGHT: Readonly<Record<ExecutionMode, number>> = {
  direct: 1,
  checked: 1.5,
  competitive: 2,
  adversarial: 3,
};
/** Additional repair rounds each mode is allowed to spend. */
const EXTRA_REPAIR_ROUNDS: Readonly<Record<ExecutionMode, number>> = {
  direct: 0,
  checked: 0,
  competitive: 1,
  adversarial: 2,
};

function assertUnitInterval(name: string, value: number): number {
  try {
    return Score.parse(value);
  } catch {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `${name} must be a finite number between 0 and 1.`,
      { details: { field: name } },
    );
  }
}

function assertAvailable(available: AvailableResources): void {
  for (const [field, value] of Object.entries(available)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        `available.${field} must be a non-negative safe integer.`,
        { details: { field } },
      );
    }
  }
}

function assertDeadline(deadlineMs: number | undefined): void {
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "deadlineMs must be a positive finite number when provided.",
      { details: { field: "deadlineMs" } },
    );
  }
}

function safetyFloor(input: ComputeGovernorInput): ExecutionMode {
  const irreversible = input.reversibility === "irreversible";
  if (
    input.securityCritical ||
    input.requiredEvidenceStrength === "critical" ||
    (input.risk >= HIGH_RISK && irreversible)
  ) {
    return "adversarial";
  }
  if (input.requiredEvidenceStrength === "high" || input.risk >= HIGH_RISK) {
    return "competitive";
  }
  if (input.risk >= MEDIUM_RISK && irreversible) {
    return "competitive";
  }
  if (input.risk > LOW_RISK || irreversible) {
    return "checked";
  }
  return "direct";
}

function withComplexityUpgrade(floor: ExecutionMode, input: ComputeGovernorInput): ExecutionMode {
  if (input.complexity >= HIGH_COMPLEXITY && MODE_RANK[floor] < MODE_RANK.competitive) {
    return "competitive";
  }
  return floor;
}

function clampInt(desired: number, ...ceilings: readonly (number | undefined)[]): number {
  let value = desired;
  for (const ceiling of ceilings) {
    if (ceiling !== undefined) {
      value = Math.min(value, ceiling);
    }
  }
  return Math.max(0, Math.floor(value));
}

function modeMinimumFits(mode: ExecutionMode, input: ComputeGovernorInput): boolean {
  const cost = input.estimatedCost;
  const ceiling = input.approvedCeiling;
  const available = input.available;
  // At minimum one pass must fit under the ceiling and available capacity.
  if (cost.maxModelInvocations > ceiling.maxModelInvocations) {
    return false;
  }
  if (cost.maxToolInvocations > ceiling.maxToolInvocations) {
    return false;
  }
  if (cost.maxWallClockMs > ceiling.maxWallClockMs) {
    return false;
  }
  if (cost.maxModelInvocations > available.modelInvocations) {
    return false;
  }
  if (cost.maxToolInvocations > available.toolInvocations) {
    return false;
  }
  const requiredWorkers = mode === "competitive" || mode === "adversarial" ? 2 : 1;
  if (
    requiredWorkers > ceiling.maxConcurrentWorkers ||
    requiredWorkers > available.concurrentWorkers
  ) {
    return false;
  }
  if (
    input.deadlineMs !== undefined &&
    cost.maxWallClockMs * TIME_WEIGHT[mode] > input.deadlineMs
  ) {
    return false;
  }
  return true;
}

function buildBudget(mode: ExecutionMode, input: ComputeGovernorInput): ResourceBudget {
  const cost = input.estimatedCost;
  const ceiling = input.approvedCeiling;
  const multiplier = CANDIDATE_MULTIPLIER[mode];
  const desiredWorkers = mode === "competitive" || mode === "adversarial" ? multiplier : 1;
  const budget: ResourceBudget = {
    maxWallClockMs: clampInt(
      cost.maxWallClockMs * TIME_WEIGHT[mode],
      ceiling.maxWallClockMs,
      input.deadlineMs,
    ),
    maxModelInvocations: clampInt(
      cost.maxModelInvocations * multiplier,
      ceiling.maxModelInvocations,
    ),
    maxToolInvocations: clampInt(cost.maxToolInvocations * multiplier, ceiling.maxToolInvocations),
    maxRepairRounds: clampInt(
      cost.maxRepairRounds + EXTRA_REPAIR_ROUNDS[mode],
      ceiling.maxRepairRounds,
    ),
    maxConcurrentWorkers: Math.max(
      1,
      clampInt(desiredWorkers, ceiling.maxConcurrentWorkers, input.available.concurrentWorkers),
    ),
    ...optionalCeiling("maxInputTokens", cost.maxInputTokens, ceiling.maxInputTokens),
    ...optionalCeiling("maxOutputTokens", cost.maxOutputTokens, ceiling.maxOutputTokens),
    ...optionalCeiling("maxRamBytes", cost.maxRamBytes, ceiling.maxRamBytes),
    ...optionalCeiling("maxVramBytes", cost.maxVramBytes, ceiling.maxVramBytes),
  };
  return ResourceBudget.create(budget);
}

function optionalCeiling(
  key: "maxInputTokens" | "maxOutputTokens" | "maxRamBytes" | "maxVramBytes",
  cost: number | undefined,
  ceiling: number | undefined,
): Record<string, number> {
  if (cost === undefined) {
    return {};
  }
  return { [key]: ceiling === undefined ? cost : Math.min(cost, ceiling) };
}

/**
 * Selects an execution mode and budget for a mission. Returns a `selected`
 * decision, or a `refused`/`deferred` decision when resources, the deadline, or
 * missing verification make a safe selection impossible.
 */
export function selectComputeDecision(input: ComputeGovernorInput): ComputeGovernorDecision {
  assertUnitInterval("complexity", input.complexity);
  assertUnitInterval("risk", input.risk);
  assertAvailable(input.available);
  assertDeadline(input.deadlineMs);
  ResourceBudget.create(input.estimatedCost);
  ResourceBudget.create(input.approvedCeiling);

  const floor = safetyFloor(input);
  const desired = withComplexityUpgrade(floor, input);
  const reasons: string[] = [
    `safety floor is ${floor} for risk ${input.risk}, reversibility ${input.reversibility}, evidence ${input.requiredEvidenceStrength}`,
  ];

  // Verification feasibility: modes above `direct` require independent verification.
  let target = desired;
  if (MODE_RANK[target] > MODE_RANK.direct && !input.deterministicVerificationAvailable) {
    if (MODE_RANK[floor] > MODE_RANK.direct) {
      return {
        outcome: "deferred",
        reason: "verification_unavailable",
        detail:
          "Required execution depth needs independent deterministic verification, which is unavailable.",
        reasons: Object.freeze([
          ...reasons,
          "verification unavailable; refusing to claim a high-confidence mode",
        ]),
      };
    }
    target = "direct";
    reasons.push("verification unavailable; complexity upgrade dropped to direct");
  }

  // Deadline and resource feasibility: downgrade toward the safety floor until a
  // mode fits; refuse if even the safety floor cannot fit.
  let feasible: ExecutionMode | undefined;
  for (let rank = MODE_RANK[target]; rank >= MODE_RANK[floor]; rank -= 1) {
    const candidate = RANKED_MODES[rank];
    if (candidate !== undefined && modeMinimumFits(candidate, input)) {
      feasible = candidate;
      break;
    }
  }

  if (feasible === undefined) {
    const deadlineBlocks =
      input.deadlineMs !== undefined &&
      input.estimatedCost.maxWallClockMs * TIME_WEIGHT[floor] > input.deadlineMs;
    return {
      outcome: "refused",
      reason: deadlineBlocks ? "deadline_unattainable" : "insufficient_resources",
      detail: deadlineBlocks
        ? "The safety-required execution depth cannot complete within the deadline."
        : "Available resources or the approved ceiling cannot cover the safety-required execution depth.",
      reasons: Object.freeze([...reasons, `no mode at or above ${floor} fits the constraints`]),
    };
  }

  if (MODE_RANK[feasible] < MODE_RANK[target]) {
    reasons.push(
      `downgraded from ${target} to ${feasible} to satisfy deadline and resource limits`,
    );
  }
  reasons.push(`selected ${feasible} within the approved ceiling`);

  return {
    outcome: "selected",
    mode: feasible,
    budget: buildBudget(feasible, input),
    reasons: Object.freeze(reasons),
  };
}

export const ComputeGovernor = Object.freeze({ select: selectComputeDecision });
