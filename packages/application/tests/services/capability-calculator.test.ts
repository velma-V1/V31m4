import { EvidenceId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { calculateCapabilityScore } from "../../src/index.js";
import { T0, T1, capability } from "./fixtures.js";

describe("capability calculator", () => {
  const observations = [
    { evidenceId: EvidenceId.parse("evidence-new-1"), outcome: 1, difficulty: 0.8, measuredAt: T0, source: "production" as const, leakageChecked: true },
    { evidenceId: EvidenceId.parse("evidence-new-2"), outcome: 0.8, difficulty: 0.6, measuredAt: T0, source: "production" as const, leakageChecked: true },
  ];

  it("produces a bounded evidence-backed update", () => {
    const score = calculateCapabilityScore({ profile: capability(), observations, measuredAt: T1, minimumSampleSize: 2, practiceWeight: 0.5 });
    expect(score.score > 0.4).toBe(true);
    expect(score.evidenceIds).toHaveLength(2);
  });

  it("rejects duplicate evidence", () => {
    expect(() => calculateCapabilityScore({ profile: capability(), observations: [observations[0]!, observations[0]!], measuredAt: T1, minimumSampleSize: 2, practiceWeight: 0.5 })).toThrow();
  });

  it("rejects observations without leakage checks", () => {
    expect(() => calculateCapabilityScore({ profile: capability(), observations: [{ ...observations[0]!, leakageChecked: false }, observations[1]!], measuredAt: T1, minimumSampleSize: 2, practiceWeight: 0.5 })).toThrow();
  });
});
