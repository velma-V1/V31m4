import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  appendExecutionLedgerEntry,
  decideRetry,
  isEntryStillValid,
  projectLedger,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type SandboxPort,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  ContentHash,
  ExecutionLedgerEntry,
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
import {
  type EffectPostState,
  type EffectPostStateProbe,
  EffectReconciler,
} from "../../src/autonomy/effect-reconciler.js";
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
let dispatches = 0;

/**
 * Counts what actually reached the sandbox. Several invariants here are about *dispatch*
 * multiplicity, which the ledger alone cannot prove — a second attempt that never ran and a
 * second attempt that ran twice leave different marks in the environment, not in the record.
 */
function countingSandboxes(inner: SandboxSupervisor): SandboxPort {
  return {
    prepare: (...args) => inner.prepare(...args),
    execute: (...args) => {
      dispatches += 1;
      return inner.execute(...args);
    },
    inspect: (...args) => inner.inspect(...args),
    cancel: (...args) => inner.cancel(...args),
    destroy: (...args) => inner.destroy(...args),
  };
}

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
    sandboxes: countingSandboxes(sandboxes),
    // The same Task 1 boundary the sandbox was paired with — not a second authority.
    capabilities: boundary.capabilities,
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
  dispatches = 0;
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
    // A dispatch the sandbox will refuse, with the issuer beyond doubt: the capability is
    // canonical but has already been spent at the sink, so the replay is denied there. A foreign
    // capability could not be used to make this point — it never reaches a ledger write at all.
    const plan = inspectPlan();
    await sandboxes.execute(sandbox, plan, context);
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan, probe: notAppliedProbe },
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

/**
 * A ledger reference is an authoritative edge, and `getById` is a global lookup by identifier. If
 * an edge could cross a task or job boundary, another job's outcome could finalize this job's
 * attempt, or a check could rest on history this task never produced.
 */
/**
 * An attempt moves along one canonical state machine, and the append path enforces it. Two
 * properties matter most: no sequence it accepts may leave the history unreplayable, and an
 * attempt that is merely unproven must stay reconcilable rather than being trapped for good.
 */
