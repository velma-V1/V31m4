import { describe, expect, it } from "vitest";
import {
  TASK_CAPSULE_LIMITS,
  TaskCapsule,
  type TaskCapsuleInput,
} from "../src/entities/task-capsule.js";
import { ContentHash } from "../src/value-objects/content-hash.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 2 — the Task Capsule is bounded, immutable, and carries its
 * own logical revision and deterministic fingerprint. None of that may depend on the store.
 */
function baseInput(overrides: Partial<TaskCapsuleInput> = {}): TaskCapsuleInput {
  return {
    taskId: "task:root",
    jobId: "job:1",
    projectId: "project:1",
    objective: "Repair the failing verification path.",
    acceptanceCriterionIds: ["requirement:1"],
    constraints: ["no public API change"],
    forbiddenChanges: ["adapter protocol 1.0"],
    phase: "investigate",
    dagNodes: [
      { id: "node:root", title: "Investigate", dependsOn: [] },
      { id: "node:fix", title: "Fix", dependsOn: ["node:root"] },
    ],
    planSteps: ["reproduce", "fix"],
    nextAction: "reproduce",
    maxAttempts: 5,
    stopCondition: "no verified repair after 5 attempts",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("TaskCapsule creation", () => {
  it("creates a first revision with a deterministic fingerprint and no predecessor", () => {
    const capsule = TaskCapsule.create(baseInput());
    expect(capsule.capsuleRevision).toBe(1);
    expect(capsule.previousFingerprint).toBeNull();
    expect(ContentHash.is(capsule.fingerprint)).toBe(true);
    expect(capsule.phase).toBe("investigate");
    // Identical logical state must fingerprint identically, every time.
    expect(TaskCapsule.create(baseInput()).fingerprint).toBe(capsule.fingerprint);
  });

  it("rejects invalid identifiers", () => {
    for (const overrides of [
      { taskId: "" },
      { taskId: "has space" },
      { jobId: "../escape" },
      { projectId: "-leading" },
      { parentTaskId: "bad/slash" },
    ]) {
      expect(() => TaskCapsule.create(baseInput(overrides)), JSON.stringify(overrides)).toThrow();
    }
  });

  it("rejects an unknown phase", () => {
    expect(() =>
      TaskCapsule.create(baseInput({ phase: "finished" as TaskCapsuleInput["phase"] })),
    ).toThrow();
  });
});

describe("TaskCapsule immutability", () => {
  it("cannot be mutated through a retained input reference", () => {
    const dagNodes = [{ id: "node:root", title: "Investigate", dependsOn: [] as string[] }];
    const planSteps = ["reproduce"];
    const constraints = ["no public API change"];
    const capsule = TaskCapsule.create(baseInput({ dagNodes, planSteps, constraints }));
    const before = capsule.fingerprint;

    // The caller still holds the arrays it passed in.
    dagNodes.push({ id: "node:injected", title: "Injected", dependsOn: [] });
    dagNodes[0]?.dependsOn.push("node:injected");
    planSteps.push("injected");
    constraints.push("injected");

    expect(capsule.dagNodes).toHaveLength(1);
    expect(capsule.dagNodes[0]?.dependsOn).toEqual([]);
    expect(capsule.planSteps).toEqual(["reproduce"]);
    expect(capsule.constraints).toEqual(["no public API change"]);
    expect(TaskCapsule.fingerprintOf(capsule)).toBe(before);
  });

  it("cannot be mutated through the returned object", () => {
    const capsule = TaskCapsule.create(baseInput());
    expect(Object.isFrozen(capsule)).toBe(true);
    expect(Object.isFrozen(capsule.dagNodes)).toBe(true);
    expect(Object.isFrozen(capsule.dagNodes[0])).toBe(true);
    expect(Object.isFrozen(capsule.dagNodes[0]?.dependsOn)).toBe(true);
    expect(Object.isFrozen(capsule.planSteps)).toBe(true);
    expect(() => {
      (capsule as { phase: string }).phase = "complete";
    }).toThrow();
  });
});

describe("TaskCapsule DAG validation", () => {
  it("rejects a cycle", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({
          dagNodes: [
            { id: "node:a", title: "A", dependsOn: ["node:b"] },
            { id: "node:b", title: "B", dependsOn: ["node:a"] },
          ],
        }),
      ),
    ).toThrow(/cycle/iu);
  });

  it("rejects a longer cycle", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({
          dagNodes: [
            { id: "node:a", title: "A", dependsOn: ["node:c"] },
            { id: "node:b", title: "B", dependsOn: ["node:a"] },
            { id: "node:c", title: "C", dependsOn: ["node:b"] },
          ],
        }),
      ),
    ).toThrow(/cycle/iu);
  });

  it("rejects a self-dependency", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({ dagNodes: [{ id: "node:a", title: "A", dependsOn: ["node:a"] }] }),
      ),
    ).toThrow();
  });

  it("rejects duplicate node identifiers", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({
          dagNodes: [
            { id: "node:a", title: "A", dependsOn: [] },
            { id: "node:a", title: "Duplicate", dependsOn: [] },
          ],
        }),
      ),
    ).toThrow(/unique/iu);
  });

  it("rejects a dependency on a node that does not exist", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({ dagNodes: [{ id: "node:a", title: "A", dependsOn: ["node:missing"] }] }),
      ),
    ).toThrow(/exist/iu);
  });

  it("rejects duplicate dependencies within one node", () => {
    expect(() =>
      TaskCapsule.create(
        baseInput({
          dagNodes: [
            { id: "node:a", title: "A", dependsOn: [] },
            { id: "node:b", title: "B", dependsOn: ["node:a", "node:a"] },
          ],
        }),
      ),
    ).toThrow(/unique/iu);
  });
});

