import { describe, expect, it } from "vitest";
import { selectPracticeTask } from "../../src/index.js";
import { T1, budget, capability } from "./fixtures.js";

describe("practice selector", () => {
  const candidate = (id: string, capabilityId: string, overrides = {}) => ({ id, capabilityId, targetDifficulty: 0.5, estimatedBudget: budget({ maxModelInvocations: 1, maxToolInvocations: 1, maxConcurrentWorkers: 1 }), requiresProductionWrite: false, requiresSecret: false, independentlyVerifiable: true, ...overrides });

  it("selects the weakest eligible capability", () => {
    const result = selectPracticeTask({ profiles: [capability("capability-1", 0.6), capability("capability-2", 0.2, ["evidence-capability-2"])], candidates: [candidate("task-1", "capability-1"), candidate("task-2", "capability-2")], now: T1, idleForMs: 10_000, requiredIdleMs: 1_000, cooldownMs: 0, availableBudget: budget(), recentCapabilityIds: [] });
    expect(result.selected?.id).toBe("task-2");
  });

  it("excludes unsafe production-writing tasks", () => {
    const result = selectPracticeTask({ profiles: [capability()], candidates: [candidate("task-1", "capability-1", { requiresProductionWrite: true })], now: T1, idleForMs: 10_000, requiredIdleMs: 1_000, cooldownMs: 0, availableBudget: budget(), recentCapabilityIds: [] });
    expect(result.selected).toBe(null);
  });

  it("does not practice before the idle threshold", () => {
    const result = selectPracticeTask({ profiles: [capability()], candidates: [candidate("task-1", "capability-1")], now: T1, idleForMs: 100, requiredIdleMs: 1_000, cooldownMs: 0, availableBudget: budget(), recentCapabilityIds: [] });
    expect(result.selected).toBe(null);
  });
});
