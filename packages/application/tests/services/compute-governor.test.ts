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

  it("never exceeds the ceiling or deadline and stays deterministic across a fuzz sweep", () => {
    // Seeded pseudo-random sweep asserting the core budget guarantees hold for a wide
    // range of valid inputs, and that repeated evaluation is identical.
    let state = 0x1234_5678;
    const next = () => {
      state = (state + 0x6d2b_79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    let selectedSeen = false;
    let unavailableSeen = false;
    for (let i = 0; i < 1_000; i += 1) {
      const ceiling = ResourceBudget.create({
        maxWallClockMs: int(1, 1_000_000),
        maxModelInvocations: int(0, 200),
        maxToolInvocations: int(0, 200),
        maxRepairRounds: int(0, 20),
        maxConcurrentWorkers: int(1, 32),
      });
      const estimatedCost = ResourceBudget.create({
        maxWallClockMs: int(1, 200_000),
        maxModelInvocations: int(0, 50),
        maxToolInvocations: int(0, 50),
        maxRepairRounds: int(0, 8),
        maxConcurrentWorkers: int(1, 8),
      });
      const withDeadline = next() < 0.5;
      const input: ComputeGovernorInput = {
        complexity: next(),
        risk: next(),
        reversibility: next() < 0.5 ? "reversible" : "irreversible",
        deterministicVerificationAvailable: next() < 0.5,
        securityCritical: next() < 0.3,
        requiredEvidenceStrength:
          (["standard", "high", "critical"] as const)[int(0, 2)] ?? "standard",
        estimatedCost,
        available: {
          wallClockMs: int(0, 1_000_000),
          modelInvocations: int(0, 200),
          toolInvocations: int(0, 200),
          concurrentWorkers: int(0, 32),
        },
        approvedCeiling: ceiling,
        ...(withDeadline ? { deadlineMs: int(1, 500_000) } : {}),
      };
      const decision = selectComputeDecision(input);
      expect(selectComputeDecision(input)).toStrictEqual(decision);
      if (decision.outcome === "selected") {
        selectedSeen = true;
        expect(decision.budget.maxWallClockMs).toBeLessThanOrEqual(ceiling.maxWallClockMs);
        expect(decision.budget.maxModelInvocations).toBeLessThanOrEqual(
          ceiling.maxModelInvocations,
        );
        expect(decision.budget.maxToolInvocations).toBeLessThanOrEqual(ceiling.maxToolInvocations);
        expect(decision.budget.maxRepairRounds).toBeLessThanOrEqual(ceiling.maxRepairRounds);
        expect(decision.budget.maxConcurrentWorkers).toBeLessThanOrEqual(
          ceiling.maxConcurrentWorkers,
        );
        if (input.deadlineMs !== undefined) {
          expect(decision.budget.maxWallClockMs).toBeLessThanOrEqual(input.deadlineMs);
        }
      } else if (decision.reason === "verification_unavailable") {
        unavailableSeen = true;
      }
    }
    expect(selectedSeen).toBe(true);
    expect(unavailableSeen).toBe(true);
  });
});