describe("TaskCapsule bounds", () => {
  it("rejects an oversized DAG", () => {
    const dagNodes = Array.from({ length: TASK_CAPSULE_LIMITS.maxDagNodes + 1 }, (_, index) => ({
      id: `node:${index}`,
      title: `Node ${index}`,
      dependsOn: [] as string[],
    }));
    expect(() => TaskCapsule.create(baseInput({ dagNodes }))).toThrow();
  });

  it("rejects too many dependencies on one node", () => {
    const dagNodes = [
      ...Array.from({ length: TASK_CAPSULE_LIMITS.maxDependenciesPerNode + 1 }, (_, index) => ({
        id: `node:${index}`,
        title: `Node ${index}`,
        dependsOn: [] as string[],
      })),
      {
        id: "node:sink",
        title: "Sink",
        dependsOn: Array.from(
          { length: TASK_CAPSULE_LIMITS.maxDependenciesPerNode + 1 },
          (_, index) => `node:${index}`,
        ),
      },
    ];
    expect(() => TaskCapsule.create(baseInput({ dagNodes }))).toThrow();
  });

  it("rejects unbounded collections", () => {
    const tooMany = (count: number) => Array.from({ length: count }, (_, i) => `item ${i}`);
    for (const overrides of [
      { hypotheses: tooMany(TASK_CAPSULE_LIMITS.maxHypotheses + 1) },
      { risks: tooMany(TASK_CAPSULE_LIMITS.maxRisks + 1) },
      { planSteps: tooMany(TASK_CAPSULE_LIMITS.maxPlanSteps + 1) },
      { constraints: tooMany(TASK_CAPSULE_LIMITS.maxConstraints + 1) },
      { forbiddenChanges: tooMany(TASK_CAPSULE_LIMITS.maxConstraints + 1) },
    ]) {
      expect(() => TaskCapsule.create(baseInput(overrides)), Object.keys(overrides)[0]).toThrow();
    }
  });

  it("rejects unbounded text", () => {
    const long = "x".repeat(TASK_CAPSULE_LIMITS.maxTextLength + 1);
    for (const overrides of [
      { objective: long },
      { stopCondition: long },
      { nextAction: long },
      { planSteps: [long] },
      { hypotheses: [long] },
    ]) {
      expect(() => TaskCapsule.create(baseInput(overrides)), Object.keys(overrides)[0]).toThrow();
    }
  });

  it("rejects an attempt ceiling outside its bound", () => {
    for (const maxAttempts of [0, -1, 1.5, TASK_CAPSULE_LIMITS.maxAttemptCeiling + 1]) {
      expect(() => TaskCapsule.create(baseInput({ maxAttempts }))).toThrow();
    }
  });
});

