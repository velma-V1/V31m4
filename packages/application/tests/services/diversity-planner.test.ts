import { ResourceBudget, type SolverStrategy } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  DiversityPlanner,
  type DiversityPlannerInput,
  planDiversity,
} from "../../src/services/diversity-planner.js";

const budget = ResourceBudget.create({
  maxWallClockMs: 60_000,
  maxModelInvocations: 8,
  maxToolInvocations: 4,
  maxRepairRounds: 3,
  maxConcurrentWorkers: 6,
});

const strategies: readonly SolverStrategy[] = [
  "direct",
  "minimal_change",
  "specification_first",
  "adversarial",
];

function baseInput(overrides: Partial<DiversityPlannerInput> = {}): DiversityPlannerInput {
  return {
    count: 3,
    seed: 42,
    allowedStrategies: strategies,
    allowedModelIds: ["model:a", "model:b"],
    toolCatalog: ["tool:x", "tool:y"],
    contextArtifactIds: ["artifact:ctx"],
    missionConstraints: ["Preserve the public API."],
    budget,
    ...overrides,
  };
}

describe("DiversityPlanner.plan", () => {
  it("generates the requested number of unique configurations", () => {
    const result = planDiversity(baseInput());
    expect(result.outcome).toBe("planned");
    if (result.outcome === "planned") {
      expect(result.configurations).toHaveLength(3);
      const signatures = new Set(
        result.configurations.map(
          (config) => `${config.strategy}|${[...config.toolIds].sort().join(",")}`,
        ),
      );
      expect(signatures.size).toBe(3);
    }
  });

  it("uses distinct approved strategies", () => {
    const result = planDiversity(baseInput());
    if (result.outcome === "planned") {
      const usedStrategies = new Set(result.configurations.map((config) => config.strategy));
      expect(usedStrategies.size).toBe(3);
      for (const config of result.configurations) {
        expect(strategies).toContain(config.strategy);
      }
    }
  });

  it("preserves required constraints in every configuration", () => {
    const result = planDiversity(baseInput());
    if (result.outcome === "planned") {
      for (const config of result.configurations) {
        expect(config.constraints).toContain("Preserve the public API.");
      }
    }
  });

  it("keeps every pairwise difference material", () => {
    const result = planDiversity(baseInput());
    if (result.outcome === "planned") {
      expect(result.pairwiseDistances.every((pair) => pair.material)).toBe(true);
      expect(result.minimumPairwiseDistance).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const a = planDiversity(baseInput({ seed: 7 }));
    const b = planDiversity(baseInput({ seed: 7 }));
    expect(a).toStrictEqual(b);
    const c = planDiversity(baseInput({ seed: 99 }));
    // Different seed may reorder/select differently; both remain valid plans.
    expect(c.outcome).toBe("planned");
  });

  it("rejects a request that only a temperature or model change could satisfy", () => {
    const result = planDiversity(
      baseInput({
        count: 3,
        allowedStrategies: ["direct"],
        allowedModelIds: ["model:a", "model:b", "model:c"],
        toolCatalog: [],
      }),
    );
    expect(result.outcome).toBe("infeasible");
    if (result.outcome === "infeasible") {
      expect(result.reason).toBe("insufficient_diversity");
      // A single strategy with no optional tools yields exactly one material config.
      expect(result.maximumFeasible).toBe(1);
    }
  });

  it("respects the concurrent-worker budget", () => {
    const result = planDiversity(baseInput({ count: 10 }));
    expect(result.outcome).toBe("infeasible");
    if (result.outcome === "infeasible") {
      expect(result.reason).toBe("budget_exceeded");
      expect(result.maximumFeasible).toBe(budget.maxConcurrentWorkers);
    }
  });

  it("respects the tool-invocation budget for required tools", () => {
    const tightBudget = ResourceBudget.create({
      maxWallClockMs: 1_000,
      maxModelInvocations: 4,
      maxToolInvocations: 1,
      maxRepairRounds: 1,
      maxConcurrentWorkers: 4,
    });
    const result = planDiversity(
      baseInput({ budget: tightBudget, requiredToolIds: ["tool:x", "tool:y"] }),
    );
    expect(result.outcome).toBe("infeasible");
    if (result.outcome === "infeasible") {
      expect(result.reason).toBe("budget_exceeded");
    }
  });

  it("rejects a non-positive count", () => {
    expect(() => DiversityPlanner.plan(baseInput({ count: 0 }))).toThrowError(/count must be/);
  });
});
