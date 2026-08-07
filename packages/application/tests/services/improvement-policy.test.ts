import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  decideImprovement,
  ImprovementPolicy,
  type ImprovementPolicyInput,
  type ImprovementProposal,
} from "../../src/services/improvement-policy.js";

const budget = ResourceBudget.create({
  maxWallClockMs: 60_000,
  maxModelInvocations: 4,
  maxToolInvocations: 4,
  maxRepairRounds: 3,
  maxConcurrentWorkers: 2,
});

function proposal(
  overrides: Partial<ImprovementProposal> & { issueId: string },
): ImprovementProposal {
  return {
    severity: "high",
    concreteWeakness: "Null dereference when the input list is empty.",
    expectedBenefit: 0.6,
    verificationMethod: "unit_test",
    kind: "repair",
    wordingOnly: false,
    priorFailedAttempts: 0,
    ...overrides,
  };
}

function input(overrides: Partial<ImprovementPolicyInput> = {}): ImprovementPolicyInput {
  return {
    proposals: [proposal({ issueId: "issue:1" })],
    completedRounds: 0,
    maxRepairRounds: 3,
    remainingBudget: budget,
    ...overrides,
  };
}

describe("ImprovementPolicy.decide", () => {
  it("approves a critical repair with concrete weakness and verification", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", severity: "critical" })] }),
    );
    expect(decision.outcome).toBe("continue");
    if (decision.outcome === "continue") {
      expect(decision.repairs[0]?.issueId).toBe("issue:1");
    }
  });

  it("rejects cosmetic restructuring without measurable value", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", expectedBenefit: 0.02 })] }),
    );
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.reason).toBe("no_material_improvement");
      expect(decision.rejected[0]?.reason).toBe("insufficient_benefit");
    }
  });

  it("rejects wording-only refinement", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", wordingOnly: true })] }),
    );
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.rejected[0]?.reason).toBe("wording_only");
    }
  });

  it("stops a repeated failed repair pattern", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", priorFailedAttempts: 2 })] }),
    );
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.rejected[0]?.reason).toBe("repeated_failure");
    }
  });

  it("enforces the maximum repair rounds", () => {
    const decision = decideImprovement(input({ completedRounds: 3, maxRepairRounds: 3 }));
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.reason).toBe("max_rounds_reached");
      expect(decision.remainingRisk).toHaveLength(1);
    }
  });

  it("enforces budget exhaustion", () => {
    const exhausted = ResourceBudget.create({
      maxWallClockMs: 1_000,
      maxModelInvocations: 0,
      maxToolInvocations: 0,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    });
    const decision = decideImprovement(input({ remainingBudget: exhausted }));
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.reason).toBe("budget_exhausted");
    }
  });

  it("approves material measurable improvement", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", expectedBenefit: 0.75 })] }),
    );
    expect(decision.outcome).toBe("continue");
  });

  it("rejects a proposal with no verification method", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", verificationMethod: "  " })] }),
    );
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.rejected[0]?.reason).toBe("no_verification_method");
    }
  });

  it("rejects speculative enhancements distinct from repairs", () => {
    const decision = decideImprovement(
      input({ proposals: [proposal({ issueId: "issue:1", kind: "enhancement" })] }),
    );
    expect(decision.outcome).toBe("stop");
    if (decision.outcome === "stop") {
      expect(decision.rejected[0]?.reason).toBe("speculative_enhancement");
    }
  });

  it("reports remaining risk and is deterministic when stopping", () => {
    const stopInput = input({
      completedRounds: 3,
      proposals: [
        proposal({ issueId: "issue:high", severity: "high" }),
        proposal({ issueId: "issue:crit", severity: "critical" }),
        proposal({ issueId: "issue:low", severity: "low" }),
      ],
    });
    const first = decideImprovement(stopInput);
    const second = ImprovementPolicy.decide(stopInput);
    expect(first).toStrictEqual(second);
    if (first.outcome === "stop") {
      expect(first.remainingRisk.map((risk) => risk.issueId)).toEqual(["issue:crit", "issue:high"]);
    }
  });
});
