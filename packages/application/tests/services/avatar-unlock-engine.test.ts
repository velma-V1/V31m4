import { AvatarState } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  AvatarUnlockEngine,
  type AvatarUnlockEngineInput,
  evaluateAvatarUnlocks,
  type UnlockEvidence,
} from "../../src/services/avatar-unlock-engine.js";

const now = "2026-08-06T12:00:00.000Z";

function rule(overrides: {
  id: string;
  unlockItemId: string;
  minVerifiers?: number;
  minScore?: number;
}) {
  return AvatarState.createRule({
    id: overrides.id,
    title: "Master renderer",
    requiredCapabilityIds: ["capability:render"],
    minimumScores: { "capability:render": overrides.minScore ?? 0.8 },
    requiredEvidenceKinds: ["hidden_test"],
    minimumIndependentVerifiers: overrides.minVerifiers ?? 2,
    unlockItemId: overrides.unlockItemId,
  });
}

function evidence(
  overrides: Partial<UnlockEvidence> & { evidenceId: string; verifierId: string },
): UnlockEvidence {
  return {
    kind: "hidden_test",
    source: "production",
    verified: true,
    revoked: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<AvatarUnlockEngineInput> = {}): AvatarUnlockEngineInput {
  return {
    state: AvatarState.create("avatar:1"),
    rules: [rule({ id: "rule:1", unlockItemId: "item:1" })],
    capabilityScores: { "capability:render": 0.9 },
    evidenceByRule: {
      "rule:1": [
        evidence({ evidenceId: "evidence:1", verifierId: "verifier:1" }),
        evidence({ evidenceId: "evidence:2", verifierId: "verifier:2" }),
      ],
    },
    now,
    ...overrides,
  };
}

describe("AvatarUnlockEngine.evaluate", () => {
  it("unlocks an item when every condition is met", () => {
    const result = evaluateAvatarUnlocks(baseInput());
    expect(result.unlocked).toHaveLength(1);
    expect(result.unlocked[0]?.itemId).toBe("item:1");
    expect(result.nextState.unlockedItemIds).toContain("item:1");
    expect(result.evolutionStage).toBe(1);
  });

  it("rejects a rule when a capability is below threshold", () => {
    const result = evaluateAvatarUnlocks(
      baseInput({ capabilityScores: { "capability:render": 0.5 } }),
    );
    expect(result.unlocked).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("capability_below_threshold");
  });

  it("rejects a rule with missing evidence", () => {
    const result = evaluateAvatarUnlocks(baseInput({ evidenceByRule: { "rule:1": [] } }));
    expect(result.rejected[0]?.reason).toBe("no_valid_evidence");
  });

  it("never unlocks from model claims", () => {
    const result = evaluateAvatarUnlocks(
      baseInput({
        evidenceByRule: {
          "rule:1": [
            evidence({ evidenceId: "evidence:1", verifierId: "verifier:1", source: "model_claim" }),
            evidence({ evidenceId: "evidence:2", verifierId: "verifier:2", source: "model_claim" }),
          ],
        },
      }),
    );
    expect(result.unlocked).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("no_valid_evidence");
  });

  it("never unlocks from unverified practice evidence", () => {
    const result = evaluateAvatarUnlocks(
      baseInput({
        evidenceByRule: {
          "rule:1": [
            evidence({
              evidenceId: "evidence:1",
              verifierId: "verifier:1",
              source: "practice",
              verified: false,
            }),
            evidence({
              evidenceId: "evidence:2",
              verifierId: "verifier:2",
              source: "practice",
              verified: false,
            }),
          ],
        },
      }),
    );
    expect(result.rejected[0]?.reason).toBe("no_valid_evidence");
  });

  it("counts duplicate evidence once, so it cannot fake independent verifiers", () => {
    const result = evaluateAvatarUnlocks(
      baseInput({
        evidenceByRule: {
          "rule:1": [
            evidence({ evidenceId: "evidence:1", verifierId: "verifier:1" }),
            evidence({ evidenceId: "evidence:1", verifierId: "verifier:1" }),
          ],
        },
      }),
    );
    expect(result.rejected[0]?.reason).toBe("insufficient_independent_verifiers");
  });

  it("does not produce a duplicate unlock and preserves existing unlocks", () => {
    const already = AvatarState.unlock(AvatarState.create("avatar:1"), {
      itemId: "item:1",
      achievementRuleId: "rule:1",
      evidenceIds: ["evidence:seed"],
      unlockedAt: "2026-08-01T00:00:00.000Z",
    });
    const result = evaluateAvatarUnlocks(baseInput({ state: already }));
    expect(result.unlocked).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("already_unlocked");
    expect(result.nextState.unlockedItemIds).toContain("item:1");
  });

  it("does not equip unless the rule explicitly permits it, and never equips locked items", () => {
    const unequipped = evaluateAvatarUnlocks(baseInput());
    expect(unequipped.nextState.equippedItemIds).not.toContain("item:1");

    const equipped = evaluateAvatarUnlocks(baseInput({ autoEquipRuleIds: ["rule:1"] }));
    expect(equipped.nextState.equippedItemIds).toContain("item:1");
    for (const itemId of equipped.nextState.equippedItemIds) {
      expect(equipped.nextState.unlockedItemIds).toContain(itemId);
    }
  });

  it("advances the evolution stage once per earned unlock, deterministically ordered", () => {
    const result = evaluateAvatarUnlocks(
      baseInput({
        rules: [
          rule({ id: "rule:b", unlockItemId: "item:b" }),
          rule({ id: "rule:a", unlockItemId: "item:a" }),
        ],
        evidenceByRule: {
          "rule:a": [
            evidence({ evidenceId: "evidence:a1", verifierId: "verifier:1" }),
            evidence({ evidenceId: "evidence:a2", verifierId: "verifier:2" }),
          ],
          "rule:b": [
            evidence({ evidenceId: "evidence:b1", verifierId: "verifier:1" }),
            evidence({ evidenceId: "evidence:b2", verifierId: "verifier:2" }),
          ],
        },
      }),
    );
    expect(result.unlocked.map((entry) => entry.itemId)).toEqual(["item:a", "item:b"]);
    expect(result.evolutionStage).toBe(2);
  });

  it("is deterministic for repeated evaluation", () => {
    const input = baseInput();
    expect(AvatarUnlockEngine.evaluate(input)).toStrictEqual(AvatarUnlockEngine.evaluate(input));
  });
});
