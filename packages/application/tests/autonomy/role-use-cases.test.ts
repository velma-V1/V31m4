import {
  type ContentHash,
  EvidenceRecord,
  ExecutionLedgerEntry,
  sha256Hex,
  TaskCapsule,
  type TaskCapsuleInput,
  TaskId,
} from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuditTaskResultCommand,
  auditTaskResult,
  createOperationContext,
  type EvidenceRepositoryPort,
  type ExecutionLedgerRepositoryPort,
  freezeEntryAcceptanceSnapshot,
  type PortPage,
  readyDagNodeIds,
  type SelectNextTaskCommand,
  selectNextTask,
  type TaskCapsuleRepositoryPort,
} from "../../src/index.js";

/**
 * The Manager and the Auditor as deterministic decisions.
 *
 * Neither may mutate authoritative state, and neither may take a model's word for anything. The
 * Manager reads durable state and says what should happen next; the Auditor reads durable state and
 * says whether the frozen contract was met. Both are pure functions of what is recorded.
 */
const T0 = "2026-08-27T00:00:00.000Z";
const taskId = TaskId.parse("task:roles");

const context = createOperationContext({
  requestId: "request-roles",
  idempotencyKey: "idem-roles",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: T0,
});

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
    dagNodes: [
      { id: "node:root", title: "Investigate", dependsOn: [] },
      { id: "node:fix", title: "Fix", dependsOn: ["node:root"] },
    ],
    workspaceId: "workspace-1",
    stopCondition: "stop after three attempts",
    updatedAt: T0,
    ...overrides,
  } as TaskCapsuleInput);
}

let capsule: TaskCapsule;
let ledgerEntries: ExecutionLedgerEntry[];
let evidenceRecords: EvidenceRecord[];
let writes: string[];

const capsules: TaskCapsuleRepositoryPort = {
  async getHead() {
    return {
      value: {
        taskId,
        capsuleRevision: capsule.capsuleRevision,
        fingerprint: capsule.fingerprint,
        updatedAt: capsule.updatedAt,
      },
      revision: String(capsule.capsuleRevision),
    };
  },
  async getRevision(_taskId, capsuleRevision) {
    return capsuleRevision === capsule.capsuleRevision ? capsule : null;
  },
  async listRevisions() {
    return { items: [capsule], total: 1 };
  },
  async appendRevision() {
    writes.push("capsule.appendRevision");
    throw new Error("the manager must never write");
  },
};

const ledger: ExecutionLedgerRepositoryPort = {
  async append() {
    writes.push("ledger.append");
    throw new Error("the manager must never write");
  },
  async getById(id) {
    return ledgerEntries.find((entry) => entry.id === id) ?? null;
  },
  async listForTask(): Promise<PortPage<ExecutionLedgerEntry>> {
    return { items: [...ledgerEntries], total: ledgerEntries.length };
  },
};

const evidence: EvidenceRepositoryPort = {
  async getById(id) {
    const found = evidenceRecords.find((record) => record.id === id);
    return found === undefined ? null : { value: found, revision: "1" };
  },
  async list() {
    return { items: evidenceRecords.map((value) => ({ value, revision: "1" })), total: 0 };
  },
  async append() {
    writes.push("evidence.append");
    throw new Error("the auditor must never write");
  },
};

let counter = 0;
function checkResult(checkName: string, passed: boolean): ExecutionLedgerEntry {
  counter += 1;
  return ExecutionLedgerEntry.create({
    id: `ledger:${counter}`,
    taskId: "task:roles",
    jobId: "job:1",
    recordedAt: T0,
    kind: "check_result",
    checkName,
    passed,
    detail: `${checkName} recorded`,
    facts: [
      {
        resourceKind: "check_report",
        locator: `reports/${checkName}.json`,
        fingerprint: sha256Hex(`${checkName}:${passed}`),
      },
    ],
  });
}

function passingEvidence(subjectId: string, kind: EvidenceRecord["kind"] = "unit_test") {
  counter += 1;
  return EvidenceRecord.create({
    id: `evidence:${counter}`,
    projectId: "project:1",
    jobId: "job:1",
    kind,
    subjectType: "acceptance_criterion",
    subjectId,
    status: "passed",
    summary: `${subjectId} verified`,
    artifactIds: [`artifact-${subjectId.replace(":", "-")}-${counter}`],
    verifierId: "verifier:deterministic",
    verifierVersion: "1.0.0",
    createdAt: T0,
  });
}

