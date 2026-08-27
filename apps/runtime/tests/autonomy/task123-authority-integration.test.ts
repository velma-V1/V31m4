import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  type PolicyDecision,
  type PolicyEnginePort,
  type SandboxExecutionResult,
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
  type SandboxExecutionSpec,
  SandboxSupervisor,
  SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GovernedSandboxLifecycle } from "../../src/autonomy/authority-capture.js";
import { SqliteExecutionLedgerRepository } from "../../src/autonomy/autonomy-state-infrastructure.js";
import type {
  EffectPostState,
  EffectReconciler,
  ReconciliationAttemptDescriptor,
} from "../../src/autonomy/effect-reconciler.js";
import { GovernedExecutionSurface } from "../../src/autonomy/effect-reconciler.js";
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

type Surface = GovernedExecutionSurface;

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
  /** Lets a test observe authoritative state at the exact instant the backend is entered. */
  onExecute: (() => Promise<void>) | undefined = undefined;
  /** Per-instance count, so a shadowed sandbox would be visible as the wrong backend running. */
  ownExecutions = 0;
  override async execute(
    spec: SandboxExecutionSpec,
    plan: AuthorizedSemanticExecutionPlan,
  ): Promise<SandboxExecutionResult> {
    backendExecutions += 1;
    this.ownExecutions += 1;
    await this.onExecute?.();
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
let surface: Surface;
let sandboxes: GovernedSandboxLifecycle;
let backend: FlakyReferenceBackend;
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

async function wire(db: SqliteRuntimeDatabase): Promise<void> {
  ledger = new SqliteExecutionLedgerRepository(db);
  backend = new FlakyReferenceBackend();
  // One factory, one authority: the boundary, the sandbox it governs, and the reconciler that
  // records them are built together and cannot be recombined with foreign parts.
  surface = GovernedExecutionSurface.create({
    policy: policyEngine,
    backend,
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace)),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
    now: () => clock,
  });
  sandboxes = surface.sandboxes;
  sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, isolation, context);
  reconciler = surface.createEffectReconciler({
    unitOfWork: db.unitOfWork,
    ledger,
    generateEntryId: () => `ledger:${++entryCounter}`,
    now: () => clock,
  });
}

