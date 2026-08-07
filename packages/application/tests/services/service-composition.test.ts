import { ResourceBudget, type SolverStrategy } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { type CandidateEvaluation, selectChampion } from "../../src/services/champion-selector.js";
import { selectComputeDecision } from "../../src/services/compute-governor.js";
import { compileContext } from "../../src/services/context-compiler.js";
import { planDiversity } from "../../src/services/diversity-planner.js";
import { linkEvidence } from "../../src/services/evidence-linker.js";
import { decideImprovement } from "../../src/services/improvement-policy.js";
import { makeEvidence, makeMission, makeVerification } from "./fixtures.js";

/**
 * A representative slice of the orchestration flow, composed from the application
 * services with consistent data. Each service consumes only immutable results from the
 * previous step and produces immutable decisions, with no shared mutable state.
 */
describe("application service composition", () => {
  it("drives a mission from compute decision to champion selection deterministically", () => {
    const mission = makeMission();
    const estimatedCost = ResourceBudget.create({
      maxWallClockMs: 5_000,
      maxModelInvocations: 2,
      maxToolInvocations: 2,
      maxRepairRounds: 1,
      maxConcurrentWorkers: 1,
    });

    const compute = selectComputeDecision({
      complexity: 0.8,
      risk: 0.5,
      reversibility: "reversible",
      deterministicVerificationAvailable: true,
      securityCritical: false,
      requiredEvidenceStrength: "high",
      estimatedCost,
      available: {
        wallClockMs: 600_000,
        modelInvocations: 64,
        toolInvocations: 64,
        concurrentWorkers: 8,
      },
      approvedCeiling: mission.resourceBudget,
    });
    expect(compute.outcome).toBe("selected");
    if (compute.outcome !== "selected") {
      return;
    }
    expect(compute.mode).toBe("competitive");

    const strategies: readonly SolverStrategy[] = [
      "direct",
      "minimal_change",
      "specification_first",
    ];
    const diversity = planDiversity({
      count: Math.min(3, compute.budget.maxConcurrentWorkers),
      seed: 1,
      allowedStrategies: strategies,
      allowedModelIds: ["model:a", "model:b"],
      toolCatalog: ["tool:x", "tool:y"],
      contextArtifactIds: ["artifact:ctx"],
      missionConstraints: mission.constraints.map((constraint) => constraint.statement),
      budget: compute.budget,
    });
    expect(diversity.outcome).toBe("planned");
    if (diversity.outcome !== "planned") {
      return;
    }
    expect(diversity.configurations.length).toBeGreaterThan(0);

    const context = compileContext({ mission, limitTokens: 4_000 });
    expect(context.outcome).toBe("compiled");

    const candidates: readonly CandidateEvaluation[] = diversity.configurations.map(
      (_config, index) => ({
        candidateId: `candidate:${index}`,
        verification: makeVerification("passed"),
        metrics: {
          correctness: 0.9 - index * 0.1,
          coverage: 0.85,
          security: 0.8,
          performance: 0.8,
          complexity: 0.3,
          evidenceStrength: 0.85,
        },
        unresolvedCriticalRisks: [],
        evidenceIds: [`evidence:${index}`],
      }),
    );
    const champion = selectChampion({ candidates });
    expect(champion.outcome).toBe("champion");
    if (champion.outcome === "champion") {
      expect(champion.candidateId).toBe("candidate:0");
    }

    const coverage = linkEvidence({
      evidence: [makeEvidence({ id: "evidence:final", status: "passed", kind: "hidden_test" })],
      links: [
        {
          evidenceId: "evidence:final",
          subjectType: "acceptance_criterion",
          subjectId: "criterion:1",
        },
      ],
      acceptanceCriteria: [
        { id: "criterion:1", mandatory: true, requiredEvidenceKinds: ["hidden_test"] },
      ],
    });
    expect(coverage.criterionCoverage).toBe(1);

    const improvement = decideImprovement({
      proposals: [],
      completedRounds: 1,
      maxRepairRounds: 3,
      remainingBudget: compute.budget,
    });
    expect(improvement.outcome).toBe("stop");
  });

  it("keeps every service result frozen", () => {
    const mission = makeMission();
    const context = compileContext({ mission, limitTokens: 4_000 });
    expect(Object.isFrozen(context)).toBe(true);
    if (context.outcome === "compiled") {
      expect(Object.isFrozen(context.items)).toBe(true);
      expect(Object.isFrozen(context.items[0])).toBe(true);
    }
  });
});