function unchanged(): Record<string, string> {
  const current: Record<string, string> = {};
  for (const entry of ledgerEntries) {
    if (entry.kind !== "check_result" && entry.kind !== "observation") continue;
    for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
  }
  return current;
}

function selectCommand(overrides: Partial<SelectNextTaskCommand> = {}): SelectNextTaskCommand {
  return {
    taskId,
    requiredChecks: ["build.check"],
    requiredEvidenceKinds: ["unit_test"],
    riskPolicyIds: [],
    workspaceFingerprint: null,
    currentFingerprints: unchanged(),
    frozenAt: T0,
    ...overrides,
  };
}

beforeEach(() => {
  counter = 0;
  writes = [];
  ledgerEntries = [];
  evidenceRecords = [];
  capsule = capsuleOf();
});

// ===========================================================================
// Manager
// ===========================================================================
describe("the Manager selects, and cannot complete", () => {
  it("selects the first dependency-ready node in the capsule's own order", async () => {
    const selection = await selectNextTask({ capsules, ledger }, selectCommand(), context);
    expect([...selection.readyNodeIds]).toEqual(["node:root", "node:fix"]);
    expect(selection.selectedNodeId).toBe("node:root");
    expect(selection.capsule.fingerprint).toBe(capsule.fingerprint);
  });

  it("respects a blocker, transitively", () => {
    const blocked = capsuleOf({
      dagNodes: [
        { id: "node:root", title: "Investigate", dependsOn: [], blocked: true },
        { id: "node:fix", title: "Fix", dependsOn: ["node:root"] },
        { id: "node:other", title: "Other", dependsOn: [] },
      ],
    });
    expect([...readyDagNodeIds(blocked)]).toEqual(["node:other"]);
  });

  it("is stable: the same durable state selects the same node every time", async () => {
    const first = await selectNextTask({ capsules, ledger }, selectCommand(), context);
    const second = await selectNextTask({ capsules, ledger }, selectCommand(), context);
    expect(second.selectedNodeId).toBe(first.selectedNodeId);
    expect(second.snapshot.contractFingerprint).toBe(first.snapshot.contractFingerprint);
    expect(second.route).toEqual(first.route);
  });

  it("writes nothing at all — selection is a read", async () => {
    await selectNextTask({ capsules, ledger }, selectCommand(), context);
    expect(writes).toEqual([]);
  });

  it("freezes the acceptance contract from the authoritative capsule before any work", async () => {
    const selection = await selectNextTask({ capsules, ledger }, selectCommand(), context);
    expect(selection.snapshot.capsuleFingerprint).toBe(capsule.fingerprint);
    expect(selection.snapshot.objective).toBe(capsule.objective);
    expect([...selection.snapshot.forbiddenChanges]).toEqual(["packages/domain/src/index.ts"]);
  });

  it("prefers the deterministic path and escalates to a model only on a real failure", async () => {
    expect(
      (await selectNextTask({ capsules, ledger }, selectCommand(), context)).route,
    ).toMatchObject({ kind: "deterministic_check", checkName: "build.check" });
    ledgerEntries = [checkResult("build.check", true)];
    expect((await selectNextTask({ capsules, ledger }, selectCommand(), context)).route.kind).toBe(
      "audit",
    );
    ledgerEntries = [checkResult("build.check", false)];
    expect((await selectNextTask({ capsules, ledger }, selectCommand(), context)).route.kind).toBe(
      "model_turn",
    );
  });

  it("refuses a task whose head names a missing revision rather than guessing", async () => {
    const detached: TaskCapsuleRepositoryPort = {
      ...capsules,
      async getRevision() {
        return null;
      },
    };
    await expect(
      selectNextTask({ capsules: detached, ledger }, selectCommand(), context),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });
});

// ===========================================================================
// Auditor
// ===========================================================================
describe("the Auditor judges the frozen contract, and cannot be talked out of it", () => {
  function auditCommand(overrides: Partial<AuditTaskResultCommand> = {}): AuditTaskResultCommand {
    const snapshot = freezeEntryAcceptanceSnapshot({
      capsule,
      requiredChecks: ["build.check"],
      requiredEvidenceKinds: ["unit_test"],
      riskPolicyIds: [],
      workspaceFingerprint: null,
      frozenAt: T0,
    });
    return {
      snapshot,
      expectedContractFingerprint: snapshot.contractFingerprint,
      capsule,
      currentFingerprints: unchanged(),
      changedPaths: [],
      executorOutcome: "ready_for_verification",
      ...overrides,
    };
  }

  function satisfy(): void {
    ledgerEntries = [checkResult("build.check", true)];
    evidenceRecords = [passingEvidence("requirement:one")];
    capsule = capsuleOf({ verifiedEvidenceIds: evidenceRecords.map((record) => record.id) });
  }

  it("accepts only when every required check and criterion is actually backed", async () => {
    satisfy();
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("accepted");
    expect(verdict.contractFingerprint).toBe(auditCommand().snapshot.contractFingerprint);
    expect(writes).toEqual([]);
  });

  it("rejects an Executor finish when a required check never ran", async () => {
    evidenceRecords = [passingEvidence("requirement:one")];
    capsule = capsuleOf({ verifiedEvidenceIds: evidenceRecords.map((record) => record.id) });
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/build\.check/u);
  });

  it("rejects an Executor finish when a required check failed", async () => {
    ledgerEntries = [checkResult("build.check", false)];
    evidenceRecords = [passingEvidence("requirement:one")];
    capsule = capsuleOf({ verifiedEvidenceIds: evidenceRecords.map((record) => record.id) });
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/failed/u);
  });

  it("rejects when an acceptance criterion has no passing evidence", async () => {
    ledgerEntries = [checkResult("build.check", true)];
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/requirement:one/u);
  });

  it("rejects when a required evidence kind is missing even though a criterion is backed", async () => {
    ledgerEntries = [checkResult("build.check", true)];
    evidenceRecords = [passingEvidence("requirement:one", "static_analysis")];
    capsule = capsuleOf({ verifiedEvidenceIds: evidenceRecords.map((record) => record.id) });
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/unit_test/u);
  });

  it("rejects a forbidden change however well verified the rest is", async () => {
    satisfy();
    const verdict = await auditTaskResult(
      { evidence, ledger },
      auditCommand({ changedPaths: ["packages/domain/src/index.ts"] }),
      context,
    );
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/forbidden/iu);
  });

  it("rejects while any effect attempt is unreconciled", async () => {
    satisfy();
    counter += 1;
    ledgerEntries = [
      ...ledgerEntries,
      ExecutionLedgerEntry.create({
        id: `ledger:${counter}`,
        taskId: "task:roles",
        jobId: "job:1",
        recordedAt: T0,
        kind: "effect_attempt",
        detail: "attempting code.patch",
        intentFingerprint: sha256Hex("intent"),
        operationId: "code.patch",
        workspaceId: "workspace-1",
        sandboxId: null,
      }),
    ];
    const verdict = await auditTaskResult({ evidence, ledger }, auditCommand(), context);
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/unreconciled/iu);
  });

  it("rejects an executor that did not declare readiness at all", async () => {
    satisfy();
    for (const executorOutcome of ["deferred", "stopped"] as const) {
      const verdict = await auditTaskResult(
        { evidence, ledger },
        auditCommand({ executorOutcome }),
        context,
      );
      expect(verdict.kind).toBe("rejected");
    }
  });

  it("refuses to audit against a contract that is not the one it was dispatched with", async () => {
    satisfy();
    await expect(
      auditTaskResult(
        { evidence, ledger },
        auditCommand({ expectedContractFingerprint: sha256Hex("other") as ContentHash }),
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("rejects when the task was redefined more weakly after the contract was frozen", async () => {
    satisfy();
    const command = auditCommand();
    // The capsule advanced and quietly dropped a criterion and a prohibition.
    const weakened = capsuleOf({
      acceptanceCriterionIds: [],
      forbiddenChanges: [],
      verifiedEvidenceIds: evidenceRecords.map((record) => record.id),
    });
    const verdict = await auditTaskResult(
      { evidence, ledger },
      { ...command, capsule: weakened },
      context,
    );
    expect(verdict.kind).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/weaken|redefin/iu);
  });

  it("has no channel through which Executor reasoning could reach it", async () => {
    satisfy();
    const command = auditCommand();
    for (const forbidden of ["turns", "transcript", "reasoning", "summary", "executorTurns"]) {
      expect(Object.keys(command)).not.toContain(forbidden);
    }
    expect(JSON.stringify(command)).not.toMatch(/reasoning|thinking/u);
  });
});
