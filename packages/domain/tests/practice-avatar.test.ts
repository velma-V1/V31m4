import { describe, expect, it } from "vitest";
import { AvatarState, DomainError, PracticeTask, ResourceBudget } from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";

describe("practice and avatar domain", () => {
  it("runs practice through isolated checkpoint, completion, and quarantine", () => {
    const task = PracticeTask.create({
      id: "practice-1",
      capabilityId: "capability-domain",
      targetDifficulty: 3,
      isolatedWorkspacePath: "practice/practice-1",
      resourceBudget: ResourceBudget.create({
        maxWallClockMs: 60_000,
        maxModelInvocations: 2,
        maxToolInvocations: 3,
        maxRepairRounds: 1,
        maxConcurrentWorkers: 1,
      }),
    });
    const running = PracticeTask.start(task);
    const checkpointed = PracticeTask.checkpoint(running, ["artifact-trace-1"]);
    const resumed = PracticeTask.start(checkpointed);
    const completed = PracticeTask.complete(resumed, ["artifact-trace-2"], ["evidence-1"]);
    const quarantined = PracticeTask.quarantine(completed);

    expect(quarantined.status).toBe("quarantined");
    expect(quarantined.traceArtifactIds).toEqual(["artifact-trace-1", "artifact-trace-2"]);
  });

  it("requires evidence before practice can complete", () => {
    const task = PracticeTask.create({
      id: "practice-1",
      capabilityId: "capability-domain",
      targetDifficulty: 3,
      isolatedWorkspacePath: "practice/practice-1",
      resourceBudget: ResourceBudget.create({
        maxWallClockMs: 60_000,
        maxModelInvocations: 2,
        maxToolInvocations: 3,
        maxRepairRounds: 1,
        maxConcurrentWorkers: 1,
      }),
    });
    const running = PracticeTask.start(task);

    expect(() => PracticeTask.complete(running, ["artifact-trace"], [])).toThrowError(DomainError);
  });

  it("creates evidence-backed permanent avatar unlocks", () => {
    const rule = AvatarState.createRule({
      id: "rule-domain",
      title: "Verified Domain Architect",
      requiredCapabilityIds: ["capability-domain"],
      minimumScores: { "capability-domain": 0.8 },
      requiredEvidenceKinds: ["hidden_test", "integration_test"],
      minimumIndependentVerifiers: 2,
      forbiddenEvidenceSources: ["activity_count", "elapsed_time"],
      unlockItemId: "item-domain-crown",
    });
    const state = AvatarState.create("avatar-1");
    const unlocked = AvatarState.unlock(state, {
      itemId: rule.unlockItemId,
      achievementRuleId: rule.id,
      evidenceIds: ["evidence-1", "evidence-2"],
      unlockedAt: T0,
    });
    const equipped = AvatarState.equip(unlocked, rule.unlockItemId);

    expect(unlocked.unlockHistory[0]?.permanent).toBe(true);
    expect(equipped.equippedItemIds).toEqual(["item-domain-crown"]);
    expect(state.unlockedItemIds).toEqual([]);
  });

  it("prevents locked avatar items from being equipped", () => {
    const state = AvatarState.create("avatar-1");
    expect(() => AvatarState.equip(state, "item-locked")).toThrowError(DomainError);
  });
});
