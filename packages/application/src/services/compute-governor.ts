import { ResourceBudget, Score, type ResourceBudget as ResourceBudgetType, type Score as ScoreType } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";

export type ExecutionMode = "direct" | "checked" | "competitive" | "adversarial";

export interface ComputeGovernorInput {
  readonly complexity: ScoreType;
  readonly risk: ScoreType;
  readonly ambiguity: ScoreType;
  readonly value: ScoreType;
  readonly reversible: boolean;
  readonly securityCritical: boolean;
  readonly deterministicVerificationAvailable: boolean;
  readonly availableWorkers: number;
  readonly deadlineRemainingMs: number;
  readonly approvedBudget: ResourceBudgetType;
}

export interface ComputeGovernorDecision {
  readonly mode: ExecutionMode;
  readonly budget: ResourceBudgetType;
  readonly reasons: readonly string[];
}

const MODE_MULTIPLIER: Readonly<Record<ExecutionMode, number>> = Object.freeze({
  direct: 1,
  checked: 2,
  competitive: 3,
  adversarial: 4,
});

function bounded(value: number, ceiling: number): number {
  return Math.max(0, Math.min(value, ceiling));
}

export function chooseExecutionPlan(input: ComputeGovernorInput): ComputeGovernorDecision {
  Score.parse(input.complexity);
  Score.parse(input.risk);
  Score.parse(input.ambiguity);
  Score.parse(input.value);
  const approved = ResourceBudget.create(input.approvedBudget);
  assertApplication(
    Number.isSafeInteger(input.availableWorkers) && input.availableWorkers > 0,
    "INVALID_APPLICATION_INPUT",
    "Available workers must be a positive safe integer.",
  );
  assertApplication(
    Number.isSafeInteger(input.deadlineRemainingMs) && input.deadlineRemainingMs > 0,
    "DEADLINE_EXCEEDED",
    "A positive execution window is required.",
  );

  let mode: ExecutionMode;
  const reasons: string[] = [];
  if (input.securityCritical || input.risk >= 0.85 || (!input.reversible && input.risk >= 0.7)) {
    mode = "adversarial";
    reasons.push("Failure impact requires adversarial challenge and independent verification.");
  } else if (input.ambiguity >= 0.65 || input.value >= 0.8 || input.complexity >= 0.8) {
    mode = "competitive";
    reasons.push("Material ambiguity or value justifies multiple independent candidates.");
  } else if (input.deterministicVerificationAvailable && (input.risk >= 0.25 || input.complexity >= 0.4)) {
    mode = "checked";
    reasons.push("Deterministic verification is available for a non-trivial mission.");
  } else {
    mode = "direct";
    reasons.push("The mission is low-risk, reversible, and sufficiently simple for direct execution.");
  }

  if (mode !== "direct" && !input.deterministicVerificationAvailable) {
    if (input.risk >= 0.5 || input.securityCritical || !input.reversible) {
      throw new ApplicationError(
        "POLICY_REJECTED",
        "Risk requires independent verification, but no deterministic verification is available.",
        { details: { requestedMode: mode, risk: input.risk } },
      );
    }
    mode = "direct";
    reasons.push("Execution was reduced to direct mode because independent verification is unavailable.");
  }

  const multiplier = MODE_MULTIPLIER[mode];
  const desiredWorkers = Math.min(multiplier, input.availableWorkers, approved.maxConcurrentWorkers);
  const budget: ResourceBudgetType = ResourceBudget.create({
    maxWallClockMs: Math.min(approved.maxWallClockMs, input.deadlineRemainingMs),
    maxModelInvocations: bounded(multiplier, approved.maxModelInvocations),
    maxToolInvocations: bounded(Math.max(1, multiplier - 1), approved.maxToolInvocations),
    maxRepairRounds: bounded(mode === "direct" ? 0 : multiplier - 1, approved.maxRepairRounds),
    maxConcurrentWorkers: Math.max(1, desiredWorkers),
    ...(approved.maxInputTokens === undefined
      ? {}
      : { maxInputTokens: Math.max(1, Math.floor(approved.maxInputTokens / (mode === "direct" ? 2 : 1))) }),
    ...(approved.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: Math.max(1, Math.floor(approved.maxOutputTokens / (mode === "direct" ? 2 : 1))) }),
    ...(approved.maxRamBytes === undefined ? {} : { maxRamBytes: approved.maxRamBytes }),
    ...(approved.maxVramBytes === undefined ? {} : { maxVramBytes: approved.maxVramBytes }),
  });

  assertApplication(
    budget.maxWallClockMs > 0 && budget.maxModelInvocations > 0,
    "RESOURCE_EXHAUSTED",
    "The approved budget cannot support the selected execution mode.",
    { details: { mode } },
  );

  return Object.freeze({ mode, budget, reasons: Object.freeze(reasons) });
}
