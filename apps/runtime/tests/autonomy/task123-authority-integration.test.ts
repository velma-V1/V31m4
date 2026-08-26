import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuthorizedSemanticExecutionPlan,
  type PolicyDecision,
  type PolicyEnginePort,
  type SandboxExecutionResult,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type SandboxPort,
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
  type SandboxExecutionSpec,
  SandboxSupervisor,
  SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteExecutionLedgerRepository } from "../../src/autonomy/autonomy-state-infrastructure.js";
import { type EffectPostState, EffectReconciler } from "../../src/autonomy/effect-reconciler.js";
import { createSemanticAuthorizationBoundary } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * Task 1 + Task 2 + Task 3 integration gaps.
 *
 * Task 3 was reviewed against a Task 1 whose `verify` proved only *issuer*. Final Task 1 makes
 * `verify` prove issuer **and** current policy-grant validity, and keeps the mint registry in a
 * process-local `WeakSet`. `EffectReconciler` compiles unchanged across that change, so nothing
 * here is caught by the merge or by the existing suites — every test in this file passes on the
 * mechanical integration base for the wrong reason, or fails for the right one.
 *
 * These tests describe the behaviour the integration must have. They are expected to be RED until
 * reconciliation authority is separated from execution authority.
 */
const taskId = TaskId.parse("task:integration");
const jobId = JobId.parse("job:1");
const projectId = ProjectId.parse("project:1");
const isolation = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const budget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 0,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});

const T0 = "2026-08-26T00:00:00.000Z";
const GRANT_EXPIRY = "2026-08-26T00:01:00.000Z";
const AFTER_EXPIRY = "2026-08-26T00:02:00.000Z";

type Boundary = ReturnType<typeof createSemanticAuthorizationBoundary>;

/** A real policy engine whose answer and grant lifetime a test can change between calls. */
let decision: PolicyDecision;
let expiresAt: string | undefined;
let clock: string;

const policyEngine: PolicyEnginePort = {
  async evaluate() {
    return {
      decision,
      policyId: "policy:integration",
      reasons: [],
      requiredApprovalScopes: [],
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  },
};

function newBoundary(): Boundary {
  return createSemanticAuthorizationBoundary({ policy: policyEngine, now: () => clock });
}

/**
 * Fails one dispatch on demand, so a test can drive the sandbox into `degraded`, and counts how
 * many times the *backend* was actually reached.
 *
 * `dispatches` counts calls to `SandboxPort.execute`; `backendExecutions` counts effects that got
 * past every supervisor gate. Conflating the two would hide exactly the defect D is about: the
 * supervisor can refuse a capability while the reconciler still records an outcome for it.
 */
class FlakyReferenceBackend extends ReferenceSandboxBackend {
  failNextExecute = false;
  override async execute(
    spec: SandboxExecutionSpec,
    plan: AuthorizedSemanticExecutionPlan,
  ): Promise<SandboxExecutionResult> {
    backendExecutions += 1;
    if (this.failNextExecute) {
      this.failNextExecute = false;
      throw new Error("the backend failed after the sandbox was already claimed");
    }
    return super.execute(spec, plan);
  }
}

let database: SqliteRuntimeDatabase;
let databasePath: string;
let root: string;
let workspace: WorkspaceHandle;
let ledger: SqliteExecutionLedgerRepository;
let reconciler: EffectReconciler;
let sandboxes: SandboxSupervisor;
let backend: FlakyReferenceBackend;
let boundary: Boundary;
let sandbox: SandboxHandle;
let entryCounter = 0;
let dispatches = 0;
let backendExecutions = 0;
let probeCalls = 0;

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

function counting(inner: SandboxSupervisor): SandboxPort {
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

/**
 * Composes one governed execution surface. `reconcilerVerifier` is deliberately separate so a
 * test can hand the reconciler a *different* Task 1 authority than the sandbox holds — which the
 * current independently-injected dependency shape permits.
 */
async function wire(
  db: SqliteRuntimeDatabase,
  options: { readonly reconcilerBoundary?: Boundary } = {},
): Promise<void> {
  ledger = new SqliteExecutionLedgerRepository(db);
  boundary = newBoundary();
  backend = new FlakyReferenceBackend();
  sandboxes = new SandboxSupervisor({
    backend,
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace)),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    capabilities: boundary.capabilities,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
  });
  sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, isolation, context);
  reconciler = new EffectReconciler({
    unitOfWork: db.unitOfWork,
    ledger,
    sandboxes: counting(sandboxes),
    capabilities: (options.reconcilerBoundary ?? boundary).capabilities,
    generateEntryId: () => `ledger:${++entryCounter}`,
    now: () => clock,
  });
}

async function inspectPlan(from: Boundary = boundary, scope = "target.ts") {
  return from.authorize(
    {
      operationId: "code.inspect",
      role: "executor",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { pathScope: [scope] },
    },
    context,
  );
}