async function inspectPlan(from: Surface = surface, scope = "target.ts") {
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
    // And the still-unspent capability issued before the lapse no longer reaches the sink. There
    // is exactly one way to attempt that — the governed gateway — and it refuses before any
    // ledger write or dispatch.
    await expect(
      reconciler.runGovernedEffect(
        { taskId, sandbox, plan: planIssuedBeforeExpiry, probe: applied },
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(backendExecutions).toBe(1);
  });

  it("still settles the ambiguous attempt after the grant expires", async () => {
    expiresAt = GRANT_EXPIRY;
    const attemptEntryId = await ambiguousAttempt();
    clock = AFTER_EXPIRY;

    // Settling is not executing. An expired *execution* grant is the correct answer to "may I run
    // this again"; it is the wrong answer to "what already happened". Nothing about this request
    // touches execution authority, so the expiry has nothing to act on.
    const settled = await reconciler.reconcileAttempt(
      { taskId, attemptEntryId, probe: applied },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(settled.outcomeKind).toBe("effect_confirmation");
    expect(backendExecutions).toBe(1);
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
    // Settling needs neither that capability nor any other.
    expect(retained.taskId).toBe(taskId);
    const settled = await reconciler.reconcileAttempt(
      { taskId, attemptEntryId, probe: notApplied },
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
    database.close();

    // A brand-new process: a new database handle, a new Task 1 authority whose mint registry is
    // empty, and — deliberately — no sandbox prepared for the reloaded attempt.
    database = new SqliteRuntimeDatabase(databasePath);
    ledger = new SqliteExecutionLedgerRepository(database);
    const restarted = GovernedExecutionSurface.create({
      policy: policyEngine,
      backend: new FlakyReferenceBackend(),
      workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace)),
      allowedOperations: SEMANTIC_OPERATION_IDS,
      resolveWorkspaceRoot: async () => root,
      generateSandboxId: () => "sandbox:1",
      now: () => clock,
    });
    reconciler = restarted.createEffectReconciler({
      unitOfWork: database.unitOfWork,
      ledger,
      generateEntryId: () => `ledger:${++entryCounter}`,
      now: () => clock,
    });
    backendExecutions = 0;

    // No capability, no sandbox, no fresh authorization — only the durable attempt.
    const settled = await reconciler.reconcileAttempt(
      { taskId, attemptEntryId, probe: applied },
      context,
    );
    expect(settled.outcome).toBe("confirmed");
    expect(settled.outcomeKind).toBe("effect_confirmation");
    expect(backendExecutions).toBe(0);
  });

  /**
   * Property 4. If the probe still demanded an execution plan, restart safety would be cosmetic:
   * the caller could not build one after a restart without fabricating execution authority for an
   * effect it must never run. The probe receives the durable descriptor and nothing else.
   */
  it("RECONCILIATION_PROBE_HAS_NO_EXECUTION_PLAN — the probe sees only durable ledger facts", async () => {
    const attemptEntryId = await ambiguousAttempt();
    let seen: ReconciliationAttemptDescriptor | undefined;
    let extraArguments = 0;

    await reconciler.reconcileAttempt(
      {
        taskId,
        attemptEntryId,
        probe: async (...args) => {
          seen = args[0];
          // `context` is the second argument; anything beyond that would be smuggled input.
          extraArguments = args.length - 2;
          return applied();
        },
      },
      context,
    );

    expect(extraArguments).toBe(0);
    expect(seen).toEqual({
      attemptEntryId,
      taskId,
      jobId,
      operationId: "code.inspect",
      workspaceId: workspace.id,
      sandboxId: sandbox.id,
      intentFingerprint: expect.any(String),
      outcome: "indeterminate",
    });
    // Every field is a durable ledger fact. Nothing plan-shaped or handle-shaped is present.
    const keys = Object.keys(seen ?? {});
    expect(keys).not.toContain("executionPlanId");
    expect(keys).not.toContain("policyGrant");
    expect(keys).not.toContain("command");
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("backendId");
  });
});