describe("attempt outcome transitions at the append boundary", () => {
  const facts = [
    {
      resourceKind: "workspace_file",
      locator: "target.ts",
      fingerprint: ContentHash.parse(sha256Hex("after")),
    },
  ];
  const ATTEMPT = "ledger:state-attempt";
  let sequence = 0;

  function deps() {
    return { unitOfWork: database.unitOfWork, ledger };
  }

  async function seedAttempt(): Promise<void> {
    sequence = 0;
    await appendExecutionLedgerEntry(
      deps(),
      ExecutionLedgerEntry.create({
        id: ATTEMPT,
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "attempting code.inspect",
        kind: "effect_attempt",
        intentFingerprint: ContentHash.parse(sha256Hex("a state intent")),
        operationId: "code.inspect",
        workspaceId: workspace.id,
        sandboxId: sandbox.id,
      }),
      context,
    );
  }

  /** Appends the entry that asserts `outcome` for the seeded attempt. */
  function record(outcome: "failed" | "indeterminate" | "confirmed" | "not_applied") {
    sequence += 1;
    const kind =
      outcome === "failed"
        ? "failure"
        : outcome === "confirmed"
          ? "effect_confirmation"
          : outcome === "not_applied"
            ? "effect_nonapplication"
            : "reconciliation_indeterminate";
    return appendExecutionLedgerEntry(
      deps(),
      ExecutionLedgerEntry.create({
        id: `ledger:state-${outcome}-${sequence}`,
        taskId,
        jobId,
        recordedAt: `2026-08-26T00:00:0${sequence}.000Z`,
        detail: `recording ${outcome}`,
        kind,
        attemptEntryId: ATTEMPT,
        ...(outcome === "failed"
          ? { reason: "the process died" }
          : { facts: outcome === "indeterminate" ? [] : facts }),
      }),
      context,
    );
  }

  async function outcomeOf(): Promise<string | undefined> {
    return (await reconciler.projection(taskId, context)).attempts.find(
      (candidate) => candidate.attemptEntryId === ATTEMPT,
    )?.outcome;
  }

  it("settles a failed attempt once reality is observed, either way", async () => {
    for (const settled of ["confirmed", "not_applied"] as const) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      await record("failed");
      expect(await outcomeOf(), settled).toBe("failed");
      await record(settled);
      expect(await outcomeOf(), settled).toBe(settled);
    }
  });

  it("settles an indeterminate attempt once reality is observed, either way", async () => {
    for (const settled of ["confirmed", "not_applied"] as const) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      await record("indeterminate");
      expect(await outcomeOf(), settled).toBe("indeterminate");
      await record(settled);
      expect(await outcomeOf(), settled).toBe(settled);
    }
  });

  it("lets a failed attempt become indeterminate, but never the reverse", async () => {
    await seedAttempt();
    await record("failed");
    await record("indeterminate");
    expect(await outcomeOf()).toBe("indeterminate");
    await expect(record("failed")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses every outcome once an attempt is confirmed", async () => {
    for (const later of ["failed", "indeterminate", "not_applied"] as const) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      await record("confirmed");
      await expect(record(later), later).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await outcomeOf(), later).toBe("confirmed");
    }
  });

  it("refuses every outcome once an attempt is a verified non-application", async () => {
    for (const later of ["confirmed", "failed", "indeterminate"] as const) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      await record("not_applied");
      await expect(record(later), later).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await outcomeOf(), later).toBe("not_applied");
    }
  });

  it("refuses a repeated status, so no-progress spam cannot manufacture history", async () => {
    for (const repeated of ["failed", "indeterminate"] as const) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      await record(repeated);
      await expect(record(repeated), repeated).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await outcomeOf(), repeated).toBe(repeated);
    }
  });

  it("keeps history replayable after every sequence the append path accepts", async () => {
    // The defect this replaces: `failure` was not counted as a resolution at append time, so
    // failure-then-confirmation was accepted and every later fold of that task threw.
    const paths: readonly (readonly (
      | "failed"
      | "indeterminate"
      | "confirmed"
      | "not_applied"
    )[])[] = [
      ["failed", "confirmed"],
      ["failed", "not_applied"],
      ["failed", "indeterminate", "confirmed"],
      ["failed", "indeterminate", "not_applied"],
      ["indeterminate", "confirmed"],
      ["indeterminate", "not_applied"],
      ["confirmed"],
      ["not_applied"],
    ];
    for (const path of paths) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedAttempt();
      for (const step of path) await record(step);
      // Folds cleanly, and ends exactly where the path said.
      expect(await outcomeOf(), path.join(" -> ")).toBe(path[path.length - 1]);
    }
  });

  it("still keeps a failed attempt blocking until it is settled", async () => {
    await seedAttempt();
    await record("failed");
    const projection = await reconciler.projection(taskId, context);
    expect(decideRetry(projection, ContentHash.parse(sha256Hex("a state intent"))).allowed).toBe(
      false,
    );
    await record("not_applied");
    // Only a verified non-application opens the way to a genuinely new attempt.
    expect(
      decideRetry(
        await reconciler.projection(taskId, context),
        ContentHash.parse(sha256Hex("a state intent")),
      ).allowed,
    ).toBe(true);
  });
});

/**
 * The way out of an unsettled attempt. It reads reality and writes what reality proves — it never
 * runs the effect again, because the effect may already have landed.
 */
