import { describe, expect, it } from "vitest";
import { ResourceBudget } from "../src/value-objects/resource-budget.js";

const validBudget = {
  maxWallClockMs: 60_000,
  maxModelInvocations: 3,
  maxToolInvocations: 8,
  maxRepairRounds: 2,
  maxConcurrentWorkers: 2,
  maxInputTokens: 32_000,
  maxOutputTokens: 8_000,
  maxRamBytes: 16_000_000_000,
  maxVramBytes: 12_000_000_000,
} as const;

describe("ResourceBudget", () => {
  it("creates an immutable budget with zero allowed invocation counts", () => {
    const budget = ResourceBudget.create({
      ...validBudget,
      maxModelInvocations: 0,
      maxToolInvocations: 0,
      maxRepairRounds: 0,
    });

    expect(budget.maxWallClockMs).toBe(60_000);
    expect(budget.maxModelInvocations).toBe(0);
    expect(Object.isFrozen(budget)).toBe(true);
  });

  it.each([
    { field: "maxWallClockMs", value: 0 },
    { field: "maxModelInvocations", value: -1 },
    { field: "maxToolInvocations", value: 1.5 },
    { field: "maxRepairRounds", value: -1 },
    { field: "maxConcurrentWorkers", value: 0 },
    { field: "maxInputTokens", value: 0 },
    { field: "maxOutputTokens", value: -5 },
    { field: "maxRamBytes", value: Number.POSITIVE_INFINITY },
    { field: "maxVramBytes", value: 1.2 },
  ])("rejects invalid $field value $value", ({ field, value }) => {
    expect(() =>
      ResourceBudget.create({
        ...validBudget,
        [field]: value,
      }),
    ).toThrow();
  });
});
