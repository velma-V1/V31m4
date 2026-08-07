import type { IssueRecord, ResourceBudget } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export type ImprovementDecision =
  | Readonly<{ action: "continue"; issueIds: readonly string[]; reason: string }>
  | Readonly<{ action: "stop"; remainingRiskIds: readonly string[]; reason: string }>;

export interface ImprovementPolicyInput {
  readonly issues: readonly IssueRecord[];
  readonly completedRepairRounds: number;
  readonly failedRepairSignatures: readonly string[];
  readonly proposedRepairSignatures: Readonly<Record<string, string>>;
  readonly expectedMaterialBenefit: Readonly<Record<string, number>>;
  readonly verificationMethodsAvailable: readonly string[];
  readonly budget: ResourceBudget;
}

const SEVERITY_ORDER: Readonly<Record<IssueRecord["severity"], number>> = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });

export function decideImprovement(input: ImprovementPolicyInput): ImprovementDecision {
  assertApplication(Number.isSafeInteger(input.completedRepairRounds) && input.completedRepairRounds >= 0, "INVALID_APPLICATION_INPUT", "Repair round count is invalid.");
  const open = input.issues.filter((issue) => issue.status === "open" || issue.status === "accepted");
  if (open.length === 0) {
    return Object.freeze({ action: "stop", remainingRiskIds: Object.freeze([]), reason: "No unresolved evidence-backed issue remains." });
  }
  if (input.completedRepairRounds >= input.budget.maxRepairRounds) {
    return Object.freeze({ action: "stop", remainingRiskIds: Object.freeze(open.map((issue) => String(issue.id))), reason: "The approved repair-round budget is exhausted." });
  }

  const failed = new Set(input.failedRepairSignatures);
  const verifiers = new Set(input.verificationMethodsAvailable);
  const eligible = open.filter((issue) => {
    const signature = input.proposedRepairSignatures[String(issue.id)];
    const benefit = input.expectedMaterialBenefit[String(issue.id)] ?? 0;
    return signature !== undefined && !failed.has(signature) && benefit >= 0.1 && verifiers.has(issue.verificationMethod);
  });
  eligible.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || String(left.id).localeCompare(String(right.id)));
  if (eligible.length === 0) {
    return Object.freeze({
      action: "stop",
      remainingRiskIds: Object.freeze(open.map((issue) => String(issue.id)).sort()),
      reason: "Remaining changes are unverifiable, immaterial, or repeat a failed repair pattern.",
    });
  }
  return Object.freeze({
    action: "continue",
    issueIds: Object.freeze(eligible.map((issue) => String(issue.id))),
    reason: "At least one material evidence-backed issue has a novel repair and an available verification method.",
  });
}
