import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  ContentHash,
  JobId,
  ProjectId,
  ResourceBudget,
  SafePath,
  sha256Hex,
  TaskId,
} from "@v31m4/domain";
import {
  ReferenceSandboxBackend,
  SandboxSupervisor,
  type SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteExecutionLedgerRepository } from "../../src/autonomy/autonomy-state-infrastructure.js";
import { type EffectPostState, EffectReconciler } from "../../src/autonomy/effect-reconciler.js";
import { createSemanticAuthorizationBoundary } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * The governed effect lifecycle end to end: authorize through Task 1, record the attempt before
 * dispatch, dispatch through the real sandbox supervisor, observe post-state, and record exactly
 * one outcome. Task 3 composes Task 1 — it does not replace or bypass any of it.
 */
const taskId = TaskId.parse("task:root");
const jobId = JobId.parse("job:1");
const projectId = ProjectId.parse("project:1");
const policy = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const budget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 0,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});

let database: SqliteRuntimeDatabase;
let databasePath: string;
let root: string;
let ledger: SqliteExecutionLedgerRepository;
let reconciler: EffectReconciler;
let sandboxes: SandboxSupervisor;
let boundary: ReturnType<typeof createSemanticAuthorizationBoundary>;
let workspace: WorkspaceHandle;
let sandbox: SandboxHandle;
let entryCounter = 0;

class FixedWorkspaces {
  constructor(private readonly handle: WorkspaceHandle) {}
  async create(): Promise<WorkspaceHandle> {
    throw new Error("unused");
  }
  async get(id: string): Promise<WorkspaceHandle | null> {
    return id === this.handle.id ? this.handle : null;
  }
  async snapshot(): Promise<never> {
    throw new Error("unused");
  }
  async seal(): Promise<WorkspaceHandle> {
    return this.handle;
  }
  async discard(): Promise<void> {}
}

async function wire(db: SqliteRuntimeDatabase): Promise<void> {
  ledger = new SqliteExecutionLedgerRepository(db);
  boundary = createSemanticAuthorizationBoundary();
  const workspaces = new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace));
  sandboxes = new SandboxSupervisor({
    backend: new ReferenceSandboxBackend(),
    workspaces,
    allowedOperations: SEMANTIC_OPERATION_IDS,
    capabilities: boundary.capabilities,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
  });
  sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context);
  reconciler = new EffectReconciler({
    unitOfWork: db.unitOfWork,
    ledger,
    sandboxes,
    generateEntryId: () => `ledger:${++entryCounter}`,
    now: () => "2026-08-26T00:00:00.000Z",
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "v31m4-ledger-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  workspace = Object.freeze({
    id: "workspace-1",
    projectId,
    purpose: "tool_execution" as const,
    rootPath: SafePath.parse("workspace-1"),
    status: "active" as const,
    createdAt: "2026-08-26T00:00:00.000Z",
  });
  entryCounter = 0;
  database = runtimeDatabase();
  databasePath = database.path;
  await wire(database);
});

afterEach(() => {
  database.close();
});

function inspectPlan() {
  return boundary.authorize({
    operationId: "code.inspect",
    role: "executor",
    policyDecision: "allow",
    taskId,
    jobId,
    workspace,
    sandbox,
    parameters: { pathScope: ["target.ts"] },
  });
}

const appliedProbe = async (): Promise<EffectPostState> =>
  Object.freeze({
    kind: "applied" as const,
    facts: [
      {
        resourceKind: "workspace_file",
        locator: "target.ts",
        fingerprint: ContentHash.parse(sha256Hex("after")),
      },
    ],
  });
const notAppliedProbe = async (): Promise<EffectPostState> =>
  Object.freeze({
    kind: "not_applied" as const,
    facts: [
      {
        resourceKind: "workspace_file",
        locator: "target.ts",
        fingerprint: ContentHash.parse(sha256Hex("before")),
      },
    ],
  });
const unknownProbe = async (): Promise<EffectPostState> =>
  Object.freeze({ kind: "unknown" as const, reason: "the post-state could not be read" });

describe("effect lifecycle ordering", () => {
  it("records the attempt before dispatch and exactly one outcome after", async () => {
    const plan = inspectPlan();
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan, probe: appliedProbe },
      context,
    );
    expect(outcome.outcomeKind).toBe("effect_confirmation");

    const page = await ledger.listForTask(taskId, { limit: 100 }, context);
    expect(page.items.map((entry) => entry.kind)).toEqual([
      "effect_attempt",
      "effect_confirmation",
    ]);
    // The attempt is recorded first, which is what makes a crash mid-effect detectable.
    expect(page.items[0]?.id).toBe(outcome.attemptEntryId);
  });

  it("records the attempt even when the dispatch itself fails", async () => {
    // A plan the sandbox will refuse: it was issued by a different boundary.
    const foreign = createSemanticAuthorizationBoundary().authorize({
      operationId: "code.inspect",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { pathScope: ["target.ts"] },
    });
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: foreign, probe: notAppliedProbe },
      context,
    );
    // The dispatch was refused and the probe proved nothing happened.
    expect(outcome.outcomeKind).toBe("effect_nonapplication");
    const page = await ledger.listForTask(taskId, { limit: 100 }, context);
    expect(page.items.map((entry) => entry.kind)).toEqual([
      "effect_attempt",
      "effect_nonapplication",
    ]);
  });

  it("never records a confirmation the probe did not verify", async () => {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
      context,
    );
    expect(outcome.outcomeKind).toBe("reconciliation_indeterminate");
  });

  it("treats a probe that throws as unknown rather than as failure", async () => {
    const outcome = await reconciler.runGovernedEffect(
      {
        taskId,
        sandbox,
        plan: inspectPlan(),
        probe: async () => {
          throw new Error("the workspace could not be read");
        },
      },
      context,
    );
    expect(outcome.outcomeKind).toBe("reconciliation_indeterminate");
  });
});

