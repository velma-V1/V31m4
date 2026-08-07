import { type IssueSeverity, ResourceBudget, Score } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Improvement Policy.
 *
 * Decides whether another refinement or repair round is justified. A round only
 * continues when at least one proposal names a concrete weakness, offers material
 * measurable benefit, and carries a verification method. Wording-only edits, speculative
 * enhancements, repeated failed repairs, exhausted rounds, and exhausted budgets all
 * stop the loop, and the remaining risk is reported when stopping.
 */

export type ImprovementKind = "repair" | "enhancement";

export interface ImprovementProposal {
  readonly issueId: string;
  readonly severity: IssueSeverity;
  readonly concreteWeakness: string;
  readonly expectedBenefit: number;
  readonly verificationMethod: string;
  readonly kind: ImprovementKind;
  readonly wordingOnly: boolean;
  readonly priorFailedAttempts: number;
}

export interface ImprovementPolicyInput {
  readonly proposals: readonly ImprovementProposal[];
  readonly completedRounds: number;
  readonly maxRepairRounds: number;
  readonly remainingBudget: ResourceBudget;
  readonly minimumMaterialBenefit?: number;
  readonly maxFailedAttempts?: number;
}

export type RejectionReason =
  | "no_concrete_weakness"
  | "no_verification_method"
  | "wording_only"
  | "insufficient_benefit"
  | "speculative_enhancement"
  | "repeated_failure";

export interface RejectedProposal {
  readonly issueId: string;
  readonly reason: RejectionReason;
}

export interface JustifiedRepair {
  readonly issueId: string;
  readonly severity: IssueSeverity;
  readonly expectedBenefit: number;
  readonly verificationMethod: string;
}

export interface RemainingRisk {
  readonly issueId: string;
  readonly severity: IssueSeverity;
}

export interface ContinueDecision {
  readonly outcome: "continue";
  readonly repairs: readonly JustifiedRepair[];
  readonly rejected: readonly RejectedProposal[];
  readonly roundsRemaining: number;
  readonly reason: string;
}

export type StopReason = "max_rounds_reached" | "budget_exhausted" | "no_material_improvement";

export interface StopDecision {
  readonly outcome: "stop";
  readonly reason: StopReason;
  readonly detail: string;
  readonly rejected: readonly RejectedProposal[];
  readonly remainingRisk: readonly RemainingRisk[];
}

export type ImprovementDecision = ContinueDecision | StopDecision;

const DEFAULT_MINIMUM_BENEFIT = 0.1;
const DEFAULT_MAX_FAILED_ATTEMPTS = 2;
const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `${name} must be a non-negative safe integer.`,
    );
  }
}

function evaluate(
  proposal: ImprovementProposal,
  minimumBenefit: number,
  maxFailed: number,
): RejectionReason | undefined {
  if (proposal.concreteWeakness.trim().length === 0) {
    return "no_concrete_weakness";
  }
  if (proposal.verificationMethod.trim().length === 0) {
    return "no_verification_method";
  }
  if (proposal.wordingOnly) {
    return "wording_only";
  }
  if (proposal.kind === "enhancement") {
    return "speculative_enhancement";
  }
  if (proposal.priorFailedAttempts >= maxFailed) {
    return "repeated_failure";
  }
  if (proposal.expectedBenefit < minimumBenefit) {
    return "insufficient_benefit";
  }
  return undefined;
}

function remainingRisk(proposals: readonly ImprovementProposal[]): RemainingRisk[] {
  return stableSortBy(
    proposals
      .filter((proposal) => proposal.severity === "critical" || proposal.severity === "high")
      .map((proposal) => Object.freeze({ issueId: proposal.issueId, severity: proposal.severity })),
    (risk) => `${SEVERITY_RANK[risk.severity]}:${risk.issueId}`,
  );
}

/** Decides whether to continue improving, and reports remaining risk when stopping. */
export function decideImprovement(input: ImprovementPolicyInput): ImprovementDecision {
  assertNonNegativeInteger("completedRounds", input.completedRounds);
  assertNonNegativeInteger("maxRepairRounds", input.maxRepairRounds);
  ResourceBudget.create(input.remainingBudget);
  const minimumBenefit = input.minimumMaterialBenefit ?? DEFAULT_MINIMUM_BENEFIT;
  Score.parse(minimumBenefit);
  const maxFailed = input.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS;
  for (const proposal of input.proposals) {
    Score.parse(proposal.expectedBenefit);
    assertNonNegativeInteger("priorFailedAttempts", proposal.priorFailedAttempts);
  }

  const rejected: RejectedProposal[] = [];
  const justified: ImprovementProposal[] = [];
  for (const proposal of input.proposals) {
    const reason = evaluate(proposal, minimumBenefit, maxFailed);
    if (reason === undefined) {
      justified.push(proposal);
    } else {
      rejected.push(Object.freeze({ issueId: proposal.issueId, reason }));
    }
  }
  const orderedRejected = stableSortBy(rejected, (entry) => entry.issueId);

  if (input.completedRounds >= input.maxRepairRounds) {
    return Object.freeze({
      outcome: "stop",
      reason: "max_rounds_reached",
      detail: `Completed ${input.completedRounds} of ${input.maxRepairRounds} permitted repair rounds.`,
      rejected: Object.freeze(orderedRejected),
      remainingRisk: Object.freeze(remainingRisk(input.proposals)),
    });
  }

  const budgetExhausted =
    input.remainingBudget.maxRepairRounds === 0 || input.remainingBudget.maxModelInvocations === 0;
  if (budgetExhausted) {
    return Object.freeze({
      outcome: "stop",
      reason: "budget_exhausted",
      detail: "The remaining resource budget cannot fund another repair round.",
      rejected: Object.freeze(orderedRejected),
      remainingRisk: Object.freeze(remainingRisk(input.proposals)),
    });
  }

  if (justified.length === 0) {
    return Object.freeze({
      outcome: "stop",
      reason: "no_material_improvement",
      detail: "No proposal offers a concrete, verifiable, material improvement.",
      rejected: Object.freeze(orderedRejected),
      remainingRisk: Object.freeze(remainingRisk(input.proposals)),
    });
  }

  const repairs = stableSortBy(
    justified.map((proposal) =>
      Object.freeze({
        issueId: proposal.issueId,
        severity: proposal.severity,
        expectedBenefit: proposal.expectedBenefit,
        verificationMethod: proposal.verificationMethod,
      }),
    ),
    (repair) =>
      `${SEVERITY_RANK[repair.severity]}:${(1 - repair.expectedBenefit).toFixed(6)}:${repair.issueId}`,
  );

  return Object.freeze({
    outcome: "continue",
    repairs: Object.freeze(repairs),
    rejected: Object.freeze(orderedRejected),
    roundsRemaining: input.maxRepairRounds - input.completedRounds,
    reason: `Continuing with ${repairs.length} justified repair(s) for concrete, verifiable weaknesses.`,
  });
}

export const ImprovementPolicy = Object.freeze({ decide: decideImprovement });
