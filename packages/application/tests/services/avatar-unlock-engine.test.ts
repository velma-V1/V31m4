import { AvatarState } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { evaluateAvatarUnlocks } from "../../src/index.js";
import { T1, achievementRule, capability, evidence } from "./fixtures.js";

describe("avatar unlock engine", () => {
  it("unlocks only with sufficient capability and independent evidence", () => {
    const result = evaluateAvatarUnlocks({ state: AvatarState.create("avatar-1"), rules: [achievementRule()], capabilities: [capability("capability-1", 0.8, ["evidence-1", "evidence-2"])], evidence: [evidence({ id: "evidence-1", verifierId: "verifier-1", subjectType: "capability", subjectId: "capability-1" }), evidence({ id: "evidence-2", verifierId: "verifier-2", subjectType: "capability", subjectId: "capability-1" })], evaluatedAt: T1 });
    expect(result.unlockedItemIds).toEqual(["item-1"]);
    expect(result.state.evolutionStage).toBe(1);
  });

  it("rejects self-verification and insufficient independent verifiers", () => {
    const result = evaluateAvatarUnlocks({ state: AvatarState.create("avatar-1"), rules: [achievementRule()], capabilities: [capability("capability-1", 0.8, ["evidence-1"])], evidence: [evidence({ id: "evidence-1", verifierId: "model-self", subjectType: "capability", subjectId: "capability-1" })], evaluatedAt: T1 });
    expect(result.unlockedItemIds).toEqual([]);
    expect(result.rejectedRuleIds).toEqual(["rule-1"]);
  });

  it("rejects evidence bound to a different subject", () => {
    const result = evaluateAvatarUnlocks({ state: AvatarState.create("avatar-1"), rules: [achievementRule()], capabilities: [capability("capability-1", 0.8, ["evidence-1", "evidence-2"])], evidence: [evidence({ id: "evidence-1", verifierId: "verifier-1" }), evidence({ id: "evidence-2", verifierId: "verifier-2" })], evaluatedAt: T1 });
    expect(result.unlockedItemIds).toEqual([]);
  });

  it("does not duplicate permanent unlocks", () => {
    const initial = AvatarState.unlock(AvatarState.create("avatar-1"), { itemId: "item-1", achievementRuleId: "rule-1", evidenceIds: ["evidence-1"], unlockedAt: T1 });
    const result = evaluateAvatarUnlocks({ state: initial, rules: [achievementRule()], capabilities: [capability("capability-1", 0.8, ["evidence-1", "evidence-2"])], evidence: [evidence({ id: "evidence-1", verifierId: "verifier-1", subjectType: "capability", subjectId: "capability-1" }), evidence({ id: "evidence-2", verifierId: "verifier-2", subjectType: "capability", subjectId: "capability-1" })], evaluatedAt: T1 });
    expect(result.state.unlockHistory).toHaveLength(1);
  });
});