const applied = async (): Promise<EffectPostState> =>
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
const notApplied = async (): Promise<EffectPostState> =>
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
const unknown = async (): Promise<EffectPostState> =>
  Object.freeze({ kind: "unknown" as const, reason: "the post-state could not be read" });

const countedApplied = async (...args: Parameters<typeof applied>) => {
  probeCalls += 1;
  return applied(...args);
};

beforeEach(async () => {
  decision = "allow";
  expiresAt = undefined;
  clock = T0;
  entryCounter = 0;
  dispatches = 0;
  backendExecutions = 0;
  probeCalls = 0;
  root = mkdtempSync(join(tmpdir(), "v31m4-integration-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  workspace = Object.freeze({
    id: "workspace-1",
    projectId,
    purpose: "tool_execution" as const,
    rootPath: SafePath.parse("workspace-1"),
    status: "active" as const,
    createdAt: T0,
  });
  database = runtimeDatabase();
  databasePath = database.path;
  await wire(database);
});

afterEach(() => {
  database.close();
});

/** Leaves one genuine, still-open attempt that only observation can settle. */
async function ambiguousAttempt(): Promise<string> {
  const outcome = await reconciler.runGovernedEffect(
    { taskId, sandbox, plan: await inspectPlan(), probe: unknown },
    context,
  );
  expect(outcome.outcomeKind).toBe("reconciliation_indeterminate");
  return outcome.attemptEntryId;
}

async function ledgerKinds(): Promise<readonly string[]> {
  const page = await ledger.listForTask(taskId, { limit: 500 }, context);
  return page.items.map((entry) => entry.kind);
}

// ===========================================================================
// A — the execution grant expires after an ambiguous effect
// ===========================================================================
describe("A: an expired execution grant must not block settling history", () => {
  it("refuses to dispatch once the grant behind the authorization has expired", async () => {
    expiresAt = GRANT_EXPIRY;
    await ambiguousAttempt();
    // A second, independent capability, minted while the grant was still live. It is deliberately
    // *not* the one `ambiguousAttempt` spent — single-use replay of a consumed capability is Task
    // 1's own invariant and is covered by Task 1's tests. What is proved here is narrower and is
    // about time alone: a capability that was valid when issued must stop working once the policy
    // grant it was minted against lapses.
    const planIssuedBeforeExpiry = await inspectPlan();
    clock = AFTER_EXPIRY;

    // No fresh authority can be obtained either: minting refuses an already-expired grant.
    await expect(inspectPlan()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // And the still-unspent capability issued before the lapse no longer reaches the sink.
    await expect(sandboxes.execute(sandbox, planIssuedBeforeExpiry, context)).rejects.toMatchObject(
      { code: "PERMISSION_DENIED" },
    );
    expect(backendExecutions).toBe(1);
  });

  it("still settles the ambiguous attempt after the grant expires", async () => {
    expiresAt = GRANT_EXPIRY;
    const attemptEntryId = await ambiguousAttempt();
    const plan = await inspectPlan();
    clock = AFTER_EXPIRY;

    // Settling is not executing. An expired *execution* grant is the correct answer to "may I run
    // this again"; it is the wrong answer to "what already happened".
    const settled = await reconciler.reconcileAttempt(
      { taskId, sandbox, plan, attemptEntryId, probe: applied },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(settled.outcomeKind).toBe("effect_confirmation");
    expect(dispatches).toBe(1);
    expect(await ledgerKinds()).toEqual([
      "effect_attempt",
      "reconciliation_indeterminate",
      "effect_confirmation",
    ]);
  });
});

// ===========================================================================
// B — policy flips allow -> deny after an ambiguous effect
// ===========================================================================
describe("B: a current deny must not erase settleable history", () => {
  it("denies a fresh authorization once policy turns to deny", async () => {
    await ambiguousAttempt();
    decision = "deny";
    await expect(inspectPlan()).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    expect(backendExecutions).toBe(1);
  });

  /**
   * Characterizes what a current deny does and does not do on its own.
   *
   * The grant sealed into a capability is immutable provenance, not a live subscription to the
   * policy engine, and `verify` re-checks only that grant's own expiry. So a capability minted
   * while policy allowed stays verifiable after policy flips to deny. That is the *current* Task 1
   * contract, and it means a deny by itself does not strand reconciliation — a caller still
   * holding a live, unexpired capability can settle.
   *
   * This is deliberately GREEN. The gap deny exposes is not a standalone defect; it is that this
   * route depends on retaining a process-local capability at all, which is what C2 proves cannot
   * survive a restart. Recording it as RED would have claimed a defect the evidence does not show.
   */
  it("does not invalidate a retained, still-current capability issued while policy allowed", async () => {
    const attemptEntryId = await ambiguousAttempt();
    // Issued while policy allowed, never spent, no expiry: still-current by the Task 1 contract.
    const retained = await inspectPlan();
    decision = "deny";

    // A component that did *not* retain such a capability has only one route today — mint a fresh
    // one — and policy now closes it.
    await expect(inspectPlan()).rejects.toMatchObject({ code: "POLICY_REJECTED" });

    // The retained capability, however, still settles the attempt.
    const settled = await reconciler.reconcileAttempt(
      { taskId, sandbox, plan: retained, attemptEntryId, probe: notApplied },
      context,
    );
    expect(settled.outcome).toBe("not_applied");
    expect(settled.outcomeKind).toBe("effect_nonapplication");
    expect(backendExecutions).toBe(1);
  });
});

// ===========================================================================
// C — runtime restart after an ambiguous effect
// ===========================================================================
describe("C: settlement survives a restart without process-local authority", () => {
  it("reloads the attempt and still refuses a blind replay", async () => {
    const attemptEntryId = await ambiguousAttempt();
    const stalePlan = await inspectPlan();
    database.close();

    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);
    dispatches = 0;

    const projection = await reconciler.projection(taskId, context);
    expect(projection.attempts[0]?.attemptEntryId).toBe(attemptEntryId);
    expect(projection.attempts[0]?.outcome).toBe("indeterminate");
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: await inspectPlan(), probe: applied },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dispatches).toBe(0);
    expect(stalePlan.taskId).toBe(taskId);
  });

  it("settles the reloaded attempt from durable history alone", async () => {
    const attemptEntryId = await ambiguousAttempt();
    // The only capability that ever existed for this attempt. After a restart the authority that
    // minted it is gone, and its mint registry with it.
    const originalPlan = await inspectPlan();
    database.close();

    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);
    dispatches = 0;

    // Settlement must depend on the durable attempt, not on a process-local capability that no
    // longer verifies anywhere.
    const settled = await reconciler.reconcileAttempt(
      { taskId, sandbox, plan: originalPlan, attemptEntryId, probe: applied },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(dispatches).toBe(0);
  });
});

