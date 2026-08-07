import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  type PracticeCandidate,
  PracticeSelector,
  type PracticeSelectorInput,
  selectPracticeTask,
} from "../../src/services/practice-selector.js";

const smallCost = ResourceBudget.create({
  maxWallClockMs: 5_000,
  maxModelInvocations: 1,
  maxToolInvocations: 1,
  maxRepairRounds: 1,
  maxConcurrentWorkers: 1,
});

const available = ResourceBudget.create({
  maxWallClockMs: 60_000,
  maxModelInvocations: 8,
  maxToolInvocations: 8,
  maxRepairRounds: 3,
  maxConcurrentWorkers: 4,
});

function candidate(
  overrides: Partial<PracticeCandidate> & { taskId: string; capabilityId: string },
): PracticeCandidate {
  return {
    requiresProductionWrite: false,
    usesProductionSecrets: false,
    hasIndependentVerification: true,
    hasMeasurableOutcome: true,
    estimatedCost: smallCost,
    targetDifficulty: 0.5,
    ...overrides,
  };
}

function input(overrides: Partial<PracticeSelectorInput> = {}): PracticeSelectorInput {
  return {
    candidates: [candidate({ taskId: "task:1", capabilityId: "capability:a" })],
    weakCapabilities: [{ capabilityId: "capability:a", score: 0.3, sampleSize: 5 }],
    systemIdle: true,
    availableBudget: available,
    ...overrides,
  };
}

describe("PracticeSelector.select", () => {
  it("selects a task for the weakest eligible capability", () => {
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({ taskId: "task:a", capabilityId: "capability:a" }),
          candidate({ taskId: "task:b", capabilityId: "capability:b" }),
        ],
        weakCapabilities: [
          { capabilityId: "capability:a", score: 0.5, sampleSize: 5 },
          { capabilityId: "capability:b", score: 0.2, sampleSize: 5 },
        ],
      }),
    );
    expect(result.outcome).toBe("selected");
    if (result.outcome === "selected") {
      expect(result.capabilityId).toBe("capability:b");
    }
  });

  it("respects cooldowns", () => {
    const result = selectPracticeTask(input({ cooldownCapabilityIds: ["capability:a"] }));
    expect(result.outcome).toBe("no_task");
    if (result.outcome === "no_task") {
      expect(result.excluded[0]?.reason).toBe("capability_in_cooldown");
    }
  });

  it("rotates away from a recently practiced capability", () => {
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({ taskId: "task:a", capabilityId: "capability:a" }),
          candidate({ taskId: "task:b", capabilityId: "capability:b" }),
        ],
        weakCapabilities: [
          { capabilityId: "capability:a", score: 0.1, sampleSize: 5 },
          { capabilityId: "capability:b", score: 0.4, sampleSize: 5 },
        ],
        recentlyPracticedCapabilityIds: ["capability:a"],
      }),
    );
    if (result.outcome === "selected") {
      expect(result.capabilityId).toBe("capability:b");
    }
  });

  it("enforces the resource budget", () => {
    const bigCost = ResourceBudget.create({
      maxWallClockMs: 5_000,
      maxModelInvocations: 99,
      maxToolInvocations: 1,
      maxRepairRounds: 1,
      maxConcurrentWorkers: 1,
    });
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({ taskId: "task:1", capabilityId: "capability:a", estimatedCost: bigCost }),
        ],
      }),
    );
    expect(result.outcome).toBe("no_task");
    if (result.outcome === "no_task") {
      expect(result.excluded[0]?.reason).toBe("budget_exceeded");
    }
  });

  it("respects the idle-only policy", () => {
    const result = selectPracticeTask(input({ systemIdle: false }));
    expect(result.outcome).toBe("no_task");
    if (result.outcome === "no_task") {
      expect(result.reason).toBe("not_idle");
    }
  });

  it("excludes tasks that require production writes", () => {
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({
            taskId: "task:1",
            capabilityId: "capability:a",
            requiresProductionWrite: true,
          }),
        ],
      }),
    );
    if (result.outcome === "no_task") {
      expect(result.excluded[0]?.reason).toBe("requires_production_write");
    }
  });

  it("excludes tasks that use production secrets", () => {
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({
            taskId: "task:1",
            capabilityId: "capability:a",
            usesProductionSecrets: true,
          }),
        ],
      }),
    );
    if (result.outcome === "no_task") {
      expect(result.excluded[0]?.reason).toBe("uses_production_secrets");
    }
  });

  it("excludes tasks lacking independent verification", () => {
    const result = selectPracticeTask(
      input({
        candidates: [
          candidate({
            taskId: "task:1",
            capabilityId: "capability:a",
            hasIndependentVerification: false,
          }),
        ],
      }),
    );
    if (result.outcome === "no_task") {
      expect(result.excluded[0]?.reason).toBe("no_independent_verification");
    }
  });

  it("returns no task when no capability is weak", () => {
    const result = selectPracticeTask(
      input({ weakCapabilities: [{ capabilityId: "capability:a", score: 0.9, sampleSize: 5 }] }),
    );
    expect(result.outcome).toBe("no_task");
    if (result.outcome === "no_task") {
      expect(result.reason).toBe("no_eligible_task");
      expect(result.excluded[0]?.reason).toBe("capability_not_weak");
    }
  });

  it("is deterministic for repeated evaluation", () => {
    const shared = input({
      candidates: [
        candidate({ taskId: "task:a", capabilityId: "capability:a" }),
        candidate({ taskId: "task:b", capabilityId: "capability:b" }),
      ],
      weakCapabilities: [
        { capabilityId: "capability:a", score: 0.3, sampleSize: 5 },
        { capabilityId: "capability:b", score: 0.3, sampleSize: 5 },
      ],
    });
    expect(PracticeSelector.select(shared)).toStrictEqual(PracticeSelector.select(shared));
  });
});
