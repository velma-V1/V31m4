import type {
  EvidenceId,
  EvidenceRecord as EvidenceRecordType,
  TaskCapsule as TaskCapsuleType,
} from "@v31m4/domain";
import { EvidenceRecord, TaskCapsule } from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationError } from "../../src/application-errors.js";
import { createOperationContext, type OperationContext } from "../../src/operation-context.js";
import type { PortPage, Versioned, WriteCondition } from "../../src/port-types.js";
import type { EvidenceRepositoryPort } from "../../src/ports/evidence-repository.port.js";
import type {
  TaskCapsuleHead,
  TaskCapsuleRepositoryPort,
} from "../../src/ports/task-capsule-repository.port.js";
import type { UnitOfWorkPort, UnitOfWorkTransaction } from "../../src/ports/unit-of-work.port.js";
import { createTaskCapsule } from "../../src/use-cases/create-task-capsule.js";
import { proposeTaskTransition } from "../../src/use-cases/propose-task-transition.js";

const context: OperationContext = createOperationContext({
  requestId: "request:1",
  idempotencyKey: "key:1",
  actor: { id: "runtime", kind: "system", roles: ["runtime"] },
  startedAt: "2026-08-26T00:00:00.000Z",
});

/**
 * An in-memory stand-in for the repository. It deliberately models the two things that matter:
 * revisions are append-only, and the head carries its own store revision used for optimistic
 * concurrency — a different number from the capsule's logical revision.
 */
class FakeRepository implements TaskCapsuleRepositoryPort {
  readonly revisions = new Map<string, TaskCapsuleType>();
  head: Versioned<TaskCapsuleHead> | null = null;
  failHeadWrite = false;

  async getHead(): Promise<Versioned<TaskCapsuleHead> | null> {
    return this.head;
  }
  async getRevision(taskId: string, capsuleRevision: number): Promise<TaskCapsuleType | null> {
    return this.revisions.get(`${taskId}#${capsuleRevision}`) ?? null;
  }
  async listRevisions(): Promise<PortPage<TaskCapsuleType>> {
    const items = [...this.revisions.values()].sort(
      (left, right) => left.capsuleRevision - right.capsuleRevision,
    );
    return Object.freeze({ items: Object.freeze(items), total: items.length });
  }
  async appendRevision(
    capsule: TaskCapsuleType,
    headCondition: WriteCondition,
  ): Promise<Versioned<TaskCapsuleHead>> {
    const key = `${capsule.taskId}#${capsule.capsuleRevision}`;
    if (this.revisions.has(key)) {
      throw new ApplicationError("CONFLICT", "Revision already exists.");
    }
    if (headCondition.kind === "must_not_exist" && this.head !== null) {
      throw new ApplicationError("CONFLICT", "Head already exists.");
    }
    if (headCondition.kind === "match_revision" && this.head?.revision !== headCondition.revision) {
      throw new ApplicationError("VERSION_CONFLICT", "Head revision conflict.");
    }
    this.revisions.set(key, capsule);
    if (this.failHeadWrite) {
      // The transaction would roll back; the revision must not survive.
      this.revisions.delete(key);
      throw new ApplicationError("TRANSACTION_FAILED", "Head write failed.");
    }
    const revision = this.head === null ? "1" : String(Number(this.head.revision) + 1);
    this.head = Object.freeze({
      revision,
      value: Object.freeze({
        taskId: capsule.taskId,
        capsuleRevision: capsule.capsuleRevision,
        fingerprint: capsule.fingerprint,
        updatedAt: capsule.updatedAt,
      }),
    });
    return this.head;
  }
}

const unitOfWork: UnitOfWorkPort = {
  execute: async (_ctx, work) =>
    work({
      id: "transaction:1",
      startedAt: "2026-08-26T00:00:00.000Z",
      afterCommit() {},
      afterRollback() {},
    } as UnitOfWorkTransaction),
};

/** The one evidence authority, in memory. Only records actually appended here can be resolved. */
class FakeEvidence implements EvidenceRepositoryPort {
  readonly records = new Map<string, EvidenceRecordType>();

