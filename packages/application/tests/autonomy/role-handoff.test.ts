import { type ContentHash, sha256Hex, TaskCapsule, type TaskCapsuleInput } from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuthoritativeRoleState,
  assertHandoffResultStateCompatible,
  assertHandoffStillCurrent,
  assertRoleHandoff,
  deriveAuditorHandoff,
  type EntryAcceptanceSnapshot,
  freezeEntryAcceptanceSnapshot,
  issueExecutorHandoff,
  type RoleExecutionPolicy,
} from "../../src/index.js";

/**
 * The Manager→role handoff.
 *
 * The Manager owns the whole bounded dispatch: which task, which acceptance contract, and which
 * role, model, skill, operation, and context policy the next role runs under. A role consumes that
 * decision; it never re-accepts an equivalent-looking one from whoever called it. These tests hold
 * that line from both sides — the handoff is derived from authoritative state, and every way of
 * substituting a different one is refused.
 */
const T0 = "2026-08-27T00:00:00.000Z";
const T1 = "2026-08-27T01:00:00.000Z";
const WORKSPACE_ENTRY = sha256Hex("workspace-entry") as ContentHash;
const WORKSPACE_AFTER = sha256Hex("workspace-after") as ContentHash;

function capsuleOf(overrides: Partial<TaskCapsuleInput> = {}): TaskCapsule {
  return TaskCapsule.create({
    taskId: "task:roles",
    jobId: "job:1",
    projectId: "project:1",
    phase: "execute",
    attempts: 1,
    maxAttempts: 3,
    objective: "Repair the failing verification path.",
    acceptanceCriterionIds: ["requirement:one"],
    forbiddenChanges: ["packages/domain/src/index.ts"],
    dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
    workspaceId: "workspace-1",
    stopCondition: "stop after three attempts",
    updatedAt: T0,
    ...overrides,
  } as TaskCapsuleInput);
}

const executorPolicy: RoleExecutionPolicy = Object.freeze({
  modelId: "qwen-role:14b",
  allowedOperations: ["code.inspect", "code.patch"],
  skillVersions: ["skill:repair@1.0.0"],
  reasoningPolicy: "disabled" as const,
  harnessVersion: "v31m4-autonomy-1.1.0",
  contextPolicy: Object.freeze({
    maxTurns: 4,
    maxToolCalls: 3,
    maxDefers: 1,
    maxRefusedTurns: 2,
    maxNoProgressTurns: 1,
    maxPromptBytes: 131_072,
    maxPromptTokens: 32_768,
  }),
});

const auditorPolicy: RoleExecutionPolicy = Object.freeze({
  ...executorPolicy,
  allowedOperations: ["code.inspect", "git.status"],
  skillVersions: ["skill:audit@1.0.0"],
});

let capsule: TaskCapsule;
let snapshot: EntryAcceptanceSnapshot;

function freeze(
  from: TaskCapsule,
  workspaceFingerprint: ContentHash | null,
): EntryAcceptanceSnapshot {
  return freezeEntryAcceptanceSnapshot({
    capsule: from,
    requiredChecks: ["build.check"],
    requiredEvidenceKinds: ["unit_test"],
    riskPolicyIds: [],
    workspaceFingerprint,
    frozenAt: T0,
  });
}

function executorHandoff(policy: RoleExecutionPolicy = executorPolicy) {
  return issueExecutorHandoff({ snapshot, capsule, jobId: "job:1", policy, issuedAt: T0 });
}

function authority(overrides: Partial<AuthoritativeRoleState> = {}): AuthoritativeRoleState {
  return {
    capsule,
    workspaceId: "workspace-1",
    workspaceFingerprint: WORKSPACE_ENTRY,
    ...overrides,
  };
}

beforeEach(() => {
  capsule = capsuleOf();
  snapshot = freeze(capsule, WORKSPACE_ENTRY);
});

