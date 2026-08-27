import type {
  EvidenceRepositoryPort,
  ExecutionLedgerRepositoryPort,
  TaskCapsuleRepositoryPort,
} from "@v31m4/application";
import {
  type EvidenceRecord,
  type ExecutionLedgerEntry,
  ExecutionLedgerEntry as LedgerEntry,
  sha256Hex,
  TaskCapsule,
  type TaskCapsuleInput,
  type TaskPhase,
} from "@v31m4/domain";
import { PRECONDITION_RESOURCE_KINDS } from "../../src/autonomy/evidence-precondition-catalog.js";
import {
  createEvidencePreconditionGate,
  type EvidencePreconditionGate,
} from "../../src/autonomy/evidence-precondition-gate.js";

/**
 * A real evidence-precondition gate over in-memory authoritative stores.
 *
 * Deliberately the production gate, not a stub: it resolves the same policy from the same catalog
 * and evaluates the same predicate, so a test that passes proves the gate allowed the operation
 * rather than that the gate was absent. Only the storage is in memory.
 */
export class PreconditionWorld {
  capsule: TaskCapsule | null = null;
  readonly entries: ExecutionLedgerEntry[] = [];
  readonly records: EvidenceRecord[] = [];
  private counter = 0;

  readonly capsules: TaskCapsuleRepositoryPort = {
    getHead: async () =>
      this.capsule === null
        ? null
        : {
            value: {
              taskId: this.capsule.taskId,
              capsuleRevision: this.capsule.capsuleRevision,
              fingerprint: this.capsule.fingerprint,
              updatedAt: this.capsule.updatedAt,
            },
            revision: String(this.capsule.capsuleRevision),
          },
    getRevision: async (_taskId, capsuleRevision) =>
      this.capsule !== null && this.capsule.capsuleRevision === capsuleRevision
        ? this.capsule
        : null,
    listRevisions: async () => ({
      items: this.capsule === null ? [] : [this.capsule],
      total: this.capsule === null ? 0 : 1,
    }),
    appendRevision: async () => {
      throw new Error("the precondition gate must never write");
    },
  };

  readonly ledger: ExecutionLedgerRepositoryPort = {
    append: async () => {
      throw new Error("the precondition gate must never write");
    },
    getById: async (id) => this.entries.find((entry) => entry.id === id) ?? null,
    listForTask: async (taskId) => {
      const items = this.entries.filter((entry) => entry.taskId === taskId);
      return { items, total: items.length };
    },
  };

  readonly evidence: EvidenceRepositoryPort = {
    getById: async (id) => {
      const found = this.records.find((record) => record.id === id);
      return found === undefined ? null : { value: found, revision: "1" };
    },
    list: async () => ({
      items: this.records.map((value) => ({ value, revision: "1" })),
      total: this.records.length,
    }),
    append: async () => {
      throw new Error("the precondition gate must never write");
    },
  };

  get gate(): EvidencePreconditionGate {
    return createEvidencePreconditionGate({
      capsules: this.capsules,
      ledger: this.ledger,
      evidence: this.evidence,
    });
  }

  /** The fingerprints every recorded fact currently carries; anything absent is not current. */
  currentFingerprints(): Record<string, string> {
    const current: Record<string, string> = {};
    for (const entry of this.entries) {
      if (entry.kind !== "observation" && entry.kind !== "check_result") continue;
      for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
    }
    return current;
  }

  withCapsule(taskId: string, jobId: string, phase: TaskPhase = "execute"): this {
    this.capsule = TaskCapsule.create({
      taskId,
      jobId,
      projectId: "project:1",
      phase,
      attempts: phase === "investigate" || phase === "plan" ? 0 : 1,
      maxAttempts: 3,
      objective: "Repair the failing verification path.",
      acceptanceCriterionIds: ["requirement:one"],
      dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
      workspaceId: "workspace-1",
      stopCondition: "stop after three attempts",
      updatedAt: "2026-08-27T00:00:00.000Z",
    } as TaskCapsuleInput);
    return this;
  }

  observe(
    taskId: string,
    jobId: string,
    resourceKind: string,
    locator = `${resourceKind}:1`,
  ): this {
    this.counter += 1;
    this.entries.push(
      LedgerEntry.create({
        id: `precondition:${this.counter}`,
        taskId,
        jobId,
        recordedAt: "2026-08-27T00:00:00.000Z",
        kind: "observation",
        detail: `${resourceKind} observed`,
        facts: [{ resourceKind, locator, fingerprint: sha256Hex(locator) }],
      }),
    );
    return this;
  }

  /** Everything `code.patch` needs: definition, impact, and the tests that will speak to it. */
  withPatchPrerequisites(taskId: string, jobId: string): this {
    return this.observe(taskId, jobId, PRECONDITION_RESOURCE_KINDS.symbolDefinition)
      .observe(taskId, jobId, PRECONDITION_RESOURCE_KINDS.impactAnalysis)
      .observe(taskId, jobId, PRECONDITION_RESOURCE_KINDS.testSelection);
  }

  /** Everything the raw escape hatch needs: the union of every gate, plus its own failure. */
  withEscapeHatchPrerequisites(taskId: string, jobId: string): this {
    return this.withPatchPrerequisites(taskId, jobId)
      .observe(taskId, jobId, PRECONDITION_RESOURCE_KINDS.verificationTarget)
      .observe(taskId, jobId, PRECONDITION_RESOURCE_KINDS.failureReport);
  }
}

const worlds = new Map<string, PreconditionWorld>();

/**
 * A world already carrying a capsule and every prerequisite, for tests about something else.
 *
 * Memoised per task so the gate and the observed fingerprints a caller passes describe the same
 * recorded facts. Two worlds would record the same observations under different entry ids and the
 * currency check would then compare one world's facts against the other's.
 */
export function satisfiedPreconditions(taskId: string, jobId: string): PreconditionWorld {
  const key = `${taskId}|${jobId}`;
  const existing = worlds.get(key);
  if (existing !== undefined) return existing;
  const world = new PreconditionWorld()
    .withCapsule(taskId, jobId)
    .withEscapeHatchPrerequisites(taskId, jobId);
  worlds.set(key, world);
  return world;
}

/** What that world currently observes, for a request that must prove its facts are still current. */
export function satisfiedFingerprints(taskId: string, jobId: string): Record<string, string> {
  return satisfiedPreconditions(taskId, jobId).currentFingerprints();
}