describe("TaskCapsule revisions", () => {
  it("advances the logical revision and chains the previous fingerprint", () => {
    const first = TaskCapsule.create(baseInput());
    const second = TaskCapsule.next(first, {
      phase: "plan",
      updatedAt: "2026-08-26T00:01:00.000Z",
    });
    expect(second.capsuleRevision).toBe(2);
    expect(second.previousFingerprint).toBe(first.fingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    // The predecessor is untouched.
    expect(first.capsuleRevision).toBe(1);
    expect(first.phase).toBe("investigate");
  });

  it("gives different revisions of identical visible state different fingerprints", () => {
    const first = TaskCapsule.create(baseInput());
    const second = TaskCapsule.next(first, { updatedAt: "2026-08-26T00:01:00.000Z" });
    const third = TaskCapsule.next(second, { updatedAt: "2026-08-26T00:01:00.000Z" });
    // Same phase and payload, but the revision and chain differ, so the fingerprints must.
    expect(new Set([first.fingerprint, second.fingerprint, third.fingerprint]).size).toBe(3);
  });

  it("fixes the attempt ceiling at creation so a task cannot widen its own budget", () => {
    const first = TaskCapsule.create(baseInput({ maxAttempts: 2, attempts: 2 }));
    // Even if a caller tries to smuggle a larger ceiling through, the predecessor's value wins.
    const second = TaskCapsule.next(first, {
      updatedAt: "2026-08-26T00:01:00.000Z",
      maxAttempts: 99,
    } as Parameters<typeof TaskCapsule.next>[1]);
    expect(second.maxAttempts).toBe(2);
    expect(second.attempts).toBe(2);
  });

  it("keeps the attempt and escalation counters monotonic", () => {
    const first = TaskCapsule.create(baseInput({ attempts: 2, escalations: 1 }));
    expect(() =>
      TaskCapsule.next(first, { updatedAt: "2026-08-26T00:01:00.000Z", attempts: 1 }),
    ).toThrow(/attempt counter cannot decrease/iu);
    expect(() =>
      TaskCapsule.next(first, { updatedAt: "2026-08-26T00:01:00.000Z", escalations: 0 }),
    ).toThrow(/escalation counter cannot decrease/iu);
    expect(
      TaskCapsule.next(first, { updatedAt: "2026-08-26T00:01:00.000Z", attempts: 3 }).attempts,
    ).toBe(3);
  });

  it("still refuses an attempt count beyond the fixed ceiling", () => {
    const first = TaskCapsule.create(baseInput({ maxAttempts: 2, attempts: 2 }));
    expect(() =>
      TaskCapsule.next(first, { updatedAt: "2026-08-26T00:01:00.000Z", attempts: 3 }),
    ).toThrow();
  });

  it("keeps the logical revision independent of any store revision", () => {
    const capsule = TaskCapsule.create(baseInput());
    // The capsule exposes only its own logical revision; there is no store revision on it.
    expect(capsule.capsuleRevision).toBe(1);
    expect("revision" in capsule).toBe(false);
    expect("version" in capsule).toBe(false);
  });
});

describe("TaskCapsule rehydration", () => {
  it("reconstructs an identical capsule from its serialized form", () => {
    const capsule = TaskCapsule.next(TaskCapsule.create(baseInput()), {
      phase: "plan",
      hypotheses: ["the verifier is comparing stale bytes"],
      risks: ["the fix may mask a deeper defect"],
      updatedAt: "2026-08-26T00:01:00.000Z",
    });
    const reloaded = TaskCapsule.rehydrate(JSON.parse(JSON.stringify(capsule)));
    expect(reloaded).toEqual(capsule);
    expect(reloaded.fingerprint).toBe(capsule.fingerprint);
    expect(Object.isFrozen(reloaded.dagNodes)).toBe(true);
  });

  it("refuses a persisted capsule whose fingerprint does not match its content", () => {
    const capsule = TaskCapsule.create(baseInput());
    const tampered = { ...JSON.parse(JSON.stringify(capsule)), objective: "Do something else." };
    expect(() => TaskCapsule.rehydrate(tampered)).toThrow(/fingerprint/iu);
  });

  it("refuses a persisted capsule with a forged fingerprint", () => {
    const capsule = TaskCapsule.create(baseInput());
    const forged = { ...JSON.parse(JSON.stringify(capsule)), fingerprint: "a".repeat(64) };
    expect(() => TaskCapsule.rehydrate(forged)).toThrow(/fingerprint/iu);
  });

  it("does not depend on key order in the persisted body", () => {
    const capsule = TaskCapsule.create(baseInput());
    const body = JSON.parse(JSON.stringify(capsule)) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(body).reverse());
    expect(TaskCapsule.rehydrate(shuffled).fingerprint).toBe(capsule.fingerprint);
  });
});