// ===========================================================================
// D — mismatched execution composition
// ===========================================================================
describe("D: a reconciler and a sandbox from different authorities cannot compose", () => {
  /**
   * The repair is that this pairing has no representation. `EffectReconciler` no longer accepts a
   * `SandboxPort` and a verifier chosen independently; both arrive from one
   * `GovernedExecutionSurface`, which builds the Task 1 boundary and the sandbox it governs
   * together. There is no configuration of the factory that yields verifier A over sandbox B.
   */
  /** A second, genuinely canonical surface — authority B — with its own countable backend. */
  function otherSurface(): {
    readonly surface: GovernedExecutionSurface;
    readonly backend: FlakyReferenceBackend;
  } {
    const other = new FlakyReferenceBackend();
    return {
      backend: other,
      surface: GovernedExecutionSurface.create({
        policy: policyEngine,
        backend: other,
        workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace)),
        allowedOperations: SEMANTIC_OPERATION_IDS,
        resolveWorkspaceRoot: async () => root,
        generateSandboxId: () => "sandbox:2",
        now: () => clock,
      }),
    };
  }

  /**
   * The attack an earlier revision failed.
   *
   * That revision exported the construction token, so importing it and passing a hand-built
   * `{ sandboxes, verifyExecutionAuthority }` recreated the verifier-A / sandbox-B mismatch
   * exactly. The test then in place only tried *guessed* symbols and never the real one, so it
   * passed while the hole was open. This attacks through every publicly exported value instead of
   * guessing, and additionally forges the surface itself.
   */
  it("cannot be assembled from any publicly exported value", async () => {
    const authorityA = surface;
    const authorityB = otherSurface().surface;
    const ReconcilerClass = Object.getPrototypeOf(reconciler).constructor as new (
      ...args: readonly unknown[]
    ) => EffectReconciler;
    const deps = {
      unitOfWork: database.unitOfWork,
      ledger,
      generateEntryId: () => "ledger:forged",
      now: () => clock,
    };

    // Every symbol reachable from the module's entire public export surface, plus guesses.
    const publicModule: Record<string, unknown> = await import(
      "../../src/autonomy/effect-reconciler.js"
    );
    const exportedSymbols = Object.values(publicModule).filter(
      (value): value is symbol => typeof value === "symbol",
    );
    expect(exportedSymbols).toEqual([]); // no construction credential is exported at all
    const candidateTokens: symbol[] = [
      ...exportedSymbols,
      Symbol("v31m4.effect-reconciler"),
      Symbol.for("v31m4.effect-reconciler"),
      Symbol.iterator,
    ];

    // Cross-authority composition: A's verifier over B's sandbox, and the reverse.
    const crossAuthority = [
      {
        sandboxes: authorityB.sandboxes,
        verifyExecutionAuthority: (plan: AuthorizedSemanticExecutionPlan) =>
          authorityA.verifyExecutionAuthority(plan),
      },
      {
        sandboxes: authorityA.sandboxes,
        verifyExecutionAuthority: (plan: AuthorizedSemanticExecutionPlan) =>
          authorityB.verifyExecutionAuthority(plan),
      },
    ];
    // Structural fake, prototype forgery, cast, and methods copied off a real surface.
    const forgedSurfaces: unknown[] = [
      ...crossAuthority,
      { sandboxes: authorityA.sandboxes, verifyExecutionAuthority: () => undefined },
      Object.create(GovernedExecutionSurface.prototype),
      // A prototype forgery dressed with a real sandbox. `sandboxes` is a getter on the
      // prototype, so this has to be defined rather than assigned — which is itself a reminder
      // that shape can be imitated and membership cannot.
      Object.defineProperty(Object.create(GovernedExecutionSurface.prototype), "sandboxes", {
        value: authorityB.sandboxes,
        enumerable: true,
      }),
      Object.create(authorityA),
      {} as unknown,
      null,
    ];

    let built = 0;
    for (const token of candidateTokens) {
      for (const forged of forgedSurfaces) {
        try {
          new ReconcilerClass(token, forged, deps);
          built += 1;
        } catch (error) {
          expect(error).toBeInstanceOf(ApplicationError);
          expect((error as ApplicationError).code).toBe("PERMISSION_DENIED");
        }
      }
    }
    expect(built).toBe(0);

    // A genuine surface is still the one thing that works, and it is self-paired.
    expect(authorityB.createEffectReconciler(deps)).toBeDefined();
    expect(GovernedExecutionSurface.isGenuine(authorityB)).toBe(true);

    // Nothing was written, probed, or dispatched by any of it.
    expect(await ledgerKinds()).toEqual([]);
    expect(probeCalls).toBe(0);
    expect(backendExecutions).toBe(0);
  });

  it("refuses a forged surface even when the sandbox and verifier are both genuine", async () => {
    // Both halves real, but taken from *different* authorities and recombined by hand. Membership
    // in the private registry — not shape, not prototype — is what decides.
    const authorityB = otherSurface().surface;
    expect(
      GovernedExecutionSurface.isGenuine({
        sandboxes: authorityB.sandboxes,
        verifyExecutionAuthority: surface.verifyExecutionAuthority.bind(surface),
      }),
    ).toBe(false);
    expect(
      GovernedExecutionSurface.isGenuine(Object.create(GovernedExecutionSurface.prototype)),
    ).toBe(false);
    expect(GovernedExecutionSurface.isGenuine(Object.create(surface))).toBe(false);
    expect(GovernedExecutionSurface.isGenuine(surface)).toBe(true);
    expect(await ledgerKinds()).toEqual([]);
    expect(backendExecutions).toBe(0);
  });

  /**
   * P0-1. `Object.create(EffectReconciler.prototype)` never runs the constructor, and the
   * reconciliation path reads only the ordinary `dependencies` property — so copying that one
   * field off a genuine reconciler would otherwise hand an attacker authoritative settlement over
   * recorded history without any surface, credential, or registration.
   */
  it("refuses a constructor-bypassed reconciler, however completely it is dressed", async () => {
    const attemptEntryId = await ambiguousAttempt();
    const before = await ledgerKinds();
    const backendBefore = backendExecutions;
    probeCalls = 0;

    // Every own and inherited ordinary field the genuine object has, copied onto forgeries.
    const genuineFields = Object.getOwnPropertyDescriptors(reconciler);
    const forgeries: EffectReconciler[] = [
      Object.defineProperties(
        Object.create(Object.getPrototypeOf(reconciler)),
        genuineFields,
      ) as EffectReconciler,
      // Inherits from the real instance: every property resolves, identity does not.
      Object.create(reconciler) as EffectReconciler,
      Object.defineProperties(Object.create(Object.getPrototypeOf(reconciler)), {
        dependencies: {
          value: {
            unitOfWork: database.unitOfWork,
            ledger,
            generateEntryId: () => "ledger:forged",
            now: () => clock,
          },
        },
      }) as EffectReconciler,
    ];

    for (const forged of forgeries) {
      await expect(
        forged.reconcileAttempt({ taskId, attemptEntryId, probe: countedApplied }, context),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(
        forged.runGovernedEffect(
          { taskId, sandbox, plan: await inspectPlan(), probe: countedApplied },
          context,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }

    expect(probeCalls).toBe(0);
    expect(await ledgerKinds()).toEqual(before);
    expect(backendExecutions).toBe(backendBefore);
    // The genuine reconciler still works, so the guard is not simply refusing everything.
    expect(
      (await reconciler.reconcileAttempt({ taskId, attemptEntryId, probe: applied }, context))
        .outcome,
    ).toBe("confirmed");
  });

  /**
   * P0-2. The security decision must not live in a writable property of an exported class. With
   * the public diagnostic replaced by a no-op, `createEffectReconciler` — which holds the real
   * module-private credential — must still refuse a cross-authority surface.
   */
  it("refuses a forged surface even with the public validator monkey-patched away", async () => {
    const authorityB = otherSurface().surface;
    const crossAuthorityFake = {
      sandboxes: authorityB.sandboxes,
      verifyExecutionAuthority: (plan: AuthorizedSemanticExecutionPlan) =>
        surface.verifyExecutionAuthority(plan),
    };
    const deps = {
      unitOfWork: database.unitOfWork,
      ledger,
      generateEntryId: () => "ledger:forged",
      now: () => clock,
    };
    const original = GovernedExecutionSurface.isGenuine;
    // The attacker's patch: everything now reports as authentic.
    Object.defineProperty(GovernedExecutionSurface, "isGenuine", {
      value: () => true,
      configurable: true,
      writable: true,
    });
    try {
      expect(GovernedExecutionSurface.isGenuine(crossAuthorityFake)).toBe(true); // the lie lands
      expect(() =>
        GovernedExecutionSurface.prototype.createEffectReconciler.call(crossAuthorityFake, deps),
      ).toThrow(ApplicationError);
      expect(() =>
        GovernedExecutionSurface.prototype.createEffectReconciler.call(
          Object.create(GovernedExecutionSurface.prototype),
          deps,
        ),
      ).toThrow(ApplicationError);
    } finally {
      Object.defineProperty(GovernedExecutionSurface, "isGenuine", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
    expect(GovernedExecutionSurface.isGenuine(crossAuthorityFake)).toBe(false);
    expect(await ledgerKinds()).toEqual([]);
    expect(probeCalls).toBe(0);
    expect(backendExecutions).toBe(0);
  });

  /**
   * P0-1. A genuine, registered surface whose public `sandboxes` getter has been shadowed with
   * another authority's sandbox. Identity is untouched — it is still the real object — so an
   * identity-only brand would let A's verifier admit a plan that then dispatches into B's sink.
   * Privileged execution reads the sandbox from module-private state, so the shadow is inert.
   */
  it("dispatches into its own sandbox even when a genuine surface is re-paired", async () => {
    const b = otherSurface();
    const aBackendBefore = backend.ownExecutions;

    Object.defineProperty(surface, "sandboxes", { value: b.surface.sandboxes, configurable: true });
    // The public view really is redirected — this is a genuine shadow, not a no-op.
    expect(surface.sandboxes).toBe(b.surface.sandboxes);
    Reflect.deleteProperty(surface, "sandboxes");
    Object.defineProperty(surface, "sandboxes", {
      value: b.surface.sandboxes,
      configurable: true,
    });
    expect(GovernedExecutionSurface.isGenuine(surface)).toBe(true);

    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: await inspectPlan(), probe: applied },
      context,
    );

    expect(outcome.outcomeKind).toBe("effect_confirmation");
    // A's own backend ran; B's never saw anything.
    expect(backend.ownExecutions).toBe(aBackendBefore + 1);
    expect(b.backend.ownExecutions).toBe(0);
  });

  /**
   * P0-2 (surface half). The verifier is the gate that keeps a foreign capability out of the
   * ledger. Replacing it on a genuine surface — with a no-op, or with another authority's
   * verifier — must not change what executes.
   */
  it("verifies against its own authority even when a genuine surface's verifier is replaced", async () => {
    const b = otherSurface();
    const foreignPlan = await inspectPlan(b.surface);
    const original = Object.getOwnPropertyDescriptor(
      GovernedExecutionSurface.prototype,
      "verifyExecutionAuthority",
    );

    for (const replacement of [
      () => undefined,
      (plan: AuthorizedSemanticExecutionPlan) => b.surface.verifyExecutionAuthority(plan),
    ]) {
      Object.defineProperty(surface, "verifyExecutionAuthority", {
        value: replacement,
        configurable: true,
      });
      probeCalls = 0;
      await expect(
        reconciler.runGovernedEffect(
          { taskId, sandbox, plan: foreignPlan, probe: countedApplied },
          context,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(await ledgerKinds()).toEqual([]);
      expect(probeCalls).toBe(0);
      expect(backendExecutions).toBe(0);
    }
    Reflect.deleteProperty(surface, "verifyExecutionAuthority");

    // The same again from the prototype, which every surface shares.
    Object.defineProperty(GovernedExecutionSurface.prototype, "verifyExecutionAuthority", {
      value: () => undefined,
      configurable: true,
      writable: true,
    });
    try {
      await expect(
        reconciler.runGovernedEffect(
          { taskId, sandbox, plan: foreignPlan, probe: countedApplied },
          context,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(await ledgerKinds()).toEqual([]);
      expect(backendExecutions).toBe(0);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(
          GovernedExecutionSurface.prototype,
          "verifyExecutionAuthority",
          original,
        );
      }
    }
  });

  /**
   * P0-2 (reconciler half). `dependencies` was an ordinary property, so redefining it on a genuine
   * reconciler would have redirected authoritative settlement to another ledger.
   */
  it("uses the ledger it was built with even when a genuine reconciler is re-pointed", async () => {
    const attemptEntryId = await ambiguousAttempt();
    let hostileReads = 0;
    let hostileWrites = 0;
    const hostileLedger = {
      listForTask: async () => {
        hostileReads += 1;
        return { items: [], nextCursor: null };
      },
      append: async () => {
        hostileWrites += 1;
      },
    };
    Object.defineProperty(reconciler, "dependencies", {
      value: {
        unitOfWork: {
          execute: async () => {
            hostileWrites += 1;
          },
        },
        ledger: hostileLedger,
        generateEntryId: () => "ledger:hostile",
        now: () => "1999-01-01T00:00:00.000Z",
      },
      configurable: true,
    });

    const settled = await reconciler.reconcileAttempt(
      { taskId, attemptEntryId, probe: applied },
      context,
    );

    // The real ledger settled it; the attacker's ledger and unit of work were never touched.
    expect(settled.outcome).toBe("confirmed");
    expect(settled.outcomeEntryId).not.toBe("ledger:hostile");
    expect(hostileReads).toBe(0);
    expect(hostileWrites).toBe(0);
    expect(await ledgerKinds()).toEqual([
      "effect_attempt",
      "reconciliation_indeterminate",
      "effect_confirmation",
    ]);
    Reflect.deleteProperty(reconciler, "dependencies");
  });

  /**
   * P0-1. While the surface returned a full `SandboxPort`, a caller holding a canonical plan could
   * dispatch straight into the backend — reaching Task 1's verify/consume and the environment with
   * no `effect_attempt` durable anywhere. Task 3 was optional by convention. It is now the only
   * gateway, and the ordering invariant is observed from inside the backend itself.
   */
  it("offers no execution path outside the governed gateway, and records the attempt first", async () => {
    // Nothing reachable from the surface exposes an executable sandbox.
    const lifecycle = surface.sandboxes as unknown as Record<string, unknown>;
    expect(typeof lifecycle["execute"]).toBe("undefined");
    expect(Object.keys(lifecycle).sort()).toEqual(["cancel", "destroy", "inspect", "prepare"]);
    for (const value of [
      ...Object.values(lifecycle),
      ...Object.values(surface as unknown as Record<string, unknown>),
    ]) {
      expect((value as { execute?: unknown } | null)?.execute).toBeUndefined();
    }
    // Nor through reflection over the whole prototype chain.
    const reachable = new Set<string>();
    for (let o: object | null = surface; o !== null; o = Object.getPrototypeOf(o)) {
      for (const key of Reflect.ownKeys(o)) reachable.add(String(key));
    }
    expect(reachable.has("execute")).toBe(false);

    // The ordering invariant, observed from inside the backend at the instant it is entered.
    let ledgerAtBackendEntry: readonly string[] = [];
    backend.onExecute = async () => {
      ledgerAtBackendEntry = await ledgerKinds();
    };
    const outcome = await reconciler.runGovernedEffect(
      { taskId, sandbox, plan: await inspectPlan(), probe: applied },
      context,
    );
    backend.onExecute = undefined;

    expect(ledgerAtBackendEntry).toEqual(["effect_attempt"]);
    expect(outcome.outcomeKind).toBe("effect_confirmation");
    expect(backendExecutions).toBe(1);
  });

  /**
   * P0-2. The private state used to hold the supervisor itself, so patching
   * `SandboxSupervisor.prototype.execute` after construction redirected the sink even though the
   * reference was unreachable. The sink is now a function value bound at creation.
   */
  it("dispatches through the sink captured at creation, not a patched prototype", async () => {
    let hijacked = 0;
    const original = Object.getOwnPropertyDescriptor(SandboxSupervisor.prototype, "execute");
    Object.defineProperty(SandboxSupervisor.prototype, "execute", {
      value: async () => {
        hijacked += 1;
        return { status: "completed", outputArtifactIds: [], logArtifactIds: [], metadata: {} };
      },
      configurable: true,
      writable: true,
    });
    try {
      const outcome = await reconciler.runGovernedEffect(
        { taskId, sandbox, plan: await inspectPlan(), probe: applied },
        context,
      );
      // The canonical Task 1 sink ran: real verification, real consume, real backend.
      expect(hijacked).toBe(0);
      expect(backendExecutions).toBe(1);
      expect(outcome.outcomeKind).toBe("effect_confirmation");
    } finally {
      if (original !== undefined) {
        Object.defineProperty(SandboxSupervisor.prototype, "execute", original);
      }
    }
  });

  /**
   * P0-3. The frozen wrapper held the caller's dependencies object by reference, so mutating that
   * original object after construction redirected authoritative state. The reconciler now keeps a
   * private snapshot built from method values captured at construction.
   */
  it("uses the dependencies captured at construction, not the caller's mutated wrapper", async () => {
    let hostileReads = 0;
    let hostileWrites = 0;
    const hostileLedger = {
      append: async () => {
        hostileWrites += 1;
      },
      getById: async () => {
        hostileReads += 1;
        return null;
      },
      listForTask: async () => {
        hostileReads += 1;
        return { items: [], nextCursor: null };
      },
    };
    // The exact object handed to the factory, kept and mutated afterwards.
    const deps = {
      unitOfWork: database.unitOfWork,
      ledger: ledger as unknown as typeof hostileLedger,
      generateEntryId: () => `ledger:${++entryCounter}`,
      now: () => clock,
    };
    const own = surface.createEffectReconciler(deps as never);
    const first = await own.runGovernedEffect(
      { taskId, sandbox, plan: await inspectPlan(), probe: unknown },
      context,
    );

    deps.ledger = hostileLedger;
    deps.unitOfWork = {
      execute: async () => {
        hostileWrites += 1;
      },
    } as never;
    deps.generateEntryId = () => "ledger:hostile";
    deps.now = () => "1999-01-01T00:00:00.000Z";
    // Replacing the method properties on the originally supplied port must not matter either:
    // the canonical method values were captured at construction.
    const realAppend = ledger.append.bind(ledger);
    Object.defineProperty(ledger, "append", {
      value: async () => {
        hostileWrites += 1;
      },
      configurable: true,
      writable: true,
    });
    try {
      const settled = await own.reconcileAttempt(
        { taskId, attemptEntryId: first.attemptEntryId, probe: applied },
        context,
      );
      expect(settled.outcome).toBe("confirmed");
      expect(settled.outcomeEntryId).not.toBe("ledger:hostile");
      expect(hostileReads).toBe(0);
      expect(hostileWrites).toBe(0);
    } finally {
      Object.defineProperty(ledger, "append", {
        value: realAppend,
        configurable: true,
        writable: true,
      });
    }
    // The entry really landed in the real ledger.
    expect(await ledgerKinds()).toEqual([
      "effect_attempt",
      "reconciliation_indeterminate",
      "effect_confirmation",
    ]);
  });

  /**
   * Privileged logic must not reach through writable class or prototype members.
   *
   * TypeScript `private` is erased at runtime, so `requireCanonicalAuthority` was an ordinary
   * writable static and `projection`/`intentFingerprintFor`/`observeReconciledState` were ordinary
   * writable prototype members. Each one, replaced after construction, redirected a different
   * security decision. They are now module-private free functions; the public members that remain
   * are wrappers nothing privileged calls.
   */
  describe("post-construction method patching cannot redirect privileged decisions", () => {
    type Patch = readonly [target: object, key: string, value: unknown];

    /** Applies patches, runs the body, and always restores exactly what was there. */
    async function withPatches(
      patches: readonly Patch[],
      body: () => Promise<void>,
    ): Promise<void> {
      const saved = patches.map(
        ([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const,
      );
      for (const [target, key, value] of patches) {
        Object.defineProperty(target, key, { value, configurable: true, writable: true });
      }
      try {
        await body();
      } finally {
        for (const [target, key, descriptor] of saved) {
          if (descriptor === undefined) Reflect.deleteProperty(target, key);
          else Object.defineProperty(target, key, descriptor);
        }
      }
    }

    const ReconcilerClass = () =>
      Object.getPrototypeOf(reconciler).constructor as unknown as Record<string, unknown>;
    const ReconcilerProto = () => Object.getPrototypeOf(reconciler) as object;

    it("ignores a no-op patched authority check", async () => {
      const foreign = await inspectPlan(otherSurface().surface);
      probeCalls = 0;
      await withPatches(
        [[ReconcilerClass() as object, "requireCanonicalAuthority", () => undefined]],
        async () => {
          await expect(
            reconciler.runGovernedEffect(
              { taskId, sandbox, plan: foreign, probe: countedApplied },
              context,
            ),
          ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
        },
      );
      expect(await ledgerKinds()).toEqual([]);
      expect(probeCalls).toBe(0);
      expect(backendExecutions).toBe(0);
    });

    it("ignores a patched intent fingerprint, so duplicates stay blocked", async () => {
      await ambiguousAttempt();
      const before = await ledgerKinds();
      let n = 0;
      const changingFingerprint = () => {
        n += 1;
        return `${"f".repeat(63)}${n % 10}`;
      };
      await withPatches(
        [[ReconcilerProto(), "intentFingerprintFor", changingFingerprint]],
        async () => {
          await expect(
            reconciler.runGovernedEffect(
              { taskId, sandbox, plan: await inspectPlan(), probe: applied },
              context,
            ),
          ).rejects.toMatchObject({ code: "CONFLICT" });
        },
      );
      expect(await ledgerKinds()).toEqual(before);
      expect(backendExecutions).toBe(1);
    });

    it("ignores a patched projection, so a blocking attempt still blocks", async () => {
      await ambiguousAttempt();
      const before = await ledgerKinds();
      await withPatches(
        [
          [
            ReconcilerProto(),
            "projection",
            async () => ({
              attempts: [],
              invalidatedEntryIds: new Set<string>(),
              validityNodes: new Map(),
            }),
          ],
        ],
        async () => {
          await expect(
            reconciler.runGovernedEffect(
              { taskId, sandbox, plan: await inspectPlan(), probe: applied },
              context,
            ),
          ).rejects.toMatchObject({ code: "CONFLICT" });
        },
      );
      expect(await ledgerKinds()).toEqual(before);
      expect(backendExecutions).toBe(1);
    });

    it("follows the real probe, not a patched observer", async () => {
      const attemptEntryId = await ambiguousAttempt();
      await withPatches(
        [
          [
            ReconcilerProto(),
            "observeReconciledState",
            async () => ({ kind: "applied", facts: [] }),
          ],
        ],
        async () => {
          // The real probe proves non-application; the patch claims the opposite.
          const settled = await reconciler.reconcileAttempt(
            { taskId, attemptEntryId, probe: notApplied },
            context,
          );
          expect(settled.outcome).toBe("not_applied");
          expect(settled.outcomeKind).toBe("effect_nonapplication");
        },
      );
      expect(backendExecutions).toBe(1);
    });

    it("is unchanged with every mutable helper patched at once", async () => {
      const attemptEntryId = await ambiguousAttempt();
      const foreign = await inspectPlan(otherSurface().surface);
      probeCalls = 0;
      await withPatches(
        [
          [ReconcilerClass() as object, "requireCanonicalAuthority", () => undefined],
          [ReconcilerProto(), "intentFingerprintFor", () => "0".repeat(64)],
          [
            ReconcilerProto(),
            "projection",
            async () => ({
              attempts: [],
              invalidatedEntryIds: new Set<string>(),
              validityNodes: new Map(),
            }),
          ],
          [
            ReconcilerProto(),
            "observeReconciledState",
            async () => ({ kind: "applied", facts: [] }),
          ],
        ],
        async () => {
          // Execution: foreign capability still refused, nothing written or dispatched.
          await expect(
            reconciler.runGovernedEffect(
              { taskId, sandbox, plan: foreign, probe: countedApplied },
              context,
            ),
          ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
          // Duplicate intent still blocked.
          await expect(
            reconciler.runGovernedEffect(
              { taskId, sandbox, plan: await inspectPlan(), probe: applied },
              context,
            ),
          ).rejects.toMatchObject({ code: "CONFLICT" });
          // Reconciliation still follows the real probe.
          const settled = await reconciler.reconcileAttempt(
            { taskId, attemptEntryId, probe: notApplied },
            context,
          );
          expect(settled.outcome).toBe("not_applied");
        },
      );
      expect(probeCalls).toBe(0);
      expect(backendExecutions).toBe(1);
      expect(await ledgerKinds()).toEqual([
        "effect_attempt",
        "reconciliation_indeterminate",
        "effect_nonapplication",
      ]);
    });
  });

  it("refuses a foreign authority's capability before any ledger write, probe, or backend", async () => {
    const plan = await inspectPlan(otherSurface().surface);

    await expect(
      reconciler.runGovernedEffect({ taskId, sandbox, plan, probe: countedApplied }, context),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(backendExecutions).toBe(0);
    expect(await ledgerKinds()).toEqual([]);
    expect(probeCalls).toBe(0);
  });

  /**
   * The reconciliation half of D no longer has an attack surface: `reconcileAttempt` accepts no
   * capability, so there is nothing for a foreign authority to supply. What is proved instead is
   * that settling still refuses an attempt this task does not own.
   */
  it("refuses to settle an attempt that this task's history does not contain", async () => {
    const attemptEntryId = await ambiguousAttempt();
    const before = await ledgerKinds();

    await expect(
      reconciler.reconcileAttempt(
        { taskId: TaskId.parse("task:other"), attemptEntryId, probe: countedApplied },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reconciler.reconcileAttempt(
        { taskId, attemptEntryId: "ledger:forged", probe: countedApplied },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(probeCalls).toBe(0);
    expect(await ledgerKinds()).toEqual(before);
    expect(backendExecutions).toBe(1);
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
      { taskId, sandbox, plan: await inspectPlan(surface, "other.ts"), probe: notApplied },
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
