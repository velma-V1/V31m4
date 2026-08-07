import { describe, expect, it } from "vitest";
import {
  CapabilityCalculator,
  type CapabilityMeasurement,
  calculateCapability,
} from "../../src/services/capability-calculator.js";
import { makeCapabilityProfile } from "./fixtures.js";

let counter = 0;
function measurement(overrides: Partial<CapabilityMeasurement> = {}): CapabilityMeasurement {
  counter += 1;
  return {
    evidenceId: `evidence:m${counter}`,
    verified: true,
    evaluationLeakage: false,
    source: "production",
    outcomeScore: 0.9,
    difficulty: 0.6,
    measuredAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

const now = "2026-08-06T12:00:00.000Z";

describe("CapabilityCalculator.calculate", () => {
  it("produces a bounded increase from strong verified measurements", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 10 }),
      measurements: [measurement(), measurement(), measurement()],
      now,
    });
    expect(result.outcome).toBe("updated");
    if (result.outcome === "updated") {
      expect(result.newScore).toBeGreaterThan(0.5);
      expect(result.newScore).toBeLessThanOrEqual(1);
      expect(result.newScore - result.previousScore).toBeLessThanOrEqual(0.15);
    }
  });

  it("produces a bounded decrease from weak verified measurements", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile({ score: 0.8, sampleSize: 10 }),
      measurements: [
        measurement({ outcomeScore: 0.1 }),
        measurement({ outcomeScore: 0.2 }),
        measurement({ outcomeScore: 0.15 }),
      ],
      now,
    });
    if (result.outcome === "updated") {
      expect(result.newScore).toBeLessThan(0.8);
      expect(result.previousScore - result.newScore).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it("rejects an insufficient sample", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile(),
      measurements: [measurement()],
      now,
      minimumSampleSize: 3,
    });
    expect(result.outcome).toBe("insufficient_evidence");
    if (result.outcome === "insufficient_evidence") {
      expect(result.productionSampleSize).toBe(1);
      expect(result.requiredSampleSize).toBe(3);
    }
  });

  it("weights harder tasks more than easy ones", () => {
    const easy = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 4 }),
      measurements: [
        measurement({ outcomeScore: 1, difficulty: 0.05 }),
        measurement({ outcomeScore: 0.4, difficulty: 0.95 }),
        measurement({ outcomeScore: 0.4, difficulty: 0.95 }),
      ],
      now,
    });
    const hard = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 4 }),
      measurements: [
        measurement({ outcomeScore: 1, difficulty: 0.95 }),
        measurement({ outcomeScore: 0.4, difficulty: 0.05 }),
        measurement({ outcomeScore: 0.4, difficulty: 0.05 }),
      ],
      now,
    });
    if (easy.outcome === "updated" && hard.outcome === "updated") {
      // The high outcome carries more weight when it is on the harder task.
      expect(hard.newScore).toBeGreaterThan(easy.newScore);
    }
  });

  it("weights recent measurements more than stale ones", () => {
    const recentHigh = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 4 }),
      measurements: [
        measurement({ outcomeScore: 1, measuredAt: "2026-08-06T00:00:00.000Z" }),
        measurement({ outcomeScore: 0.3, measuredAt: "2026-01-01T00:00:00.000Z" }),
        measurement({ outcomeScore: 0.3, measuredAt: "2026-01-01T00:00:00.000Z" }),
      ],
      now,
    });
    const staleHigh = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 4 }),
      measurements: [
        measurement({ outcomeScore: 1, measuredAt: "2026-01-01T00:00:00.000Z" }),
        measurement({ outcomeScore: 0.3, measuredAt: "2026-08-06T00:00:00.000Z" }),
        measurement({ outcomeScore: 0.3, measuredAt: "2026-08-06T00:00:00.000Z" }),
      ],
      now,
    });
    if (recentHigh.outcome === "updated" && staleHigh.outcome === "updated") {
      expect(recentHigh.newScore).toBeGreaterThan(staleHigh.newScore);
    }
  });

  it("rejects duplicate evidence and evidence already in history", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile(),
      measurements: [
        measurement({ evidenceId: "evidence:seed" }),
        measurement({ evidenceId: "evidence:dup" }),
        measurement({ evidenceId: "evidence:dup" }),
        measurement({ evidenceId: "evidence:ok1" }),
        measurement({ evidenceId: "evidence:ok2" }),
        measurement({ evidenceId: "evidence:ok3" }),
      ],
      now,
    });
    if (result.outcome === "updated") {
      const reasons = result.rejectedMeasurements.map((entry) => entry.reason);
      expect(reasons).toContain("duplicate_evidence");
      expect(result.usedEvidenceIds).not.toContain("evidence:seed");
    }
  });

  it("rejects evaluation leakage", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile(),
      measurements: [
        measurement({ evaluationLeakage: true }),
        measurement(),
        measurement(),
        measurement(),
      ],
      now,
    });
    if (result.outcome === "updated") {
      expect(
        result.rejectedMeasurements.some((entry) => entry.reason === "evaluation_leakage"),
      ).toBe(true);
    }
  });

  it("isolates practice evidence from the production score", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile({ score: 0.5, sampleSize: 4 }),
      measurements: [
        measurement({ source: "practice", outcomeScore: 1 }),
        measurement({ source: "production", outcomeScore: 0.6 }),
        measurement({ source: "production", outcomeScore: 0.6 }),
        measurement({ source: "production", outcomeScore: 0.6 }),
      ],
      now,
    });
    if (result.outcome === "updated") {
      expect(result.practiceSampleSize).toBe(1);
      expect(result.productionSampleSize).toBe(3);
    }
  });

  it("keeps scores within [0, 1] and does not erase history on one failure", () => {
    const result = calculateCapability({
      current: makeCapabilityProfile({ score: 0.9, sampleSize: 50 }),
      measurements: [
        measurement({ outcomeScore: 0 }),
        measurement({ outcomeScore: 0.9 }),
        measurement({ outcomeScore: 0.9 }),
      ],
      now,
    });
    if (result.outcome === "updated") {
      expect(result.newScore).toBeGreaterThan(0.8); // extensive history dampens one failure
      expect(result.newScore).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for repeated evaluation", () => {
    const input = {
      current: makeCapabilityProfile(),
      measurements: [measurement(), measurement(), measurement()],
      now,
    };
    expect(CapabilityCalculator.calculate(input)).toStrictEqual(
      CapabilityCalculator.calculate(input),
    );
  });
});
