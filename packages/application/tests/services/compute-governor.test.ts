import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  ComputeGovernor,
  type ComputeGovernorInput,
  selectComputeDecision,
} from "../../src/services/compute-governor.js";

const cost = ResourceBudget.create({
  maxWallClockMs: 10_000,
  maxModelInvocations: 2,
  maxToolInvocations: 2,
  maxRepairRounds: 1,
  maxConcurrentWorkers: 1,
  maxInputTokens: 1_000,
  maxOutputTokens: 1_000,
});

const ceiling = ResourceBudget.create({
  maxWallClockMs: 600_000,
  maxModelInvocations: 64,
  maxToolInvocations: 64,
  maxRepairRounds: 8,
  maxConcurrentWorkers: 8,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
});

const available = {
  wallClockMs: 600_000,
  modelInvocations: 64,
  toolInvocations: 64,
  concurrentWorkers: 8,
};

function baseInput(overrides: Partial<ComputeGovernorInput> = {}): ComputeGovernorInput {
  return {
    complexity: 0.2,
    risk: 0.1,
    reversibility: "reversible",
    deterministicVerificationAvailable: true,
    securityCritical: false,
    requiredEvidenceStrength: "standard",
    estimatedCost: cost,
    available,
    approvedCeiling: ceiling,
    ...overrides,
  };
}

describe("ComputeGovernor.select", () => {
  it("selects direct for low-risk reversible work", () => {
    const decision = selectComputeDecision(baseInput());
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.mode).toBe("direct");
      expect(decision.reasons.length).toBeGreaterThan(0);
    }
  });

  it("selects checked when deterministic verification exists for moderate risk", () => {
    const decision = selectComputeDecision(baseInput({ risk: 0.35 }));
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.mode).toBe("checked");
    }
  });

  it("selects competitive for ambiguous high-value work", () => {
    const decision = selectComputeDecision(baseInput({ complexity: 0.8, risk: 0.4 }));
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.mode).toBe("competitive");
      expect(decision.budget.maxConcurrentWorkers).toBeGreaterThan(1);
    }
  });

  it("selects adversarial for security-critical work", () => {
    const decision = selectComputeDecision(baseInput({ securityCritical: true }));
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.mode).toBe("adversarial");
    }
  });

  it("clamps the selected budget to the approved ceiling", () => {
    const tightCeiling = ResourceBudget.create({
      maxWallClockMs: 15_000,
      maxModelInvocations: 4,
      maxToolInvocations: 4,
      maxRepairRounds: 2,
      maxConcurrentWorkers: 2,
    });
    const decision = selectComputeDecision(
      baseInput({ complexity: 0.9, risk: 0.4, approvedCeiling: tightCeiling }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.budget.maxModelInvocations).toBeLessThanOrEqual(4);
      expect(decision.budget.maxConcurrentWorkers).toBeLessThanOrEqual(2);
      expect(decision.budget.maxWallClockMs).toBeLessThanOrEqual(15_000);
    }
  });

  it("refuses when resources cannot cover even the safety floor", () => {
    const decision = selectComputeDecision(
      baseInput({
        securityCritical: true,
        available: {
          wallClockMs: 10,
          modelInvocations: 1,
          toolInvocations: 0,
          concurrentWorkers: 1,
        },
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("insufficient_resources");
    }
  });

  it("honours a deadline by downgrading an optional upgrade", () => {
    const decision = selectComputeDecision(
      baseInput({ complexity: 0.85, risk: 0.3, deadlineMs: 18_000 }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      // competitive needs 10_000 * 2 = 20_000ms > 18_000ms; checked (15_000ms) fits.
      expect(decision.mode).toBe("checked");
    }
  });

  it("refuses on deadline when even the safety floor cannot finish in time", () => {
    const decision = selectComputeDecision(
      baseInput({ securityCritical: true, deadlineMs: 5_000 }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("deadline_unattainable");
    }
  });

  it("defers when verification is unavailable but safety requires it", () => {
    const decision = selectComputeDecision(
      baseInput({ securityCritical: true, deterministicVerificationAvailable: false }),
    );
    expect(decision.outcome).toBe("deferred");
    if (decision.outcome === "deferred") {
      expect(decision.reason).toBe("verification_unavailable");
    }
  });

  it("drops an optional complexity upgrade to direct when verification is unavailable", () => {
    const decision = selectComputeDecision(
      baseInput({ complexity: 0.9, risk: 0.1, deterministicVerificationAvailable: false }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome === "selected") {
      expect(decision.mode).toBe("direct");
    }
  });

  it("is deterministic for repeated evaluation", () => {
    const input = baseInput({ complexity: 0.7, risk: 0.6 });
    expect(ComputeGovernor.select(input)).toStrictEqual(ComputeGovernor.select(input));
  });

  it("rejects out-of-range risk with a typed application error", () => {
    expect(() => selectComputeDecision(baseInput({ risk: 1.5 }))).toThrowError(
      /risk must be a finite number/,
    );
  });
});