describe("reconciling an attempt without re-dispatching", () => {
  async function attemptOnce(
    probe: EffectPostStateProbe,
  ): Promise<{ readonly attemptEntryId: string; readonly plan: ReturnType<typeof inspectPlan> }> {
    const plan = inspectPlan();
    const outcome = await reconciler.runGovernedEffect({ taskId, sandbox, plan, probe }, context);
    return { attemptEntryId: outcome.attemptEntryId, plan };
  }

  function reconcile(attemptEntryId: string, probe: EffectPostStateProbe) {
    // A fresh capability for the same intent: reconciliation is about the recorded attempt, not
    // about spending an authorization to run anything.
    return reconciler.reconcileAttempt(
      { taskId, sandbox, plan: inspectPlan(), attemptEntryId, probe },
      context,
    );
  }

  it("settles an indeterminate attempt as confirmed, dispatching nothing", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    expect(dispatches).toBe(1);

    const settled = await reconcile(attemptEntryId, appliedProbe);
    expect(settled.outcome).toBe("confirmed");
    expect(settled.outcomeKind).toBe("effect_confirmation");
    // The whole point: reconciliation observed, it did not re-run.
    expect(dispatches).toBe(1);
    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("confirmed");
  });

  it("settles an indeterminate attempt as a verified non-application, then permits a new try", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    const settled = await reconcile(attemptEntryId, notAppliedProbe);
    expect(settled.outcome).toBe("not_applied");
    expect(dispatches).toBe(1);

    // Proof it never landed is what clears the way for a genuinely new attempt.
    const retried = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
      context,
    );
    expect(retried.outcomeKind).toBe("effect_confirmation");
    expect(retried.attemptEntryId).not.toBe(attemptEntryId);
    expect(dispatches).toBe(2);
  });

  it("settles a failed attempt from observed reality", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    // Record a failure over the indeterminate attempt is forbidden, so seed the failed state on a
    // second attempt instead: prove the same intent after a verified non-application.
    await reconcile(attemptEntryId, notAppliedProbe);
    const second = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
      context,
    );
    const settled = await reconcile(second.attemptEntryId, appliedProbe);
    expect(settled.outcome).toBe("confirmed");
    expect(dispatches).toBe(2);
  });

  it("writes nothing when reality is still unprovable and the attempt already says so", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    const before = await ledger.listForTask(taskId, { limit: 500 }, context);

    const again = await reconcile(attemptEntryId, unknownProbe);
    expect(again.outcomeEntryId).toBeNull();
    expect(again.outcomeKind).toBeNull();
    expect(again.outcome).toBe("indeterminate");
    expect(again.reason).toMatch(/could not be read/u);

    // No no-progress entry was appended, and the intent is still blocked.
    const after = await ledger.listForTask(taskId, { limit: 500 }, context);
    expect(after.items).toHaveLength(before.items.length);
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to reconcile an attempt that has already settled", async () => {
    const { attemptEntryId } = await attemptOnce(appliedProbe);
    await expect(reconcile(attemptEntryId, notAppliedProbe)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dispatches).toBe(1);
  });

  it("refuses an attempt that does not exist, or one describing a different effect", async () => {
    await expect(reconcile("ledger:nowhere", appliedProbe)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const { attemptEntryId } = await attemptOnce(unknownProbe);
    const otherPlan = boundary.authorize({
      operationId: "code.inspect",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      // A different path scope is a different intent.
      parameters: { pathScope: ["other.ts"] },
    });
    await expect(
      reconciler.reconcileAttempt(
        { taskId, sandbox, plan: otherPlan, attemptEntryId, probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("refuses a reconciliation whose scoped identity disagrees, writing nothing", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    const before = await ledger.listForTask(taskId, { limit: 500 }, context);
    await expect(
      reconciler.reconcileAttempt(
        {
          taskId: TaskId.parse("task:other"),
          sandbox,
          plan: inspectPlan(),
          attemptEntryId,
          probe: appliedProbe,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const after = await ledger.listForTask(taskId, { limit: 500 }, context);
    expect(after.items).toHaveLength(before.items.length);
    expect(dispatches).toBe(1);
  });

  it("lets exactly one of two concurrent terminal reconciliations win", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    const outcomes = await Promise.allSettled([
      reconcile(attemptEntryId, appliedProbe),
      reconcile(attemptEntryId, notAppliedProbe),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find(
      (outcome) => outcome.status === "rejected",
    ) as PromiseRejectedResult;
    expect((loser.reason as ApplicationError).code).toBe("CONFLICT");

    // Exactly one terminal outcome exists, and the history still folds.
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    const terminals = page.items.filter(
      (item) => item.kind === "effect_confirmation" || item.kind === "effect_nonapplication",
    );
    expect(terminals).toHaveLength(1);
    const projection = await reconciler.projection(taskId, context);
    expect(["confirmed", "not_applied"]).toContain(projection.attempts[0]?.outcome);
    expect(dispatches).toBe(1);
  });

  it("keeps an indeterminate attempt reconcilable across a restart", async () => {
    const { attemptEntryId } = await attemptOnce(unknownProbe);
    database.close();

    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    // Still blocking after the restart...
    const recovered = await reconciler.projection(taskId, context);
    expect(recovered.attempts[0]?.outcome).toBe("indeterminate");
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // ...and still settleable, which is exactly what a permanent trap would not be.
    const dispatchesBefore = dispatches;
    const settled = await reconcile(attemptEntryId, appliedProbe);
    expect(settled.outcome).toBe("confirmed");
    expect(dispatches).toBe(dispatchesBefore);
  });
});

describe("references may not cross scope", () => {
  const facts = [
    {
      resourceKind: "workspace_file",
      locator: "target.ts",
      fingerprint: ContentHash.parse(sha256Hex("after")),
    },
  ];

  async function seedAttempt(): Promise<void> {
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id: "ledger:scoped-attempt",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "attempting code.inspect",
        kind: "effect_attempt",
        intentFingerprint: ContentHash.parse(sha256Hex("a scoped intent")),
        operationId: "code.inspect",
        workspaceId: workspace.id,
        sandboxId: sandbox.id,
      }),
      context,
    );
  }

  async function seedObservation(overrides: Record<string, unknown>): Promise<void> {
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id: "ledger:scoped-observation",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "read target.ts",
        kind: "observation",
        facts,
        ...overrides,
      }),
      context,
    );
  }

  function appended(entry: Parameters<typeof appendExecutionLedgerEntry>[1]) {
    return appendExecutionLedgerEntry({ unitOfWork: database.unitOfWork, ledger }, entry, context);
  }

  it("refuses a same-task wrong-job outcome for an attempt", async () => {
    await seedAttempt();
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:wrong-job-outcome",
          taskId,
          jobId: JobId.parse("job:other"),
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "an outcome recorded under a different job",
          kind: "effect_confirmation",
          attemptEntryId: "ledger:scoped-attempt",
          facts,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    // The attempt is still unresolved, so the intent stays blocked rather than looking finished.
    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("unresolved");
  });

  it("refuses a same-task wrong-job failure for an attempt", async () => {
    await seedAttempt();
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:wrong-job-failure",
          taskId,
          jobId: JobId.parse("job:other"),
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "a failure recorded under a different job",
          kind: "failure",
          attemptEntryId: "ledger:scoped-attempt",
          reason: "the process died",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect((await reconciler.projection(taskId, context)).attempts[0]?.outcome).toBe("unresolved");
  });

  it("refuses a wrong-task failure for an attempt", async () => {
    await seedAttempt();
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:wrong-task-failure",
          taskId: TaskId.parse("task:other"),
          jobId,
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "a failure recorded under a different task",
          kind: "failure",
          attemptEntryId: "ledger:scoped-attempt",
          reason: "the process died",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("refuses a check that depends on another task's or job's entry", async () => {
    for (const [index, foreign] of [
      { taskId: TaskId.parse("task:other") },
      { jobId: JobId.parse("job:other") },
    ].entries()) {
      database.close();
      database = runtimeDatabase();
      await wire(database);
      await seedObservation(foreign);
      await expect(
        appended(
          ExecutionLedgerEntry.create({
            id: `ledger:foreign-check-${index}`,
            taskId,
            jobId,
            recordedAt: "2026-08-26T00:00:01.000Z",
            detail: "targeted tests passed",
            kind: "check_result",
            checkName: "targeted tests",
            passed: true,
            facts,
            dependsOnEntryIds: ["ledger:scoped-observation"],
          }),
        ),
        JSON.stringify(foreign),
      ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    }
  });

  it("refuses an invalidation that reaches into another task's history", async () => {
    await seedObservation({ taskId: TaskId.parse("task:other") });
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:cross-invalidation",
          taskId,
          jobId,
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "invalidating something this task does not own",
          kind: "invalidation",
          invalidatesEntryIds: ["ledger:scoped-observation"],
          reason: "not mine to supersede",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("refuses a check that depends on an entry which carries no facts", async () => {
    await seedAttempt();
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:check-on-attempt",
          taskId,
          jobId,
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "targeted tests passed",
          kind: "check_result",
          checkName: "targeted tests",
          passed: true,
          facts,
          dependsOnEntryIds: ["ledger:scoped-attempt"],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("refuses an invalidation aimed at an effect attempt", async () => {
    // An attempt that may have changed the world is resolved by an observed outcome, never
    // annulled. Accepting this shape would put a retry-unblocking move within reach of a caller.
    await seedAttempt();
    await expect(
      appended(
        ExecutionLedgerEntry.create({
          id: "ledger:invalidate-attempt",
          taskId,
          jobId,
          recordedAt: "2026-08-26T00:00:01.000Z",
          detail: "trying to annul an attempt",
          kind: "invalidation",
          invalidatesEntryIds: ["ledger:scoped-attempt"],
          reason: "wishing it away",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("keeps a blocked intent blocked even if such an invalidation were in the history", async () => {
    // Defence in depth: the append path refuses the entry above, and the fold ignores it anyway —
    // `decideRetry` reads attempt outcomes, never the invalidated set.
    await seedAttempt();
    const projection = projectLedger([
      ExecutionLedgerEntry.create({
        id: "ledger:scoped-attempt",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "attempting code.inspect",
        kind: "effect_attempt",
        intentFingerprint: ContentHash.parse(sha256Hex("a scoped intent")),
        operationId: "code.inspect",
        workspaceId: workspace.id,
        sandboxId: sandbox.id,
      }),
      ExecutionLedgerEntry.create({
        id: "ledger:forged-invalidation",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:01.000Z",
        detail: "a forged annulment",
        kind: "invalidation",
        invalidatesEntryIds: ["ledger:scoped-attempt"],
        reason: "wishing it away",
      }),
    ]);
    expect(decideRetry(projection, ContentHash.parse(sha256Hex("a scoped intent"))).allowed).toBe(
      false,
    );
  });

  it("accepts a check that depends on its own task and job's observation", async () => {
    await seedObservation({});
    const stored = await appended(
      ExecutionLedgerEntry.create({
        id: "ledger:in-scope-check",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:01.000Z",
        detail: "targeted tests passed",
        kind: "check_result",
        checkName: "targeted tests",
        passed: true,
        facts,
        dependsOnEntryIds: ["ledger:scoped-observation"],
      }),
    );
    expect(stored.value.id).toBe("ledger:in-scope-check");
  });
});

/**
 * Claiming an intent is atomic. Checking the history and appending the attempt used to be two
 * steps, so two callers could both look, both see nothing blocking, and both go ahead.
 */
describe("same-intent claiming is atomic", () => {
  it("lets exactly one of two concurrent identical intents claim and dispatch", async () => {
    const outcomes = await Promise.allSettled([
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find(
      (outcome) => outcome.status === "rejected",
    ) as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ApplicationError);
    expect((loser.reason as ApplicationError).code).toBe("CONFLICT");

    // Exactly one attempt was committed, and exactly one effect reached the environment.
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    expect(page.items.filter((entry) => entry.kind === "effect_attempt")).toHaveLength(1);
    expect(dispatches).toBe(1);
  });

  it("keeps the winning claim across a restart, and still refuses the loser's intent", async () => {
    const outcomes = await Promise.allSettled([
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
        context,
      ),
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
        context,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    database.close();

    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts).toHaveLength(1);
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/**
 * A governed effect is checked, recorded, and executed under one scoped identity. A request that
 * names a different task than the authorization and the sandbox would let a Task-A effect be
 * projected against, and written into, Task-B's ledger.
 */
describe("scoped identity must agree", () => {
  const otherTask = TaskId.parse("task:other");

  it("refuses a request whose taskId disagrees with the plan and sandbox", async () => {
    await expect(
      reconciler.runGovernedEffect(
        { taskId: otherTask, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Neither ledger gained an entry, and nothing was dispatched.
    expect((await ledger.listForTask(otherTask, { limit: 500 }, context)).items).toHaveLength(0);
    expect((await ledger.listForTask(taskId, { limit: 500 }, context)).items).toHaveLength(0);
    expect(dispatches).toBe(0);
  });

  it("refuses a plan bound to a different sandbox, workspace, job, or task", async () => {
    const foreignSandbox: SandboxHandle = Object.freeze({
      id: "sandbox:2" as SandboxHandle["id"],
      jobId,
      taskId,
      workspaceId: workspace.id,
      backendId: "reference",
      status: "ready" as const,
    });
    const mismatches: readonly SandboxHandle[] = [
      foreignSandbox,
      Object.freeze({ ...sandbox, workspaceId: "workspace-2" }),
      Object.freeze({ ...sandbox, jobId: JobId.parse("job:2") }),
      Object.freeze({ ...sandbox, taskId: otherTask }),
    ];
    for (const candidate of mismatches) {
      await expect(
        reconciler.runGovernedEffect(
          {
            taskId: candidate.taskId,
            sandbox: candidate,
            plan: inspectPlan(),
            probe: appliedProbe,
          },
          context,
        ),
        candidate.id,
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    expect((await ledger.listForTask(taskId, { limit: 500 }, context)).items).toHaveLength(0);
    expect(dispatches).toBe(0);
  });

  it("refuses a mismatched identity even when two such calls race", async () => {
    const outcomes = await Promise.allSettled([
      reconciler.runGovernedEffect(
        { taskId: otherTask, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
      reconciler.runGovernedEffect(
        { taskId: otherTask, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect(dispatches).toBe(0);
  });
});

/**
 * Long-horizon correctness: no authoritative decision may be made against a truncated first page
 * of history. Each of these places the decisive entry past the 500-entry page boundary.
 */
describe("decisions read the whole ledger", () => {
  const LONG_HISTORY = 500;

  async function fillHistory(count: number): Promise<void> {
    await database.unitOfWork.execute(context, async (transaction) => {
      for (let index = 0; index < count; index += 1) {
        await ledger.append(
          ExecutionLedgerEntry.create({
            id: `ledger:filler-${index}`,
            taskId,
            jobId,
            recordedAt: "2026-08-26T00:00:00.000Z",
            detail: `filler observation ${index}`,
            kind: "observation",
            facts: [
              {
                resourceKind: "workspace_file",
                locator: `filler-${index}.ts`,
                fingerprint: ContentHash.parse(sha256Hex(`filler-${index}`)),
              },
            ],
          }),
          context,
          transaction,
        );
      }
    });
  }

  const verifiedFacts = [
    {
      resourceKind: "workspace_file",
      locator: "target.ts",
      fingerprint: ContentHash.parse(sha256Hex("after")),
    },
  ];

  async function recordAttempt(id: string, intentFingerprint: string): Promise<void> {
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id,
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "attempting code.inspect",
        kind: "effect_attempt",
        intentFingerprint,
        operationId: "code.inspect",
        workspaceId: workspace.id,
        sandboxId: sandbox.id,
      }),
      context,
    );
  }

  it("still blocks on an unresolved attempt recorded past the first page", async () => {
    await fillHistory(LONG_HISTORY);
    await recordAttempt("ledger:blocking", reconciler.intentFingerprintFor(inspectPlan()));

    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dispatches).toBe(0);
  });

  it("still blocks on a confirmed attempt recorded past the first page", async () => {
    await fillHistory(LONG_HISTORY);
    await recordAttempt("ledger:confirmed", reconciler.intentFingerprintFor(inspectPlan()));
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id: "ledger:confirmed-outcome",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:01.000Z",
        detail: "code.inspect verified as applied",
        kind: "effect_confirmation",
        attemptEntryId: "ledger:confirmed",
        facts: verifiedFacts,
      }),
      context,
    );

    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { code: "ALREADY_APPLIED" } });
    expect(dispatches).toBe(0);
  });

  it("refuses a contradictory outcome when the existing one is past the first page", async () => {
    await fillHistory(LONG_HISTORY);
    await recordAttempt("ledger:late", ContentHash.parse(sha256Hex("a late intent")));
    const deps = { unitOfWork: database.unitOfWork, ledger };
    await appendExecutionLedgerEntry(
      deps,
      ExecutionLedgerEntry.create({
        id: "ledger:late-confirmation",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:01.000Z",
        detail: "code.inspect verified as applied",
        kind: "effect_confirmation",
        attemptEntryId: "ledger:late",
        facts: verifiedFacts,
      }),
      context,
    );

    await expect(
      appendExecutionLedgerEntry(
        deps,
        ExecutionLedgerEntry.create({
          id: "ledger:late-contradiction",
          taskId,
          jobId,
          recordedAt: "2026-08-26T00:00:02.000Z",
          detail: "code.inspect verified as not_applied",
          kind: "effect_nonapplication",
          attemptEntryId: "ledger:late",
          facts: verifiedFacts,
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // History stays foldable, because the contradiction was never written.
    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("confirmed");
  });

  it("folds a multi-page history into the same deterministic projection", async () => {
    await fillHistory(LONG_HISTORY + 250);
    await recordAttempt("ledger:paged", ContentHash.parse(sha256Hex("a paged intent")));

    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    expect(page.items).toHaveLength(500);
    expect(page.nextCursor).toBe("500");
    expect(page.total).toBe(LONG_HISTORY + 251);

    const first = await reconciler.projection(taskId, context);
    const second = await reconciler.projection(taskId, context);
    expect(first).toEqual(second);
    expect(first.attempts).toHaveLength(1);
    expect(first.attempts[0]?.attemptEntryId).toBe("ledger:paged");
  });

  it("resolves a check's dependency across the page boundary and survives a restart", async () => {
    // The observation sits on page one and the check that depends on it past the boundary, so a
    // truncated read would lose the edge rather than the entry.
    const deps = { unitOfWork: database.unitOfWork, ledger };
    const sourceFact = {
      resourceKind: "workspace_file",
      locator: "target.ts",
      fingerprint: ContentHash.parse(sha256Hex("source-before")),
    };
    const reportFact = {
      resourceKind: "report",
      locator: "reports/targeted-tests.json",
      fingerprint: ContentHash.parse(sha256Hex("report-stable")),
    };
    await appendExecutionLedgerEntry(
      deps,
      ExecutionLedgerEntry.create({
        id: "ledger:paged-observation",
        taskId,
        jobId,
        recordedAt: "2026-08-26T00:00:00.000Z",
        detail: "read target.ts",
        kind: "observation",
        facts: [sourceFact],
      }),
      context,
    );
    await fillHistory(LONG_HISTORY);
    const check = ExecutionLedgerEntry.create({
      id: "ledger:paged-check",
      taskId,
      jobId,
      recordedAt: "2026-08-26T00:00:02.000Z",
      detail: "targeted tests passed",
      kind: "check_result",
      checkName: "targeted tests",
      passed: true,
      facts: [reportFact],
      dependsOnEntryIds: ["ledger:paged-observation"],
    });
    await appendExecutionLedgerEntry(deps, check, context);

    const current = {
      "target.ts": sourceFact.fingerprint,
      "reports/targeted-tests.json": reportFact.fingerprint,
    };
    expect(isEntryStillValid(await reconciler.projection(taskId, context), check, current)).toBe(
      true,
    );
    // The premise goes stale while the check's own report does not move at all.
    expect(
      isEntryStillValid(await reconciler.projection(taskId, context), check, {
        ...current,
        "target.ts": ContentHash.parse(sha256Hex("source-after")),
      }),
    ).toBe(false);

    database.close();
    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const recovered = await reconciler.projection(taskId, context);
    expect(isEntryStillValid(recovered, check, current)).toBe(true);
    expect(
      isEntryStillValid(recovered, check, {
        ...current,
        "target.ts": ContentHash.parse(sha256Hex("source-after")),
      }),
    ).toBe(false);
  });

  it("finds and settles an attempt whose state lives past the page boundary", async () => {
    // The attempt and its indeterminate record sit before 500 filler entries, so both the
    // reconciliation pre-check and the append-time transition check must read the whole history.
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
      context,
    );
    await fillHistory(LONG_HISTORY);
    expect((await ledger.listForTask(taskId, { limit: 500 }, context)).nextCursor).toBe("500");

    const settled = await reconciler.reconcileAttempt(
      {
        taskId,
        sandbox,
        plan: inspectPlan(),
        attemptEntryId: outcome.attemptEntryId,
        probe: appliedProbe,
      },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(dispatches).toBe(1);
    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("confirmed");
  });

  it("keeps a >500-entry history blocking under two concurrent identical intents", async () => {
    await fillHistory(LONG_HISTORY);
    await recordAttempt("ledger:blocking", reconciler.intentFingerprintFor(inspectPlan()));

    const outcomes = await Promise.allSettled([
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect(dispatches).toBe(0);
  });
});

describe("restart recovery", () => {
  it("keeps an unresolved attempt unresolved across a brand-new database instance", async () => {
    // Simulate a crash after the attempt was recorded but before any outcome: append the attempt
    // through the reconciler's own path, then drop the outcome by closing mid-flight.
    const plan = inspectPlan();
    const intent = reconciler.intentFingerprintFor(plan);
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

  it("keeps a dispatched-but-unresolved effect blocked after a restart", async () => {
    // A crash between dispatch and the outcome append: the effect really did reach the sandbox,
    // and nothing recorded whether it landed. The durable claim is what must stop a blind retry.
    const plan = inspectPlan();
    const intent = reconciler.intentFingerprintFor(plan);
    await appendExecutionLedgerEntry(
      { unitOfWork: database.unitOfWork, ledger },
      ExecutionLedgerEntry.create({
        id: "ledger:claimed",
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
    await sandboxes.execute(sandbox, plan, context);
    database.close();

    const { SqliteRuntimeDatabase } = await import("@v31m4/infrastructure");
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.outcome).toBe("unresolved");
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: inspectPlan(), probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dispatches).toBe(0);
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

/**
 * T3-7. The Execution Ledger is authoritative history, so nothing may write to it — or probe on
 * a capability's behalf — before that capability is proved to have come from the canonical Task 1
 * authority. Verifying only at the sandbox sink is too late on the effect path (the attempt is
 * already durable) and never happens at all on the reconciliation path, which dispatches nothing.
 */
describe("authoritative ledger state requires the canonical Task 1 issuer", () => {
  /** An otherwise identical capability from a different semantic authorization boundary. */
  function foreignPlan(): ReturnType<typeof inspectPlan> {
    return createSemanticAuthorizationBoundary().authorize({
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

  /**
   * Structurally identical, but not the object the authority minted. The class has no private
   * runtime field to copy, so this is assignable — which is precisely why verification is
   * issuer-bound rather than a shape or `instanceof` check.
   */
  function clonedPlan(): ReturnType<typeof inspectPlan> {
    return { ...inspectPlan() } as ReturnType<typeof inspectPlan>;
  }

  /**
   * The strongest structural forgery: an object whose prototype chain runs through a real minted
   * plan, so `instanceof AuthorizedSemanticExecutionPlan` is true and every field reads through.
   * Only identity in the authority's own registry separates it from the real thing.
   */
  function prototypeForgedPlan(): ReturnType<typeof inspectPlan> {
    return Object.create(inspectPlan()) as ReturnType<typeof inspectPlan>;
  }

  let probeCalls = 0;
  const countingProbe =
    (inner: EffectPostStateProbe): EffectPostStateProbe =>
    async (...args) => {
      probeCalls += 1;
      return inner(...args);
    };

  beforeEach(() => {
    probeCalls = 0;
  });

  async function ledgerKinds(): Promise<readonly string[]> {
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    return page.items.map((entry) => entry.kind);
  }

  /** Leaves one genuine, still-reconcilable attempt behind, from the canonical boundary. */
  async function indeterminateAttempt(): Promise<string> {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: unknownProbe },
      context,
    );
    expect(outcome.outcomeKind).toBe("reconciliation_indeterminate");
    return outcome.attemptEntryId;
  }

  for (const [label, mint] of [
    ["a foreign boundary", foreignPlan],
    ["a structural copy", clonedPlan],
    ["a prototype-chain forgery", prototypeForgedPlan],
  ] as const) {
    it(`refuses ${label} on runGovernedEffect before any ledger write or dispatch`, async () => {
      await expect(
        reconciler.runGovernedEffect(
          { taskId, sandbox, plan: mint(), probe: countingProbe(appliedProbe) },
          context,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

      expect(await ledgerKinds()).toEqual([]);
      expect(dispatches).toBe(0);
      expect(probeCalls).toBe(0);
    });

    for (const [outcomeLabel, probe] of [
      ["applied", appliedProbe],
      ["not_applied", notAppliedProbe],
    ] as const) {
      it(`refuses ${label} on reconcileAttempt (${outcomeLabel}) before the probe runs`, async () => {
        const attemptEntryId = await indeterminateAttempt();
        const before = await ledgerKinds();
        const dispatchesBefore = dispatches;
        probeCalls = 0;

        await expect(
          reconciler.reconcileAttempt(
            { taskId, sandbox, plan: mint(), attemptEntryId, probe: countingProbe(probe) },
            context,
          ),
        ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

        expect(probeCalls).toBe(0);
        expect(dispatches).toBe(dispatchesBefore);
        expect(await ledgerKinds()).toEqual(before);
        // The attempt is exactly as it was, and still reconcilable by its rightful authority.
        const projection = await reconciler.projection(taskId, context);
        expect(projection.attempts[0]?.outcome).toBe("indeterminate");
      });
    }
  }

  it("still runs the whole normal lifecycle for the canonical issuer", async () => {
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: inspectPlan(), probe: countingProbe(appliedProbe) },
      context,
    );
    expect(outcome.outcomeKind).toBe("effect_confirmation");
    expect(await ledgerKinds()).toEqual(["effect_attempt", "effect_confirmation"]);
    expect(dispatches).toBe(1);
    expect(probeCalls).toBe(1);
  });

  /**
   * The Task 1 contract splits the two deliberately: `consume` is the single-use spend that
   * belongs immediately before a real effect, while `verify` proves issuance and stays true
   * afterwards. Reconciliation performs no effect, so it verifies and never consumes — which is
   * what lets the very capability whose execution went unproven settle its own attempt later.
   */
  it("still verifies a capability its own execution already consumed", async () => {
    const plan = inspectPlan();
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan, probe: unknownProbe },
      context,
    );
    expect(dispatches).toBe(1);
    // The sandbox spent it at the sink; a replay through the sink is refused.
    await expect(sandboxes.execute(sandbox, plan, context)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    const settled = await reconciler.reconcileAttempt(
      { taskId, sandbox, plan, attemptEntryId: outcome.attemptEntryId, probe: appliedProbe },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    // Reconciliation never re-spends and never re-dispatches.
    expect(dispatches).toBe(1);
  });

  it("accepts a fresh canonical authorization for the same intent, scope, and issuer", async () => {
    const attemptEntryId = await indeterminateAttempt();
    const settled = await reconciler.reconcileAttempt(
      { taskId, sandbox, plan: inspectPlan(), attemptEntryId, probe: appliedProbe },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(dispatches).toBe(1);
  });

  it("refuses a canonical capability whose intent is not the attempt's, writing nothing", async () => {
    const attemptEntryId = await indeterminateAttempt();
    const before = await ledgerKinds();
    const otherIntent = boundary.authorize({
      operationId: "code.inspect",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { pathScope: ["other.ts"] },
    });
    await expect(
      reconciler.reconcileAttempt(
        { taskId, sandbox, plan: otherIntent, attemptEntryId, probe: appliedProbe },
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
    expect(await ledgerKinds()).toEqual(before);
  });

  it("refuses a foreign capability whose scoped identity also disagrees", async () => {
    // Both defects at once: neither may be reported as success, and neither may write.
    const foreign = createSemanticAuthorizationBoundary().authorize({
      operationId: "code.inspect",
      role: "executor",
      policyDecision: "allow",
      taskId: TaskId.parse("task:other"),
      jobId,
      workspace,
      sandbox: { ...sandbox, taskId: TaskId.parse("task:other") },
      parameters: { pathScope: ["target.ts"] },
    });
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: foreign, probe: countingProbe(appliedProbe) },
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await ledgerKinds()).toEqual([]);
    expect(dispatches).toBe(0);
    expect(probeCalls).toBe(0);
  });
});
