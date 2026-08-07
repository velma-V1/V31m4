import { Score } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { chooseExecutionPlan } from "../../src/index.js";
import { budget } from "./fixtures.js";

describe("compute governor", () => {
  it("selects direct mode for simple reversible work", () => {
    const decision = chooseExecutionPlan({ complexity: Score.parse(0.1), risk: Score.parse(0.1), ambiguity: Score.parse(0.1), value: Score.parse(0.2), reversible: true, securityCritical: false, deterministicVerificationAvailable: false, availableWorkers: 4, deadlineRemainingMs: 20_000, approvedBudget: budget() });
    expect(decision.mode).toBe("direct");
    expect(decision.budget.maxModelInvocations).toBe(1);
  });

  it("selects adversarial mode for security-critical work", () => {
    const decision = chooseExecutionPlan({ complexity: Score.parse(0.8), risk: Score.parse(0.9), ambiguity: Score.parse(0.4), value: Score.parse(1), reversible: false, securityCritical: true, deterministicVerificationAvailable: true, availableWorkers: 8, deadlineRemainingMs: 60_000, approvedBudget: budget({ maxConcurrentWorkers: 8 }) });
    expect(decision.mode).toBe("adversarial");
    expect(decision.budget.maxConcurrentWorkers).toBe(4);
  });

  it("rejects risky work without independent verification", () => {
    expect(() => chooseExecutionPlan({ complexity: Score.parse(0.8), risk: Score.parse(0.8), ambiguity: Score.parse(0.8), value: Score.parse(0.9), reversible: false, securityCritical: false, deterministicVerificationAvailable: false, availableWorkers: 4, deadlineRemainingMs: 20_000, approvedBudget: budget() })).toThrow();
  });

  it("clamps execution to the approved deadline and worker ceiling", () => {
    const decision = chooseExecutionPlan({ complexity: Score.parse(0.6), risk: Score.parse(0.4), ambiguity: Score.parse(0.2), value: Score.parse(0.4), reversible: true, securityCritical: false, deterministicVerificationAvailable: true, availableWorkers: 1, deadlineRemainingMs: 5_000, approvedBudget: budget({ maxWallClockMs: 60_000 }) });
    expect(decision.budget.maxWallClockMs).toBe(5_000);
    expect(decision.budget.maxConcurrentWorkers).toBe(1);
  });
});