describe("the Manager issues one immutable, fingerprinted handoff", () => {
  it("derives task, capsule, workspace, and contract identity from authoritative state", () => {
    const handoff = executorHandoff();
    expect(handoff).toMatchObject({
      handoffKind: "manager_to_executor",
      role: "executor",
      taskId: "task:roles",
      jobId: "job:1",
      capsuleRevision: capsule.capsuleRevision,
      capsuleFingerprint: capsule.fingerprint,
      workspaceId: "workspace-1",
      workspaceFingerprint: WORKSPACE_ENTRY,
      acceptanceContractFingerprint: snapshot.contractFingerprint,
      modelId: "qwen-role:14b",
      harnessVersion: "v31m4-autonomy-1.1.0",
      issuedAt: T0,
    });
    expect(handoff.handoffFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.allowedOperations)).toBe(true);
    expect(Object.isFrozen(handoff.contextPolicy)).toBe(true);
  });

  it("canonicalises the policy so declaration order cannot change the fingerprint", () => {
    const forward = executorHandoff();
    const reversed = executorHandoff({
      ...executorPolicy,
      allowedOperations: ["code.patch", "code.inspect", "code.patch"],
    });
    expect(reversed.handoffFingerprint).toBe(forward.handoffFingerprint);
    expect([...reversed.allowedOperations]).toEqual(["code.inspect", "code.patch"]);
  });

  it("changes fingerprint when any part of the dispatched policy changes", () => {
    const base = executorHandoff().handoffFingerprint;
    const variants: RoleExecutionPolicy[] = [
      { ...executorPolicy, allowedOperations: ["code.inspect"] },
      { ...executorPolicy, skillVersions: ["skill:repair@2.0.0"] },
      { ...executorPolicy, modelId: "other:14b" },
      { ...executorPolicy, reasoningPolicy: "enabled" },
      {
        ...executorPolicy,
        contextPolicy: { ...executorPolicy.contextPolicy, maxToolCalls: 9 },
      },
    ];
    for (const policy of variants) {
      expect(executorHandoff(policy).handoffFingerprint).not.toBe(base);
    }
  });

  it("refuses a snapshot that is not the contract for this authoritative capsule", () => {
    const other = capsuleOf({ objective: "Something else entirely, at sufficient length." });
    expect(() =>
      issueExecutorHandoff({
        snapshot: freeze(other, WORKSPACE_ENTRY),
        capsule,
        jobId: "job:1",
        policy: executorPolicy,
        issuedAt: T0,
      }),
    ).toThrow(/contract/iu);
  });

  it("refuses an empty or unbounded operation, skill, or harness policy", () => {
    for (const policy of [
      { ...executorPolicy, allowedOperations: [] },
      { ...executorPolicy, harnessVersion: "  " },
      { ...executorPolicy, modelId: "" },
      { ...executorPolicy, contextPolicy: { ...executorPolicy.contextPolicy, maxTurns: 0 } },
    ]) {
      expect(() => executorHandoff(policy as RoleExecutionPolicy)).toThrow(
        expect.objectContaining({ code: "INVALID_APPLICATION_INPUT" }),
      );
    }
  });

  it("proves it is the handoff a role was dispatched with", () => {
    const handoff = executorHandoff();
    expect(() => assertRoleHandoff(handoff, handoff.handoffFingerprint)).not.toThrow();
    expect(() => assertRoleHandoff(handoff, sha256Hex("forged") as ContentHash)).toThrow(
      expect.objectContaining({ code: "INTEGRITY_FAILURE" }),
    );
  });

  it("cannot be edited after issue: a tampered copy no longer verifies", () => {
    const handoff = executorHandoff();
    const tampered = { ...handoff, allowedOperations: ["command.run"] };
    expect(() => assertRoleHandoff(tampered, handoff.handoffFingerprint)).toThrow();
  });
});

describe("the handoff binds the entry state it was derived from", () => {
  it("passes only while the authoritative capsule and workspace are unchanged", () => {
    expect(() => assertHandoffStillCurrent(executorHandoff(), authority())).not.toThrow();
  });

  it("fails closed on a capsule that advanced between selection and dispatch", () => {
    const handoff = executorHandoff();
    const advanced = TaskCapsule.next(capsule, { updatedAt: T1 });
    expect(() => assertHandoffStillCurrent(handoff, authority({ capsule: advanced }))).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
  });

  it("fails closed on a swapped workspace, by identity or by state", () => {
    const handoff = executorHandoff();
    expect(() =>
      assertHandoffStillCurrent(handoff, authority({ workspaceId: "workspace-2" })),
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(() =>
      assertHandoffStillCurrent(handoff, authority({ workspaceFingerprint: WORKSPACE_AFTER })),
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("says reselection is required rather than inviting a retry of the same dispatch", () => {
    const handoff = executorHandoff();
    try {
      assertHandoffStillCurrent(handoff, authority({ workspaceId: "workspace-2" }));
      throw new Error("expected a conflict");
    } catch (error) {
      expect((error as { retryable: boolean }).retryable).toBe(false);
      expect((error as Error).message).toMatch(/reselect/iu);
    }
  });
});

describe("the Auditor handoff is derived afresh, never inherited", () => {
  function auditorHandoff(overrides: Record<string, unknown> = {}) {
    return deriveAuditorHandoff({
      executorHandoff: executorHandoff(),
      snapshot,
      capsule,
      workspaceFingerprint: WORKSPACE_AFTER,
      policy: auditorPolicy,
      issuedAt: T1,
      ...overrides,
    });
  }

  it("carries the frozen contract and the result state, with its own read-only policy", () => {
    const handoff = auditorHandoff();
    expect(handoff).toMatchObject({
      handoffKind: "manager_to_auditor",
      role: "auditor",
      acceptanceContractFingerprint: snapshot.contractFingerprint,
      workspaceFingerprint: WORKSPACE_AFTER,
      issuedAt: T1,
    });
    expect([...handoff.allowedOperations]).toEqual(["code.inspect", "git.status"]);
    expect([...handoff.skillVersions]).toEqual(["skill:audit@1.0.0"]);
  });

  it("is a different handoff from the Executor's, and never reuses its context policy identity", () => {
    const executor = executorHandoff();
    expect(auditorHandoff().handoffFingerprint).not.toBe(executor.handoffFingerprint);
  });

  it("refuses to be derived from a contract the Executor was not dispatched against", () => {
    const otherSnapshot = freeze(capsuleOf({ acceptanceCriterionIds: ["requirement:two"] }), null);
    expect(() => auditorHandoff({ snapshot: otherSnapshot })).toThrow(
      expect.objectContaining({ code: "INTEGRITY_FAILURE" }),
    );
  });

  it("accepts a capsule that advanced during execution but not one that regressed or moved", () => {
    const advanced = TaskCapsule.next(capsule, { updatedAt: T1 });
    const handoff = auditorHandoff();
    expect(() =>
      assertHandoffResultStateCompatible(
        handoff,
        authority({ capsule: advanced, workspaceFingerprint: WORKSPACE_AFTER }),
      ),
    ).not.toThrow();
    expect(() =>
      assertHandoffResultStateCompatible(
        handoff,
        authority({ workspaceId: "workspace-2", workspaceFingerprint: WORKSPACE_AFTER }),
      ),
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });
});
