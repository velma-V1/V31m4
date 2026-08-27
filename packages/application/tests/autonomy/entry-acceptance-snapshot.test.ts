import { ContentHash, sha256Hex, TaskCapsule } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  assertEntryAcceptanceContract,
  detectAcceptanceWeakening,
  type EntryAcceptanceInput,
  freezeEntryAcceptanceSnapshot,
} from "../../src/services/entry-acceptance-snapshot.js";

/**
 * The frozen Entry Acceptance Snapshot.
 *
 * The contract a bounded task is judged against is compiled from authoritative Task Capsule state
 * and fingerprinted *before* significant Executor work. Nothing downstream may reinterpret it: an
 * Executor cannot narrow what success means after seeing the code, and an Auditor cannot widen it
 * after seeing the result.
 */
const T0 = "2026-08-27T00:00:00.000Z";

const capsule = TaskCapsule.create({
  taskId: "task:snapshot",
  jobId: "job:1",
  projectId: "project:1",
  phase: "execute",
  attempts: 1,
  maxAttempts: 3,
  objective: "Repair the failing verification path.",
  acceptanceCriterionIds: ["requirement:one", "requirement:two"],
  constraints: ["no new dependency"],
  forbiddenChanges: ["packages/domain/src/index.ts"],
  dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
  workspaceId: "workspace-1",
  stopCondition: "stop after three attempts",
  updatedAt: T0,
});

const workspaceFingerprint = ContentHash.parse(sha256Hex("workspace-state"));

function input(overrides: Partial<EntryAcceptanceInput> = {}): EntryAcceptanceInput {
  return {
    capsule,
    requiredChecks: ["build.check", "test.regression"],
    requiredEvidenceKinds: ["unit_test"],
    riskPolicyIds: ["policy:high-risk"],
    workspaceFingerprint,
    frozenAt: T0,
    ...overrides,
  };
}

describe("the acceptance contract is compiled from authoritative state, not asserted", () => {
  it("takes objective, criteria, constraints, and forbidden changes from the capsule alone", () => {
    const snapshot = freezeEntryAcceptanceSnapshot(input());
    expect(snapshot.taskId).toBe("task:snapshot");
    expect(snapshot.capsuleRevision).toBe(capsule.capsuleRevision);
    expect(snapshot.capsuleFingerprint).toBe(capsule.fingerprint);
    expect(snapshot.objective).toBe(capsule.objective);
    expect([...snapshot.acceptanceCriterionIds]).toEqual(["requirement:one", "requirement:two"]);
    expect([...snapshot.constraints]).toEqual(["no new dependency"]);
    expect([...snapshot.forbiddenChanges]).toEqual(["packages/domain/src/index.ts"]);
    expect(snapshot.workspaceId).toBe("workspace-1");
    expect(snapshot.workspaceFingerprint).toBe(workspaceFingerprint);
  });

  it("is frozen at every level, so no holder can edit the contract in place", () => {
    const snapshot = freezeEntryAcceptanceSnapshot(input());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.requiredChecks)).toBe(true);
    expect(Object.isFrozen(snapshot.acceptanceCriterionIds)).toBe(true);
    expect(() => (snapshot.requiredChecks as string[]).push("test.targeted")).toThrow();
  });

  it("fingerprints the contract deterministically and independently of input order", () => {
    const a = freezeEntryAcceptanceSnapshot(input());
    const b = freezeEntryAcceptanceSnapshot(
      input({ requiredChecks: ["test.regression", "build.check"] }),
    );
    expect(a.contractFingerprint).toBe(b.contractFingerprint);
    const stronger = freezeEntryAcceptanceSnapshot(
      input({ requiredChecks: ["build.check", "test.regression", "test.targeted"] }),
    );
    expect(stronger.contractFingerprint).not.toBe(a.contractFingerprint);
  });

  it("keeps the declared checks in a stable canonical order regardless of how they arrived", () => {
    const snapshot = freezeEntryAcceptanceSnapshot(
      input({ requiredChecks: ["test.regression", "build.check", "build.check"] }),
    );
    expect([...snapshot.requiredChecks]).toEqual(["build.check", "test.regression"]);
  });

  it("refuses a contract with no way to be satisfied or with unbounded declarations", () => {
    expect(() => freezeEntryAcceptanceSnapshot(input({ frozenAt: "not-a-time" }))).toThrow();
    expect(() =>
      freezeEntryAcceptanceSnapshot(input({ requiredChecks: Array(200).fill("build.check") })),
    ).not.toThrow();
    expect(() =>
      freezeEntryAcceptanceSnapshot(
        input({
          requiredChecks: Array(200)
            .fill(0)
            .map((_, i) => `check.number_${i}`),
        }),
      ),
    ).toThrow();
  });
});

describe("the contract cannot be redefined after the fact", () => {
  it("verifies a snapshot against the fingerprint a role was handed", () => {
    const snapshot = freezeEntryAcceptanceSnapshot(input());
    expect(() =>
      assertEntryAcceptanceContract(snapshot, snapshot.contractFingerprint),
    ).not.toThrow();
    expect(() =>
      assertEntryAcceptanceContract(snapshot, ContentHash.parse(sha256Hex("other"))),
    ).toThrow(/contract/i);
  });

  it("detects a later contract that drops any required check, criterion, or prohibition", () => {
    const frozen = freezeEntryAcceptanceSnapshot(input());
    expect(detectAcceptanceWeakening(frozen, frozen)).toEqual([]);

    const droppedCheck = freezeEntryAcceptanceSnapshot(input({ requiredChecks: ["build.check"] }));
    expect(detectAcceptanceWeakening(frozen, droppedCheck)).toContain(
      "requiredChecks: test.regression",
    );

    const droppedEvidence = freezeEntryAcceptanceSnapshot(input({ requiredEvidenceKinds: [] }));
    expect(detectAcceptanceWeakening(frozen, droppedEvidence)).toContain(
      "requiredEvidenceKinds: unit_test",
    );

    const droppedPolicy = freezeEntryAcceptanceSnapshot(input({ riskPolicyIds: [] }));
    expect(detectAcceptanceWeakening(frozen, droppedPolicy)).toContain(
      "riskPolicyIds: policy:high-risk",
    );
  });

  it("treats a strictly stronger later contract as not weakened", () => {
    const frozen = freezeEntryAcceptanceSnapshot(input());
    const stronger = freezeEntryAcceptanceSnapshot(
      input({ requiredChecks: ["build.check", "test.regression", "test.targeted"] }),
    );
    expect(detectAcceptanceWeakening(frozen, stronger)).toEqual([]);
  });

  it("reports a changed objective or capsule identity as weakening, not as a stronger contract", () => {
    const frozen = freezeEntryAcceptanceSnapshot(input());
    const otherCapsule = TaskCapsule.create({
      taskId: "task:snapshot",
      jobId: "job:1",
      projectId: "project:1",
      phase: "execute",
      attempts: 1,
      maxAttempts: 3,
      objective: "Do something easier instead.",
      acceptanceCriterionIds: ["requirement:one"],
      dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
      workspaceId: "workspace-1",
      stopCondition: "stop after three attempts",
      updatedAt: T0,
    });
    const redefined = freezeEntryAcceptanceSnapshot(input({ capsule: otherCapsule }));
    const weakened = detectAcceptanceWeakening(frozen, redefined);
    expect(weakened).toContain("objective");
    expect(weakened).toContain("acceptanceCriterionIds: requirement:two");
  });
});
