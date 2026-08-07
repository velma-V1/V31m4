import { describe, expect, it } from "vitest";
import {
  type CandidateEvaluation,
  type CandidateMetrics,
  ChampionSelector,
  selectChampion,
} from "../../src/services/champion-selector.js";
import { makeVerification } from "./fixtures.js";

const strongMetrics: CandidateMetrics = {
  correctness: 0.95,
  coverage: 0.9,
  security: 0.9,
  performance: 0.8,
  complexity: 0.2,
  evidenceStrength: 0.9,
};

const weakMetrics: CandidateMetrics = {
  correctness: 0.6,
  coverage: 0.5,
  security: 0.6,
  performance: 0.5,
  complexity: 0.6,
  evidenceStrength: 0.5,
};

function candidate(
  overrides: Partial<CandidateEvaluation> & { candidateId: string },
): CandidateEvaluation {
  return {
    verification: makeVerification("passed"),
    metrics: strongMetrics,
    unresolvedCriticalRisks: [],
    evidenceIds: ["evidence:1"],
    ...overrides,
  };
}

describe("ChampionSelector.select", () => {
  it("selects a clear champion that dominates the others", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:strong", metrics: strongMetrics }),
        candidate({ candidateId: "candidate:weak", metrics: weakMetrics }),
      ],
    });
    expect(result.outcome).toBe("champion");
    if (result.outcome === "champion") {
      expect(result.candidateId).toBe("candidate:strong");
      expect(result.reasons.every((reason) => reason.evidenceIds.length > 0)).toBe(true);
    }
  });

  it("returns no verified solution when no candidate qualifies", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:failed", verification: makeVerification("failed") }),
      ],
    });
    expect(result.outcome).toBe("no_verified_solution");
    if (result.outcome === "no_verified_solution") {
      expect(result.excluded[0]?.reason).toBe("mandatory_check_failed");
    }
  });

  it("preserves a Pareto set when no candidate dominates", () => {
    const result = selectChampion({
      candidates: [
        candidate({
          candidateId: "candidate:fast",
          metrics: { ...strongMetrics, performance: 0.95, security: 0.7 },
        }),
        candidate({
          candidateId: "candidate:secure",
          metrics: { ...strongMetrics, performance: 0.6, security: 0.99 },
        }),
      ],
    });
    expect(result.outcome).toBe("pareto");
    if (result.outcome === "pareto") {
      expect(result.paretoCandidateIds).toHaveLength(2);
      expect(result.paretoCandidateIds).toContain("candidate:fast");
      expect(result.recommendedCandidateId).toBeDefined();
    }
  });

  it("excludes candidates that failed mandatory verification", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:ok", metrics: strongMetrics }),
        candidate({ candidateId: "candidate:bad", verification: makeVerification("failed") }),
      ],
    });
    if (result.outcome === "champion") {
      expect(result.candidateId).toBe("candidate:ok");
      expect(result.excluded.some((entry) => entry.candidateId === "candidate:bad")).toBe(true);
    }
  });

  it("excludes candidates with missing or inconclusive mandatory checks", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:inc", verification: makeVerification("inconclusive") }),
      ],
    });
    expect(result.outcome).toBe("no_verified_solution");
    if (result.outcome === "no_verified_solution") {
      expect(result.excluded[0]?.reason).toBe("missing_or_inconclusive_mandatory_checks");
    }
  });

  it("excludes candidates without any mandatory checks", () => {
    const result = selectChampion({
      candidates: [
        candidate({
          candidateId: "candidate:opt",
          verification: makeVerification("optional_only"),
        }),
      ],
    });
    expect(result.outcome).toBe("no_verified_solution");
    if (result.outcome === "no_verified_solution") {
      expect(result.excluded[0]?.reason).toBe("no_mandatory_checks");
    }
  });

  it("excludes candidates with unresolved critical risks and surfaces them", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:risky", unresolvedCriticalRisks: ["risk:overflow"] }),
      ],
    });
    expect(result.outcome).toBe("no_verified_solution");
    if (result.outcome === "no_verified_solution") {
      expect(result.excluded[0]?.reason).toBe("unresolved_critical_risk");
      expect(result.excluded[0]?.criticalRisks).toContain("risk:overflow");
    }
  });

  it("breaks ties deterministically by candidate id", () => {
    const result = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:b", metrics: strongMetrics }),
        candidate({ candidateId: "candidate:a", metrics: strongMetrics }),
      ],
    });
    expect(result.outcome).toBe("pareto");
    if (result.outcome === "pareto") {
      expect(result.recommendedCandidateId).toBe("candidate:a");
    }
  });

  it("ignores model confidence and size (they are not inputs)", () => {
    // Both candidates are verified and identical; selection must not depend on any
    // hidden model attribute, only the provided verified metrics.
    const first = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:a", metrics: strongMetrics }),
        candidate({ candidateId: "candidate:b", metrics: weakMetrics }),
      ],
    });
    const second = selectChampion({
      candidates: [
        candidate({ candidateId: "candidate:b", metrics: weakMetrics }),
        candidate({ candidateId: "candidate:a", metrics: strongMetrics }),
      ],
    });
    expect(first.outcome).toBe("champion");
    expect(second.outcome).toBe("champion");
    if (first.outcome === "champion" && second.outcome === "champion") {
      expect(first.candidateId).toBe(second.candidateId);
    }
  });

  it("is deterministic for repeated evaluation", () => {
    const candidates = [
      candidate({ candidateId: "candidate:a", metrics: strongMetrics }),
      candidate({ candidateId: "candidate:b", metrics: weakMetrics }),
    ];
    expect(ChampionSelector.select({ candidates })).toStrictEqual(
      ChampionSelector.select({ candidates }),
    );
  });
});
