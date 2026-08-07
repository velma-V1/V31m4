import { AvatarId, AvatarState, CapabilityProfile, EvidenceRecord, ProjectId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  evaluateAvatarUnlocksUseCase,
  runIdlePractice,
  stopIdlePractice,
} from "../../src/index.js";
import { budget, context, Harness, T0 } from "./fixtures.js";

describe("idle practice and avatar use cases", () => {
  it("persists the opaque workspace ID and disposes the correct workspace after stopping", async () => {
    const harness = new Harness();
    const profile = CapabilityProfile.create({
      capabilityId: "capability-1",
      displayName: "Capability One",
      domain: "software",
      initialScore: {
        capabilityId: "capability-1",
        score: 0.2,
        sampleSize: 5,
        difficultyRange: [0.1, 0.5],
        evidenceIds: ["evidence-capability-1"],
        measuredAt: T0,
      },
    });
    harness.capabilities.set("capability-1", { value: profile, revision: "1" });
    const started = await runIdlePractice(
      {
        unitOfWork: harness.unitOfWork,
        capabilities: harness.capabilityRepository,
        practice: harness.practiceRepository,
        resources: harness.resourceMonitor,
        workspaces: harness.workspaces,
      },
      {
        projectId: ProjectId.parse("project-1"),
        candidates: [
          {
            taskId: "practice-1",
            capabilityId: "capability-1",
            targetDifficulty: 0.4,
            estimatedCost: budget(),
            requiresProductionWrite: false,
            usesProductionSecrets: false,
            hasIndependentVerification: true,
            hasMeasurableOutcome: true,
          },
        ],
        recentCapabilityIds: [],
        requiredIdleMs: 60_000,
        cooldownMs: 60_000,
        approvedBudget: budget(),
      },
      context,
    );
    expect(started?.value.workspaceId).toBe("workspace-practice");
    if (started === null) throw new Error("Expected a selected practice task.");
    await stopIdlePractice(
      {
        unitOfWork: harness.unitOfWork,
        practice: harness.practiceRepository,
        workspaces: harness.workspaces,
      },
      started.value.id,
      [],
      context,
    );
    expect(harness.discardedWorkspaces).toEqual(["workspace-practice"]);
  });

  it("unlocks only from independent passed evidence bound to the required capability", async () => {
    const harness = new Harness();
    const evidenceOne = EvidenceRecord.create({
      id: "evidence-capability-1",
      projectId: "project-1",
      kind: "unit_test",
      subjectType: "capability",
      subjectId: "capability-1",
      status: "passed",
      summary: "passed",
      artifactIds: ["artifact-evidence-1"],
      verifierId: "verifier-1",
      verifierVersion: "1.0.0",
      createdAt: T0,
    });
    const evidenceTwo = EvidenceRecord.create({
      id: "evidence-capability-2",
      projectId: "project-1",
      kind: "unit_test",
      subjectType: "capability",
      subjectId: "capability-1",
      status: "passed",
      summary: "passed",
      artifactIds: ["artifact-evidence-2"],
      verifierId: "verifier-2",
      verifierVersion: "1.0.0",
      createdAt: T0,
    });
    const profile = CapabilityProfile.create({
      capabilityId: "capability-1",
      displayName: "Capability One",
      domain: "software",
      initialScore: {
        capabilityId: "capability-1",
        score: 0.9,
        sampleSize: 10,
        difficultyRange: [0.5, 1],
        evidenceIds: [evidenceOne.id, evidenceTwo.id],
        measuredAt: T0,
      },
    });
    harness.capabilities.set("capability-1", { value: profile, revision: "1" });
    harness.evidenceRecords.set(evidenceOne.id, { value: evidenceOne, revision: "1" });
    harness.evidenceRecords.set(evidenceTwo.id, { value: evidenceTwo, revision: "1" });
    const rule = AvatarState.createRule({
      id: "rule-1",
      title: "Capability One",
      requiredCapabilityIds: ["capability-1"],
      minimumScores: { "capability-1": 0.8 },
      requiredEvidenceKinds: ["unit_test"],
      minimumIndependentVerifiers: 2,
      unlockItemId: "item-1",
    });
    const avatar = await evaluateAvatarUnlocksUseCase(
      {
        unitOfWork: harness.unitOfWork,
        capabilities: harness.capabilityRepository,
        evidence: harness.evidenceRepository,
        clock: harness.clock,
      },
      AvatarId.parse("avatar-1"),
      [rule],
      context,
    );
    expect(avatar.value.unlockedItemIds).toEqual(["item-1"]);
  });
});
