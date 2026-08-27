import { ApplicationError, type TaskTransitionProposal, WriteConditions } from "@v31m4/application";
import {
  EvidenceRecord,
  TaskCapsule,
  type TaskCapsule as TaskCapsuleType,
  TaskId,
} from "@v31m4/domain";
import type { SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteTaskCapsuleRepository } from "../../src/autonomy/autonomy-state-infrastructure.js";
import { readyDagNodeIds, TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * Durable task state against a real SQLite database. These prove the properties that only real
 * persistence can: atomic revision/head movement, survival across a brand-new process-level
 * database instance, and deterministic replay from stored revisions with no conversation.
 */
const taskId = TaskId.parse("task:root");

const draft = {
  taskId: "task:root",
  jobId: "job:1",
  projectId: "project:1",
  objective: "Repair the failing verification path.",
  phase: "investigate" as const,
  dagNodes: [
    { id: "node:root", title: "Investigate", dependsOn: [] },
    { id: "node:fix", title: "Fix", dependsOn: ["node:root"] },
  ],
  maxAttempts: 3,
  stopCondition: "stop after three attempts",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

let database: SqliteRuntimeDatabase;
let databasePath: string;
let capsules: SqliteTaskCapsuleRepository;
let evidence: SqliteEvidenceRepository;
let manager: TaskManager;

function wire(db: SqliteRuntimeDatabase): void {
  capsules = new SqliteTaskCapsuleRepository(db);
  evidence = new SqliteEvidenceRepository(db);
  manager = new TaskManager({ unitOfWork: db.unitOfWork, capsules, evidence });
}

beforeEach(() => {
  database = runtimeDatabase();
  databasePath = database.path;
  wire(database);
});

afterEach(() => {
  database.close();
});

function proposalFor(
  capsule: TaskCapsuleType,
  headRevision: string,
  overrides: Partial<TaskTransitionProposal> = {},
): TaskTransitionProposal {
  return {
    taskId: capsule.taskId,
    expectedHeadRevision: headRevision,
    expectedCapsuleRevision: capsule.capsuleRevision,
    from: capsule.phase,
    to: "plan",
    evidenceIds: [],
    reason: "the reproduction is understood",
    ...overrides,
  };
}

describe("durable task capsule state", () => {
  it("persists the first revision and a head that names it", async () => {
    const created = await manager.createTask(draft, context);
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.capsule).toEqual(created.capsule);
    expect(current?.head.value.capsuleRevision).toBe(1);
    expect(current?.head.value.fingerprint).toBe(created.capsule.fingerprint);
  });

  it("appends a second revision, advances the head, and leaves history untouched", async () => {
    const created = await manager.createTask(draft, context);
    const moved = await manager.proposeTransition(
      proposalFor(created.capsule, created.head.revision),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    expect(moved.capsule.capsuleRevision).toBe(2);
    expect(moved.head.value.capsuleRevision).toBe(2);
    // The store revision advanced independently of the logical revision.
    expect(moved.head.revision).toBe("2");
    const first = await capsules.getRevision(taskId, 1, context);
    expect(first).toEqual(created.capsule);
  });

  it("keeps the head and its revision consistent after every accepted move", async () => {
    const created = await manager.createTask(draft, context);
    const planned = await manager.proposeTransition(
      proposalFor(created.capsule, created.head.revision),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    const executing = await manager.proposeTransition(
      proposalFor(planned.capsule, planned.head.revision, { to: "execute" }),
      { updatedAt: "2026-08-26T00:02:00.000Z" },
      context,
    );
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.capsule).toEqual(executing.capsule);
    expect(current?.capsule.attempts).toBe(1);
  });
});

describe("atomic revision and head movement", () => {
  it("leaves no revision behind when the head write is refused", async () => {
    const created = await manager.createTask(draft, context);
    const next = TaskCapsule.next(created.capsule, {
      phase: "plan",
      updatedAt: "2026-08-26T00:01:00.000Z",
    });

    // A stale head condition: the revision insert happens first, then the head write is refused.
    // The enclosing transaction must roll both back together.
    await expect(
      database.unitOfWork.execute(context, async (transaction) =>
        capsules.appendRevision(next, WriteConditions.matchRevision("999"), context, transaction),
      ),
    ).rejects.toBeInstanceOf(ApplicationError);

    expect(await capsules.getRevision(taskId, 2, context)).toBeNull();
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.head.value.capsuleRevision).toBe(1);
    expect(current?.capsule.fingerprint).toBe(created.capsule.fingerprint);
  });

  it("refuses to overwrite an existing logical revision", async () => {
    const created = await manager.createTask(draft, context);
    const forged = TaskCapsule.create({ ...draft, objective: "Something else entirely." });
    await expect(
      database.unitOfWork.execute(context, async (transaction) =>
        capsules.appendRevision(forged, WriteConditions.any(), context, transaction),
      ),
    ).rejects.toBeInstanceOf(ApplicationError);
    expect((await capsules.getRevision(taskId, 1, context))?.objective).toBe(
      created.capsule.objective,
    );
  });

  it("lets exactly one of two proposals from the same head advance", async () => {
    const created = await manager.createTask(draft, context);
    const proposal = proposalFor(created.capsule, created.head.revision);
    const outcomes = await Promise.allSettled([
      manager.proposeTransition(proposal, { updatedAt: "2026-08-26T00:01:00.000Z" }, context),
      manager.proposeTransition(proposal, { updatedAt: "2026-08-26T00:01:00.000Z" }, context),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find(
      (outcome) => outcome.status === "rejected",
    ) as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ApplicationError);
    expect(["VERSION_CONFLICT", "CONFLICT"]).toContain((loser.reason as ApplicationError).code);

    const current = await manager.loadCurrent(taskId, context);
    expect(current?.head.value.capsuleRevision).toBe(2);
    // No third revision was created by the loser.
    expect(await capsules.getRevision(taskId, 3, context)).toBeNull();
  });
});

describe("restart and replay", () => {
  it("recovers identical state from a brand-new database instance", async () => {
    const created = await manager.createTask(draft, context);
    const planned = await manager.proposeTransition(
      proposalFor(created.capsule, created.head.revision),
      { updatedAt: "2026-08-26T00:01:00.000Z", planSteps: ["reproduce", "fix"] },
      context,
    );
    database.close();

    // A brand-new instance on the same file: nothing from the previous process survives except
    // what was actually persisted.
    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    wire(database);

    const recovered = await manager.loadCurrent(taskId, context);
    expect(recovered?.capsule).toEqual(planned.capsule);
    expect(recovered?.capsule.fingerprint).toBe(planned.capsule.fingerprint);
    expect(recovered?.capsule.planSteps).toEqual(["reproduce", "fix"]);
    expect(recovered?.head.value.capsuleRevision).toBe(2);
  });

  it("replays the whole history from stored revisions alone", async () => {
    const created = await manager.createTask(draft, context);
    const planned = await manager.proposeTransition(
      proposalFor(created.capsule, created.head.revision),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    const executing = await manager.proposeTransition(
      proposalFor(planned.capsule, planned.head.revision, { to: "execute" }),
      { updatedAt: "2026-08-26T00:02:00.000Z" },
      context,
    );

    const page = await capsules.listRevisions(taskId, { limit: 100 }, context);
    expect(page.total).toBe(3);
    expect(page.items.map((capsule) => capsule.capsuleRevision)).toEqual([1, 2, 3]);
    // The fingerprint chain is intact end to end.
    expect(page.items[1]?.previousFingerprint).toBe(page.items[0]?.fingerprint);
    expect(page.items[2]?.previousFingerprint).toBe(page.items[1]?.fingerprint);
    expect(page.items[2]).toEqual(executing.capsule);
    expect(page.items[0]?.phase).toBe("investigate");
    expect(page.items[2]?.phase).toBe("execute");
  });

  it("refuses a stored revision whose body no longer matches its fingerprint", async () => {
    await manager.createTask(draft, context);
    // Tamper with the persisted body directly, as a corrupted or edited database would.
    database.connection
      .prepare("UPDATE records SET body = ? WHERE record_type = ? AND record_id = ?")
      .run(
        JSON.stringify({
          ...JSON.parse(
            (
              database.connection
                .prepare("SELECT body FROM records WHERE record_type = ? AND record_id = ?")
                .get("task_capsule_revision", "task:root#1") as { body: string }
            ).body,
          ),
          objective: "Tampered objective.",
        }),
        "task_capsule_revision",
        "task:root#1",
      );
    await expect(capsules.getRevision(taskId, 1, context)).rejects.toThrow(/fingerprint/iu);
  });

  it("reports a head that names a missing revision as an integrity failure", async () => {
    await manager.createTask(draft, context);
    database.connection
      .prepare("DELETE FROM records WHERE record_type = ? AND record_id = ?")
      .run("task_capsule_revision", "task:root#1");
    await expect(manager.loadCurrent(taskId, context)).rejects.toMatchObject({
      code: "INTEGRITY_FAILURE",
    });
  });
});

/**
 * Entering `complete` or `repair` is a claim about observed reality, so it must rest on records
 * the authoritative evidence store actually holds. These run against the real
 * `SqliteEvidenceRepository`, so a fabricated identifier has nowhere to resolve from.
 */
describe("evidence-backed transitions against the real evidence store", () => {
  async function reachVerify(): Promise<{
    readonly capsule: TaskCapsuleType;
    readonly headRevision: string;
  }> {
    let current = await manager.createTask(draft, context);
    for (const [index, phase] of (["plan", "execute", "verify"] as const).entries()) {
      current = await manager.proposeTransition(
        proposalFor(current.capsule, current.head.revision, {
          from: current.capsule.phase,
          to: phase,
        }),
        { updatedAt: `2026-08-26T00:0${index + 1}:00.000Z` },
        context,
      );
    }
    return { capsule: current.capsule, headRevision: current.head.revision };
  }

  async function storeEvidence(
    overrides: Partial<Parameters<typeof EvidenceRecord.create>[0]> = {},
  ): Promise<void> {
    const record = EvidenceRecord.create({
      id: "evidence:passing",
      projectId: "project:1",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "task",
      subjectId: "task:root",
      status: "passed",
      summary: "the targeted regression passed",
      artifactIds: ["artifact:log"],
      verifierId: "verifier:node",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    });
    await database.unitOfWork.execute(context, async (transaction) => {
      await evidence.append(record, context, transaction);
    });
  }

  it("refuses to enter complete on a fabricated canonical evidence ID", async () => {
    const { capsule, headRevision } = await reachVerify();
    await expect(
      manager.proposeTransition(
        proposalFor(capsule, headRevision, {
          from: "verify",
          to: "complete",
          evidenceIds: ["evidence:fake"],
        }),
        { updatedAt: "2026-08-26T00:04:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.capsule.phase).toBe("verify");
    expect(current?.capsule.verifiedEvidenceIds).toEqual([]);
  });

  it("refuses to enter repair on a fabricated canonical evidence ID", async () => {
    const { capsule, headRevision } = await reachVerify();
    await expect(
      manager.proposeTransition(
        proposalFor(capsule, headRevision, {
          from: "verify",
          to: "repair",
          evidenceIds: ["evidence:fake"],
        }),
        { updatedAt: "2026-08-26T00:04:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect((await manager.loadCurrent(taskId, context))?.capsule.phase).toBe("verify");
  });

  it("refuses failed, inconclusive, and wrong-scope evidence", async () => {
    for (const wrong of [
      { status: "failed" as const },
      { status: "inconclusive" as const },
      { projectId: "project:other" },
      { jobId: "job:other" },
      { subjectType: "candidate", subjectId: "candidate:1" },
    ]) {
      database.close();
      database = runtimeDatabase();
      wire(database);
      await storeEvidence(wrong);
      const { capsule, headRevision } = await reachVerify();
      await expect(
        manager.proposeTransition(
          proposalFor(capsule, headRevision, {
            from: "verify",
            to: "complete",
            evidenceIds: ["evidence:passing"],
          }),
          { updatedAt: "2026-08-26T00:04:00.000Z" },
          context,
        ),
        JSON.stringify(wrong),
      ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    }
  });

  it("still permits the intended transition on real passing evidence", async () => {
    await storeEvidence();
    const { capsule, headRevision } = await reachVerify();
    const completed = await manager.proposeTransition(
      proposalFor(capsule, headRevision, {
        from: "verify",
        to: "complete",
        evidenceIds: ["evidence:passing"],
      }),
      { updatedAt: "2026-08-26T00:04:00.000Z" },
      context,
    );
    expect(completed.capsule.phase).toBe("complete");
    expect(completed.capsule.verifiedEvidenceIds).toEqual(["evidence:passing"]);
    // And it is durable, not just returned.
    expect((await manager.loadCurrent(taskId, context))?.capsule.phase).toBe("complete");
  });

  it("refuses to complete on evidence for a criterion the same move replaces", async () => {
    // Against the real store: the record exists and passed, but the revision being committed no
    // longer owns the criterion it proved.
    await storeEvidence({ subjectType: "acceptance_criterion", subjectId: "requirement:old" });
    const created = await manager.createTask(
      { ...draft, phase: "verify", acceptanceCriterionIds: ["requirement:old"] },
      context,
    );
    await expect(
      manager.proposeTransition(
        proposalFor(created.capsule, created.head.revision, {
          from: "verify",
          to: "complete",
          evidenceIds: ["evidence:passing"],
        }),
        {
          updatedAt: "2026-08-26T00:04:00.000Z",
          acceptanceCriterionIds: ["requirement:new"],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.capsule.phase).toBe("verify");
    expect(current?.capsule.acceptanceCriterionIds).toEqual(["requirement:old"]);
  });

  it("refuses to carry durable verified evidence out of its scope", async () => {
    await storeEvidence({ subjectType: "acceptance_criterion", subjectId: "requirement:old" });
    const created = await manager.createTask(
      {
        ...draft,
        acceptanceCriterionIds: ["requirement:old"],
        verifiedEvidenceIds: ["evidence:passing"],
      },
      context,
    );
    await expect(
      manager.proposeTransition(
        proposalFor(created.capsule, created.head.revision, {
          from: "investigate",
          to: "plan",
        }),
        {
          updatedAt: "2026-08-26T00:01:00.000Z",
          acceptanceCriterionIds: ["requirement:new"],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect((await manager.loadCurrent(taskId, context))?.capsule.capsuleRevision).toBe(1);
  });
});

describe("DAG readiness", () => {
  it("reports unblocked nodes in capsule order", async () => {
    const created = await manager.createTask(draft, context);
    expect(readyDagNodeIds(created.capsule)).toEqual(["node:root", "node:fix"]);
  });

  it("excludes a blocked node and everything downstream of it", async () => {
    const capsule = TaskCapsule.create({
      ...draft,
      dagNodes: [
        { id: "node:root", title: "Investigate", dependsOn: [], blocked: true },
        { id: "node:fix", title: "Fix", dependsOn: ["node:root"] },
        { id: "node:other", title: "Other", dependsOn: [] },
      ],
    });
    expect(readyDagNodeIds(capsule)).toEqual(["node:other"]);
  });
});

/**
 * The same rule against the real durable repository. The point of proving it here rather than
 * only against a fake is that a bypass at creation writes a *durable* terminal record: `complete`
 * has no legal outgoing transition, so the checked API can never correct what was persisted.
 */
describe("durable creation obeys the phase-entry rules", () => {
  async function storeEvidence(
    overrides: Partial<Parameters<typeof EvidenceRecord.create>[0]> = {},
  ): Promise<void> {
    const record = EvidenceRecord.create({
      id: "evidence:passing",
      projectId: "project:1",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "task",
      subjectId: "task:root",
      status: "passed",
      summary: "the targeted regression passed",
      artifactIds: ["artifact:log"],
      verifierId: "verifier:node",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    });
    await database.unitOfWork.execute(context, async (transaction) => {
      await evidence.append(record, context, transaction);
    });
  }

  it("never persists a task declared complete at birth", async () => {
    await expect(
      manager.createTask({ ...draft, phase: "complete" }, context),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    // Nothing at all was written: no head, no revision, no half-created task.
    expect(await manager.loadCurrent(taskId, context)).toBeNull();
    expect(await capsules.getRevision(taskId, 1, context)).toBeNull();
  });

  it("never persists a task declared in repair at birth", async () => {
    await expect(
      manager.createTask({ ...draft, phase: "repair", attempts: 1 }, context),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(await manager.loadCurrent(taskId, context)).toBeNull();
  });

  it("never persists a task born mid-attempt with the budget unspent", async () => {
    await expect(manager.createTask({ ...draft, phase: "execute" }, context)).rejects.toMatchObject(
      { code: "INVALID_APPLICATION_INPUT" },
    );
    expect(await manager.loadCurrent(taskId, context)).toBeNull();
  });

  it("persists an evidence-gated creation backed by the durable evidence authority", async () => {
    await storeEvidence();
    const created = await manager.createTask(
      { ...draft, phase: "complete", verifiedEvidenceIds: ["evidence:passing"] },
      context,
    );
    const current = await manager.loadCurrent(taskId, context);
    expect(current?.capsule.phase).toBe("complete");
    expect(current?.capsule.verifiedEvidenceIds).toEqual(["evidence:passing"]);
    expect(current?.head.value.fingerprint).toBe(created.capsule.fingerprint);
  });

  it("refuses a durable evidence-gated creation the authority does not back", async () => {
    await storeEvidence({ status: "failed" });
    await expect(
      manager.createTask(
        { ...draft, phase: "complete", verifiedEvidenceIds: ["evidence:passing"] },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(await manager.loadCurrent(taskId, context)).toBeNull();
  });
});