describe("ambiguous effects block retry", () => {
  it("refuses the same intent after an indeterminate outcome", async () => {
    await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
      context,
    );
    // A fresh capability for the same semantic intent must still be refused.
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const page = await ledger.listForTask(taskId, { limit: 100 }, context);
    // No second attempt was recorded, because none was made.
    expect(page.items.filter((entry) => entry.kind === "effect_attempt")).toHaveLength(1);
  });

  it("refuses the same intent after a confirmed application", async () => {
    await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("permits the same intent after a verified non-application", async () => {
    await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: notAppliedProbe },
      context,
    );
    const second = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    expect(second.outcomeKind).toBe("effect_confirmation");
  });

  it("gives the same intent the same fingerprint across separate capabilities", async () => {
    expect(reconciler.intentFingerprintFor(inspectPlan())).toBe(
      reconciler.intentFingerprintFor(inspectPlan()),
    );
  });
});

describe("append-only history", () => {
  it("refuses to rewrite an existing entry", async () => {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    const stored = await ledger.getById(outcome.attemptEntryId as never, context);
    expect(stored).not.toBeNull();
    await expect(
      database.unitOfWork.execute(context, async (transaction) =>
        ledger.append(stored as never, context, transaction),
      ),
    ).rejects.toBeInstanceOf(ApplicationError);
  });

  it("refuses a second finalized outcome for one attempt", async () => {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    const { ExecutionLedgerEntry } = await import("@v31m4/domain");
    const { appendExecutionLedgerEntry } = await import("@v31m4/application");
    const contradiction = ExecutionLedgerEntry.create({
      id: "ledger:contradiction",
      taskId,
      jobId,
      recordedAt: "2026-08-26T00:00:02.000Z",
      detail: "a contradictory second outcome",
      kind: "effect_nonapplication",
      attemptEntryId: outcome.attemptEntryId,
      facts: [
        {
          resourceKind: "workspace_file",
          locator: "target.ts",
          fingerprint: ContentHash.parse(sha256Hex("before")),
        },
      ],
    });
    await expect(
      appendExecutionLedgerEntry(
        { unitOfWork: database.unitOfWork, ledger },
        contradiction,
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The history remains foldable, because the contradiction was never written.
    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("confirmed");
  });

  it("refuses an outcome that names no real attempt", async () => {
    const { ExecutionLedgerEntry } = await import("@v31m4/domain");
    const orphan = ExecutionLedgerEntry.create({
      id: "ledger:orphan",
      taskId,
      jobId,
      recordedAt: "2026-08-26T00:00:00.000Z",
      detail: "an outcome with no attempt",
      kind: "effect_confirmation",
      attemptEntryId: "ledger:missing",
      facts: [
        {
          resourceKind: "workspace_file",
          locator: "target.ts",
          fingerprint: ContentHash.parse(sha256Hex("x")),
        },
      ],
    });
    const { appendExecutionLedgerEntry } = await import("@v31m4/application");
    await expect(
      appendExecutionLedgerEntry({ unitOfWork: database.unitOfWork, ledger }, orphan, context),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("refuses a stored entry whose body no longer matches its fingerprint", async () => {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    const row = database.connection
      .prepare("SELECT body FROM records WHERE record_type = ? AND record_id = ?")
      .get("execution_ledger_entry", outcome.attemptEntryId) as { body: string };
    database.connection
      .prepare("UPDATE records SET body = ? WHERE record_type = ? AND record_id = ?")
      .run(
        JSON.stringify({ ...JSON.parse(row.body), detail: "rewritten history" }),
        "execution_ledger_entry",
        outcome.attemptEntryId,
      );
    await expect(ledger.getById(outcome.attemptEntryId as never, context)).rejects.toThrow(
      /fingerprint/iu,
    );
  });
});

describe("restart recovery", () => {
  it("keeps an unresolved attempt unresolved across a brand-new database instance", async () => {
    // Simulate a crash after the attempt was recorded but before any outcome: append the attempt
    // through the reconciler's own path, then drop the outcome by closing mid-flight.
    const plan = inspectPlan();
    const intent = reconciler.intentFingerprintFor(plan);
    const { ExecutionLedgerEntry } = await import("@v31m4/domain");
    const { appendExecutionLedgerEntry } = await import("@v31m4/application");
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id: "ledger:crashed",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "attempting code.inspect",
        kind: "effect_attempt",
        intentFingerprint: intent,
        operationId: plan.operationId,
        workspaceId: plan.workspaceId,
        sandboxId: plan.sandboxId,
      }),
      context,
    );
    database.close();

    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts).toHaveLength(1);
    expect(projection.attempts[0]?.outcome).toBe("unresolved");
    // And the same intent is still blocked after the restart.
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps a resolved attempt resolved across a restart", async () => {
    await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: notAppliedProbe },
      context,
    );
    database.close();

    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("not_applied");
    // A verified non-application still permits another try after the restart.
    const second = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    expect(second.outcomeKind).toBe("effect_confirmation");
  });
});
