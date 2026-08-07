import { describe, expect, it } from "vitest";
import { decideImprovement } from "../../src/index.js";
import { budget, issue } from "./fixtures.js";

describe("improvement policy", () => {
  it("continues for a material verifiable issue", () => {
    const current = issue();
    const result = decideImprovement({ issues: [current], completedRepairRounds: 0, failedRepairSignatures: [], proposedRepairSignatures: { [String(current.id)]: "repair-a" }, expectedMaterialBenefit: { [String(current.id)]: 0.4 }, verificationMethodsAvailable: ["unit"], budget: budget() });
    expect(result.action).toBe("continue");
  });

  it("stops cosmetic or unverifiable refinement", () => {
    const current = issue();
    const result = decideImprovement({ issues: [current], completedRepairRounds: 0, failedRepairSignatures: [], proposedRepairSignatures: { [String(current.id)]: "repair-a" }, expectedMaterialBenefit: { [String(current.id)]: 0.01 }, verificationMethodsAvailable: [], budget: budget() });
    expect(result.action).toBe("stop");
  });

  it("stops when repair rounds are exhausted", () => {
    const current = issue();
    const result = decideImprovement({ issues: [current], completedRepairRounds: 3, failedRepairSignatures: [], proposedRepairSignatures: {}, expectedMaterialBenefit: {}, verificationMethodsAvailable: ["unit"], budget: budget({ maxRepairRounds: 3 }) });
    expect(result.action).toBe("stop");
  });
});