  async getById(id: EvidenceId): Promise<Versioned<EvidenceRecordType> | null> {
    const record = this.records.get(id);
    return record === undefined ? null : Object.freeze({ value: record, revision: "1" });
  }
  async list(): Promise<PortPage<Versioned<EvidenceRecordType>>> {
    return Object.freeze({ items: Object.freeze([]), total: 0 });
  }
  async append(record: EvidenceRecordType): Promise<Versioned<EvidenceRecordType>> {
    this.records.set(record.id, record);
    return Object.freeze({ value: record, revision: "1" });
  }
}

let capsules: FakeRepository;
let evidence: FakeEvidence;

function deps() {
  return { unitOfWork, capsules, evidence };
}

function evidenceRecord(
  overrides: Partial<Parameters<typeof EvidenceRecord.create>[0]> = {},
): EvidenceRecordType {
  return EvidenceRecord.create({
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
}

beforeEach(() => {
  capsules = new FakeRepository();
  evidence = new FakeEvidence();
});

const draft = {
  taskId: "task:root",
  jobId: "job:1",
  projectId: "project:1",
  objective: "Repair the failing verification path.",
  phase: "investigate" as const,
  maxAttempts: 3,
  stopCondition: "stop after three attempts",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

async function seed(): Promise<TaskCapsuleType> {
  const { capsule } = await createTaskCapsule(deps(), draft, context);
  return capsule;
}

function proposalFor(capsule: TaskCapsuleType, overrides: Record<string, unknown> = {}) {
  return {
    taskId: capsule.taskId,
    expectedHeadRevision: capsules.head?.revision ?? "1",
    expectedCapsuleRevision: capsule.capsuleRevision,
    from: capsule.phase,
    to: "plan" as const,
    evidenceIds: [] as readonly string[],
    reason: "the reproduction is understood",
    ...overrides,
  };
}

describe("createTaskCapsule", () => {
  it("stores the first revision and a head that points at it", async () => {
    const { capsule, head } = await createTaskCapsule(deps(), draft, context);
    expect(capsule.capsuleRevision).toBe(1);
    expect(head.value.capsuleRevision).toBe(1);
    expect(head.value.fingerprint).toBe(capsule.fingerprint);
    // The head's store revision is its own counter, not the capsule's logical revision.
    expect(head.revision).toBe("1");
    expect(await capsules.getRevision("task:root", 1)).toEqual(capsule);
  });

  it("refuses to create the same task twice", async () => {
    await seed();
    await expect(createTaskCapsule(deps(), draft, context)).rejects.toBeInstanceOf(
      ApplicationError,
    );
  });

  it("refuses to seed a first revision with unverified evidence references", async () => {
    // Otherwise creation would be a way to declare a fabricated reference "verified", and every
    // later transition would inherit it as already-established proof.
    await expect(
      createTaskCapsule(deps(), { ...draft, verifiedEvidenceIds: ["evidence:fake"] }, context),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(capsules.revisions.size).toBe(0);
    expect(capsules.head).toBeNull();
  });

  it("refuses to seed a first revision with failed or wrong-scope evidence", async () => {
    for (const wrong of [
      { status: "failed" as const },
      { subjectType: "candidate", subjectId: "candidate:1" },
    ]) {
      capsules = new FakeRepository();
      evidence = new FakeEvidence();
      await evidence.append(evidenceRecord(wrong));
      await expect(
        createTaskCapsule(deps(), { ...draft, verifiedEvidenceIds: ["evidence:passing"] }, context),
        JSON.stringify(wrong),
      ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    }
  });

  it("accepts a first revision carrying real passing evidence about this task", async () => {
    await evidence.append(evidenceRecord());
    const { capsule } = await createTaskCapsule(
      deps(),
      { ...draft, verifiedEvidenceIds: ["evidence:passing"] },
      context,
    );
    expect(capsule.verifiedEvidenceIds).toEqual(["evidence:passing"]);
  });
});

describe("proposeTaskTransition", () => {
  it("appends the next logical revision and advances the head atomically", async () => {
    const first = await seed();
    const { capsule, head } = await proposeTaskTransition(
      deps(),
      proposalFor(first),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    expect(capsule.capsuleRevision).toBe(2);
    expect(capsule.phase).toBe("plan");
    expect(capsule.previousFingerprint).toBe(first.fingerprint);
    expect(head.value.capsuleRevision).toBe(2);
    expect(head.value.fingerprint).toBe(capsule.fingerprint);
    // Revision 1 is still there, unchanged: history is append-only.
    expect(await capsules.getRevision("task:root", 1)).toEqual(first);
  });

  it("charges an attempt when entering execute", async () => {
    const first = await seed();
    const planned = await proposeTaskTransition(
      deps(),
      proposalFor(first),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    const executing = await proposeTaskTransition(
      deps(),
      proposalFor(planned.capsule, { to: "execute" }),
      { updatedAt: "2026-08-26T00:02:00.000Z" },
      context,
    );
    expect(executing.capsule.attempts).toBe(1);
  });

  it("refuses a stale store head revision even when the logical revision matches", async () => {
    const first = await seed();
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(first, { expectedHeadRevision: "99" }),
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(capsules.revisions.size).toBe(1);
  });

  it("refuses a stale logical capsule revision even when the store head matches", async () => {
    const first = await seed();
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(first, { expectedCapsuleRevision: 99 }),
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(capsules.revisions.size).toBe(1);
  });

  it("refuses a transition the policy rejects", async () => {
    const first = await seed();
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(first, { to: "complete" }),
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toBeInstanceOf(ApplicationError);
    expect(capsules.revisions.size).toBe(1);
  });

  it("leaves no revision behind when the head cannot be advanced", async () => {
    const first = await seed();
    capsules.failHeadWrite = true;
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(first),
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toBeInstanceOf(ApplicationError);
    // No orphan revision, and the head still points at revision 1.
    expect(await capsules.getRevision("task:root", 2)).toBeNull();
    expect(capsules.head?.value.capsuleRevision).toBe(1);
  });

  it("lets exactly one of two proposals from the same head win", async () => {
    const first = await seed();
    const proposal = proposalFor(first);
    const outcomes = await Promise.allSettled([
      proposeTaskTransition(deps(), proposal, { updatedAt: "2026-08-26T00:01:00.000Z" }, context),
      proposeTaskTransition(deps(), proposal, { updatedAt: "2026-08-26T00:01:00.000Z" }, context),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ApplicationError);
    expect(capsules.head?.value.capsuleRevision).toBe(2);
  });

  it("cannot escape an exhausted attempt budget by proposing a wider one", async () => {
    const first = await createTaskCapsule(
      deps(),
      { ...draft, maxAttempts: 1, phase: "plan" },
      context,
    );
    // Spend the only attempt.
    const executing = await proposeTaskTransition(
      deps(),
      proposalFor(first.capsule, { from: "plan", to: "execute" }),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    expect(executing.capsule.attempts).toBe(1);

    // Return to plan, then try to execute again while smuggling a larger ceiling through.
    const replanned = await proposeTaskTransition(
      deps(),
      proposalFor(executing.capsule, { from: "execute", to: "blocked" }),
      { updatedAt: "2026-08-26T00:02:00.000Z" },
      context,
    );
    const unblocked = await proposeTaskTransition(
      deps(),
      proposalFor(replanned.capsule, { from: "blocked", to: "plan" }),
      { updatedAt: "2026-08-26T00:03:00.000Z" },
      context,
    );
    expect(unblocked.capsule.maxAttempts).toBe(1);
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(unblocked.capsule, { from: "plan", to: "execute" }),
        { updatedAt: "2026-08-26T00:04:00.000Z", maxAttempts: 99 } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_EXHAUSTED" });
  });

  it("refuses a proposal for a task that does not exist", async () => {
    await expect(
      proposeTaskTransition(
        deps(),
        {
          taskId: "task:missing",
          expectedHeadRevision: "1",
          expectedCapsuleRevision: 1,
          from: "investigate",
          to: "plan",
          evidenceIds: [],
          reason: "nothing to move",
        },
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * A phase whose entry is a claim about observed reality may only be entered on evidence the
 * authoritative evidence layer actually resolved and accepted. A syntactically valid identifier
 * proves nothing on its own — that was the hole these regressions close.
 */
describe("evidence-gated transitions", () => {
  async function atVerify(): Promise<TaskCapsuleType> {
    const first = await createTaskCapsule(deps(), { ...draft, phase: "verify" }, context);
    return first.capsule;
  }

  async function enterComplete(current: TaskCapsuleType, evidenceIds: readonly string[]) {
    return proposeTaskTransition(
      deps(),
      proposalFor(current, { from: "verify", to: "complete", evidenceIds }),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
  }

  it("refuses a fabricated evidence ID for complete", async () => {
    const current = await atVerify();
    await expect(enterComplete(current, ["evidence:fake"])).rejects.toMatchObject({
      code: "INVALID_APPLICATION_INPUT",
    });
    expect(capsules.revisions.size).toBe(1);
    expect(capsules.head?.value.capsuleRevision).toBe(1);
  });

  it("refuses a fabricated evidence ID for repair", async () => {
    const current = await atVerify();
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(current, { from: "verify", to: "repair", evidenceIds: ["evidence:fake"] }),
        { updatedAt: "2026-08-26T00:01:00.000Z" },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(capsules.revisions.size).toBe(1);
  });

  it("refuses failed and inconclusive evidence", async () => {
    for (const status of ["failed", "inconclusive"] as const) {
      capsules = new FakeRepository();
      evidence = new FakeEvidence();
      await evidence.append(evidenceRecord({ status }));
      const current = await atVerify();
      await expect(enterComplete(current, ["evidence:passing"]), status).rejects.toMatchObject({
        code: "INVALID_APPLICATION_INPUT",
      });
    }
  });

  it("refuses evidence scoped to another project, job, or subject", async () => {
    for (const wrong of [
      { projectId: "project:other" },
      { jobId: "job:other" },
      { subjectType: "task", subjectId: "task:elsewhere" },
      { subjectType: "candidate", subjectId: "candidate:1" },
    ] as const) {
      capsules = new FakeRepository();
      evidence = new FakeEvidence();
      await evidence.append(evidenceRecord(wrong));
      const current = await atVerify();
      await expect(
        enterComplete(current, ["evidence:passing"]),
        JSON.stringify(wrong),
      ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    }
  });

  it("allows the transition on real passing evidence about this task", async () => {
    await evidence.append(evidenceRecord());
    const current = await atVerify();
    const completed = await enterComplete(current, ["evidence:passing"]);
    expect(completed.capsule.phase).toBe("complete");
    expect(completed.capsule.verifiedEvidenceIds).toEqual(["evidence:passing"]);
  });

  it("refuses a rewritten verified-evidence set that smuggles in an unresolved reference", async () => {
    await evidence.append(evidenceRecord());
    const current = await atVerify();
    await expect(
      proposeTaskTransition(
        deps(),
        proposalFor(current, {
          from: "verify",
          to: "complete",
          evidenceIds: ["evidence:passing"],
        }),
        {
          updatedAt: "2026-08-26T00:01:00.000Z",
          verifiedEvidenceIds: ["evidence:passing", "evidence:fake"],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(capsules.revisions.size).toBe(1);
  });

  it("does not consult the evidence store for a transition that cites none", async () => {
    // A phase that needs no proof must not be made to acquire some; only the investigation path
    // stays open when evidence is missing.
    const first = await seed();
    const planned = await proposeTaskTransition(
      deps(),
      proposalFor(first),
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      context,
    );
    expect(planned.capsule.phase).toBe("plan");
    expect(evidence.records.size).toBe(0);
  });
});

describe("replay without conversation history", () => {
  it("reconstructs the latest state from stored revisions alone", async () => {
    const first = await seed();
    const planned = await proposeTaskTransition(
      deps(),
      proposalFor(first),
      { updatedAt: "2026-08-26T00:01:00.000Z", planSteps: ["reproduce", "fix"] },
      context,
    );
    const executing = await proposeTaskTransition(
      deps(),
      proposalFor(planned.capsule, { to: "execute" }),
      { updatedAt: "2026-08-26T00:02:00.000Z" },
      context,
    );

    // Replay: read the revisions in order and rehydrate each one. Nothing else is consulted.
    const page = await capsules.listRevisions();
    const replayed = page.items.map((stored) =>
      TaskCapsule.rehydrate(JSON.parse(JSON.stringify(stored))),
    );
    expect(replayed).toHaveLength(3);
    expect(replayed.map((capsule) => capsule.capsuleRevision)).toEqual([1, 2, 3]);
    // The chain is intact and the final state matches exactly.
    expect(replayed[1]?.previousFingerprint).toBe(replayed[0]?.fingerprint);
    expect(replayed[2]?.previousFingerprint).toBe(replayed[1]?.fingerprint);
    expect(replayed[2]).toEqual(executing.capsule);
    expect(replayed[2]?.fingerprint).toBe(capsules.head?.value.fingerprint);
  });
});