// ===========================================================================
// D — mismatched execution composition
// ===========================================================================
describe("D: a reconciler and a sandbox from different authorities must not compose", () => {
  it("refuses an effect whose capability the sandbox's own authority would reject", async () => {
    const reconcilerBoundary = newBoundary();
    await wire(database, { reconcilerBoundary });
    // Minted by the reconciler's authority; the sandbox's authority never saw it.
    const plan = await inspectPlan(reconcilerBoundary);

    await expect(
      reconciler.runGovernedEffect({ taskId, sandbox, plan, probe: countedApplied }, context),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // The supervisor refuses this capability before the backend, so no effect can have happened.
    // Today the reconciler nonetheless records an authoritative outcome for it.
    expect(backendExecutions).toBe(0);
    expect(await ledgerKinds()).toEqual([]);
    expect(probeCalls).toBe(0);
  });

  it("refuses a reconciliation whose capability the sandbox's own authority would reject", async () => {
    const attemptEntryId = await ambiguousAttempt();
    const reconcilerBoundary = newBoundary();
    const previous = await ledgerKinds();
    reconciler = new EffectReconciler({
      unitOfWork: database.unitOfWork,
      ledger,
      sandboxes: counting(sandboxes),
      capabilities: reconcilerBoundary.capabilities,
      generateEntryId: () => `ledger:${++entryCounter}`,
      now: () => clock,
    });
    const plan = await inspectPlan(reconcilerBoundary);

    const backendBefore = backendExecutions;
    await expect(
      reconciler.reconcileAttempt(
        { taskId, sandbox, plan, attemptEntryId, probe: countedApplied },
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Reconciliation never dispatches, so zero backend executions proves nothing about authority
    // here — the point is that a capability this sandbox's authority would reject can still drive
    // an authoritative terminal settlement.
    expect(backendExecutions).toBe(backendBefore);
    expect(probeCalls).toBe(0);
    expect(await ledgerKinds()).toEqual(previous);
  });
});

// ===========================================================================
// E — stale handle / degraded sandbox (characterization only)
// ===========================================================================
describe("E: a degraded sandbox reached through a stale handle", () => {
  it("characterizes what a caller can still prove after the backend fails", async () => {
    backend.failNextExecute = true;
    const first = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: await inspectPlan(), probe: notApplied },
      context,
    );
    // The caller's handle is a frozen snapshot taken at prepare; it still reads "ready".
    expect(sandbox.status).toBe("ready");
    const live = await sandboxes.inspect(sandbox.id, context);

    // A second, genuinely different intent, authorized against that stale handle.
    const second = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: await inspectPlan(boundary, "other.ts"), probe: notApplied },
      context,
    );
    const projection = await reconciler.projection(taskId, context);
    console.log("E characterization", {
      firstOutcome: first.outcomeKind,
      liveStatus: live?.status,
      secondOutcome: second.outcomeKind,
      dispatches,
      attempts: projection.attempts.map((attempt) => attempt.outcome),
      kinds: await ledgerKinds(),
    });

    // Characterization only: the supervisor refuses before `consume` and before the backend, so
    // non-application is deterministically provable and the intent stays retryable.
    expect(second.outcomeKind).toBe("effect_nonapplication");
    expect(projection.attempts.every((attempt) => attempt.outcome !== "unresolved")).toBe(true);
  });
});
