import { MissionId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { selectChampion } from "../../src/index.js";
import { T1, candidate, issue, verification } from "./fixtures.js";

describe("champion selector", () => {
  const assessment = (id: string, correctness: number, complexity: number) => ({
    candidate: candidate(id),
    verification: verification(id),
    issues: [],
    correctness,
    coverage: 1,
    security: 1,
    performance: 0.8,
    complexity,
    evidenceStrength: 1,
  });

  it("selects the strongest verified candidate deterministically", () => {
    const decision = selectChampion({ decisionId: "decision-1", missionId: MissionId.parse("mission-1"), assessments: [assessment("candidate-2", 0.8, 0.4), assessment("candidate-1", 1, 0.2)], decidedAt: T1 });
    expect(decision.decision).toBe("champion");
    expect(decision.candidateId).toBe("candidate-1");
  });

  it("returns no verified solution when mandatory verification fails", () => {
    const failed = { ...assessment("candidate-1", 1, 0.1), verification: verification("candidate-1", "failed") };
    const decision = selectChampion({ decisionId: "decision-1", missionId: MissionId.parse("mission-1"), assessments: [failed], decidedAt: T1 });
    expect(decision.decision).toBe("no_verified_solution");
  });

  it("excludes candidates with unresolved critical issues", () => {
    const blocked = { ...assessment("candidate-1", 1, 0.1), issues: [issue("candidate-1", "critical")] };
    const decision = selectChampion({ decisionId: "decision-1", missionId: MissionId.parse("mission-1"), assessments: [blocked], decidedAt: T1 });
    expect(decision.decision).toBe("no_verified_solution");
  });
});
