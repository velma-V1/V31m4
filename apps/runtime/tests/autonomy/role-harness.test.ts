import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentModelGatewayPort,
  type AgentTurnInvocationRequest,
  type AgentTurnInvocationResult,
  type AgentTurnProposal,
  ApplicationError,
  type EntryAcceptanceSnapshot,
  freezeEntryAcceptanceSnapshot,
  type PolicyEnginePort,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type WorkspaceHandle,
} from "@v31m4/application";
import { AGENT_TURN_CONTRACT_VERSION } from "@v31m4/contracts";
import {
  ContentHash,
  EvidenceRecord,
  ExecutionLedgerEntry,
  JobId,
  ProjectId,
  ResourceBudget,
  SafePath,
  sha256Hex,
  type TaskCapsule,
  TaskId,
} from "@v31m4/domain";
import {
  ReferenceSandboxBackend,
  SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTurnBudget, AgentTurnContext } from "../../src/autonomy/agent-turn-loop.js";
import {
  SqliteExecutionLedgerRepository,
  SqliteTaskCapsuleRepository,
} from "../../src/autonomy/autonomy-state-infrastructure.js";
import type { EffectPostState, EffectReconciler } from "../../src/autonomy/effect-reconciler.js";
import { GovernedExecutionSurface } from "../../src/autonomy/effect-reconciler.js";
import {
  assertRoleInvocationPermitted,
  mintRoleInvocationManifest,
  type RoleManifestInput,
  roleInvocationFacts,
} from "../../src/autonomy/role-manifest.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { runTaskAuditor } from "../../src/autonomy/task-auditor.js";
import { runTaskExecutor } from "../../src/autonomy/task-executor.js";
import { TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * Manager -> fresh Executor -> independent read-only Auditor.
 *
 * The point of separating the roles is that none of them can quietly become the others. The
 * Executor cannot decide it is finished, the Auditor cannot be handed the Executor's reasoning, and
 * neither can adjust what success meant once the work exists.
 */
const taskId = TaskId.parse("task:roles");
const jobId = JobId.parse("job:1");
const projectId = ProjectId.parse("project:1");
const modelId = "qwen-role:14b";
const T0 = "2026-08-27T00:00:00.000Z";
const HARNESS_VERSION = "v31m4-autonomy-1.1.0";

const isolation = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const resourceBudget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 8,
  maxToolInvocations: 8,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});
const budget: AgentTurnBudget = Object.freeze({
  maxTurns: 4,
  maxToolCalls: 3,
  maxDefers: 1,
  maxRefusedTurns: 2,
  maxNoProgressTurns: 1,
  maxPromptBytes: 131_072,
  maxPromptTokens: 32_768,
});

const inspect: AgentTurnProposal = Object.freeze({
  kind: "tool_call",
  operation: "code.inspect",
  parameters: { pathScope: ["target.ts"] },
});
const finish: AgentTurnProposal = Object.freeze({
  kind: "finish",
  summary: "target.ts inspected and ready for verification",
});

class ScriptedGateway implements AgentModelGatewayPort {
  public readonly requests: AgentTurnInvocationRequest[] = [];
  constructor(private readonly script: readonly AgentTurnProposal[]) {}
  async list(): Promise<never> {
    throw new Error("unused");
  }
  async get() {
    return null;
  }
  async invoke(): Promise<never> {
    throw new Error("a role harness must never use the legacy invocation path");
  }
  async cancel() {}
  async health(): Promise<never> {
    throw new Error("unused");
  }
  async invokeAgentTurn(request: AgentTurnInvocationRequest): Promise<AgentTurnInvocationResult> {
    this.requests.push(request);
    const turn = this.script[this.requests.length - 1];
    if (turn === undefined) throw new Error("the loop asked for an unscripted turn");
    return Object.freeze({
      invocationId: request.invocationId,
      modelId: request.modelId,
      outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
      turn,
      usage: { wallClockMs: 4 },
      metadata: {},
    }) as AgentTurnInvocationResult;
  }
}

class CountingBackend extends ReferenceSandboxBackend {
  executions = 0;
  override async execute(...args: Parameters<ReferenceSandboxBackend["execute"]>) {
    this.executions += 1;
    return super.execute(...args);
  }
}

class FixedWorkspaces {
  async create(): Promise<WorkspaceHandle> {
    throw new Error("unused");
  }
  async get(id: string): Promise<WorkspaceHandle | null> {
    return id === workspace.id ? workspace : null;
  }
  async snapshot(): Promise<never> {
    throw new Error("unused");
  }
  async seal(): Promise<WorkspaceHandle> {
    return workspace;
  }
  async discard(): Promise<void> {}
}

const policy: PolicyEnginePort = {
  async evaluate() {
    return { decision: "allow", policyId: "policy:roles", reasons: [], requiredApprovalScopes: [] };
  },
};

const applied = async (): Promise<EffectPostState> =>
  Object.freeze({
    kind: "applied" as const,
    facts: [
      {
        resourceKind: "workspace_file",
        locator: "target.ts",
        fingerprint: ContentHash.parse(sha256Hex("observed")),
      },
    ],
  });

let database: SqliteRuntimeDatabase;
let databasePath: string;
let root: string;
let workspace: WorkspaceHandle;
let ledger: SqliteExecutionLedgerRepository;
let capsules: SqliteTaskCapsuleRepository;
let evidence: SqliteEvidenceRepository;
let tasks: TaskManager;
let surface: GovernedExecutionSurface;
let reconciler: EffectReconciler;
let sandbox: SandboxHandle;
let backend: CountingBackend;
let capsule: TaskCapsule;
let snapshot: EntryAcceptanceSnapshot;
let entryCounter = 0;
let contextRequests: unknown[];

function nextEntry(): string {
  entryCounter += 1;
  return `ledger:${entryCounter}`;
}

async function buildContext(request: unknown): Promise<AgentTurnContext> {
  contextRequests.push(request);
  const body = JSON.stringify(request);
  return Object.freeze({
    promptArtifactId: `artifact-role-${contextRequests.length}` as never,
    promptBytes: Buffer.byteLength(body),
    promptTokens: Math.ceil(Buffer.byteLength(body) / 4),
    contextFingerprint: ContentHash.parse(sha256Hex(body)),
  });
}

async function wire(db: SqliteRuntimeDatabase): Promise<void> {
  ledger = new SqliteExecutionLedgerRepository(db);
  capsules = new SqliteTaskCapsuleRepository(db);
  evidence = new SqliteEvidenceRepository(db);
  tasks = new TaskManager({ unitOfWork: db.unitOfWork, capsules, evidence });
  backend = new CountingBackend();
  surface = GovernedExecutionSurface.create({
    policy,
    backend,
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces()),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
    now: () => T0,
  });
  sandbox = await surface.sandboxes.prepare(
    taskId,
    jobId,
    workspace,
    resourceBudget,
    isolation,
    context,
  );
  reconciler = surface.createEffectReconciler({
    unitOfWork: db.unitOfWork,
    ledger,
    generateEntryId: nextEntry,
    now: () => T0,
  });
}

beforeEach(async () => {
  entryCounter = 0;
  contextRequests = [];
  root = mkdtempSync(join(tmpdir(), "v31m4-roles-"));
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
  const created = await tasks.createTask(
    {
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
    },
    context,
  );
  capsule = created.capsule;
  snapshot = freezeEntryAcceptanceSnapshot({
    capsule,
    requiredChecks: ["build.check"],
    requiredEvidenceKinds: ["unit_test"],
    riskPolicyIds: [],
    workspaceFingerprint: null,
    frozenAt: T0,
  });
});

afterEach(() => {
  database.close();
});

function manifestInput(overrides: Partial<RoleManifestInput> = {}): RoleManifestInput {
  return {
    role: "executor",
    taskId,
    capsuleFingerprint: capsule.fingerprint,
    contextFingerprint: ContentHash.parse(sha256Hex("context")),
    modelId: modelId as never,
    allowedOperations: ["code.inspect"],
    skillVersions: ["skill:none@1.0.0"],
    harnessVersion: HARNESS_VERSION,
    acceptanceContractFingerprint: snapshot.contractFingerprint,
    ...overrides,
  };
}

function executorDependencies(gateway: AgentModelGatewayPort) {
  return {
    gateway,
    surface,
    reconciler,
    tasks,
    ledger,
    unitOfWork: database.unitOfWork,
    buildContext,
    generateEntryId: nextEntry,
    generateInvocationId: (turnIndex: number) => `invocation-role-${turnIndex}`,
    now: () => T0,
  };
}

function executorRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    jobId,
    modelId: modelId as never,
    snapshot,
    capsuleFingerprint: capsule.fingerprint,
    allowedOperations: ["code.inspect"] as const,
    skillVersions: ["skill:none@1.0.0"],
    harnessVersion: HARNESS_VERSION,
    reasoningPolicy: "disabled" as const,
    budget,
    resourceBudget,
    workspace,
    sandbox,
    probe: applied,
    ...overrides,
  };
}

// ===========================================================================
// Role manifests
// ===========================================================================
describe("a role manifest is minted, not asserted", () => {
  it("carries the full context, model, skill, and harness identity", () => {
    const manifest = mintRoleInvocationManifest(manifestInput());
    expect(manifest).toMatchObject({
      role: "executor",
      taskId,
      capsuleFingerprint: capsule.fingerprint,
      modelId,
      harnessVersion: HARNESS_VERSION,
      readOnly: false,
      acceptanceContractFingerprint: snapshot.contractFingerprint,
    });
    expect(manifest.manifestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.allowedOperations)).toBe(true);
  });

  it("derives read-only from the role rather than believing the caller", () => {
    expect(mintRoleInvocationManifest(manifestInput({ role: "auditor" })).readOnly).toBe(true);
    expect(mintRoleInvocationManifest(manifestInput({ role: "manager" })).readOnly).toBe(true);
    expect(mintRoleInvocationManifest(manifestInput({ role: "executor" })).readOnly).toBe(false);
  });

  it("refuses any write, execute, or network-effect operation for a read-only role", () => {
    for (const operation of ["code.patch", "build.check", "test.regression", "command.run"]) {
      expect(() =>
        mintRoleInvocationManifest(
          manifestInput({ role: "auditor", allowedOperations: [operation as never] }),
        ),
      ).toThrow(ApplicationError);
    }
  });

  it("refuses an operation outside the closed catalog or outside the role's own permissions", () => {
    expect(() =>
      mintRoleInvocationManifest(manifestInput({ allowedOperations: ["git.worktree" as never] })),
    ).toThrow(ApplicationError);
    expect(() =>
      mintRoleInvocationManifest(
        manifestInput({ role: "auditor", allowedOperations: ["code.patch" as never] }),
      ),
    ).toThrow(ApplicationError);
    expect(() => mintRoleInvocationManifest(manifestInput({ allowedOperations: [] }))).toThrow(
      ApplicationError,
    );
  });

  it("fingerprints the manifest deterministically and independently of declaration order", () => {
    const a = mintRoleInvocationManifest(
      manifestInput({ allowedOperations: ["code.inspect", "git.status"] }),
    );
    const b = mintRoleInvocationManifest(
      manifestInput({ allowedOperations: ["git.status", "code.inspect"] }),
    );
    expect(a.manifestFingerprint).toBe(b.manifestFingerprint);
    const different = mintRoleInvocationManifest(manifestInput({ role: "auditor" }));
    expect(different.manifestFingerprint).not.toBe(a.manifestFingerprint);
  });

  it("exposes the same permission check the harness uses before any run", () => {
    expect(() => assertRoleInvocationPermitted("auditor", ["code.patch" as never])).toThrow();
    expect(() => assertRoleInvocationPermitted("auditor", ["git.status"])).not.toThrow();
  });

  it("describes itself as ordinary resource facts a ledger observation can carry", () => {
    const facts = roleInvocationFacts(mintRoleInvocationManifest(manifestInput()));
    expect(facts.map((fact) => fact.resourceKind).sort()).toEqual([
      "acceptance_contract",
      "agent_context",
      "role_manifest",
      "task_capsule",
    ]);
    for (const fact of facts) expect(fact.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
});

// ===========================================================================
// Executor
// ===========================================================================
describe("the Executor works inside a fresh bounded context and cannot complete", () => {
  it("runs the governed loop and records the role invocation as ordinary history", async () => {
    const gateway = new ScriptedGateway([inspect, finish]);
    const result = await runTaskExecutor(executorDependencies(gateway), executorRequest(), context);
    expect(result.outcome.kind).toBe("ready_for_verification");
    expect(result.manifest.role).toBe("executor");
    expect(result.manifest.contextFingerprint).toBe(result.outcome.turns[0]?.contextFingerprint);
    const page = await ledger.listForTask(taskId, { limit: 100 }, context);
    const observation = page.items.find((entry) => entry.kind === "observation");
    expect(observation).toBeDefined();
    expect(
      observation?.kind === "observation"
        ? observation.facts.map((fact) => fact.resourceKind).sort()
        : [],
    ).toEqual(["acceptance_contract", "agent_context", "role_manifest", "task_capsule"]);
  });

  it("offers the model only the manifest's operations", async () => {
    const gateway = new ScriptedGateway([finish]);
    await runTaskExecutor(executorDependencies(gateway), executorRequest(), context);
    expect(gateway.requests[0]?.allowedOperations).toEqual(["code.inspect"]);
  });

  it("returns readiness, never completion: the capsule is untouched", async () => {
    const gateway = new ScriptedGateway([inspect, finish]);
    const result = await runTaskExecutor(executorDependencies(gateway), executorRequest(), context);
    expect(Object.keys(result)).not.toContain("accepted");
    const current = await tasks.loadCurrent(taskId, context);
    expect(current?.capsule.phase).toBe("execute");
    expect(current?.capsule.capsuleRevision).toBe(capsule.capsuleRevision);
  });

  it("refuses to start against a contract it was not dispatched with", async () => {
    const gateway = new ScriptedGateway([finish]);
    await expect(
      runTaskExecutor(
        executorDependencies(gateway),
        executorRequest({
          expectedContractFingerprint: ContentHash.parse(sha256Hex("other")),
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
    expect(gateway.requests).toHaveLength(0);
  });
});

// ===========================================================================
// Auditor
// ===========================================================================
describe("the Auditor is independent, fresh, and read-only", () => {
  async function satisfyContract(): Promise<void> {
    const record = EvidenceRecord.create({
      id: "evidence:one",
      projectId: "project:1",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "acceptance_criterion",
      subjectId: "requirement:one",
      status: "passed",
      summary: "requirement:one verified",
      artifactIds: ["artifact-evidence-one"],
      verifierId: "verifier:deterministic",
      verifierVersion: "1.0.0",
      createdAt: T0,
    });
    await database.unitOfWork.execute(context, async (transaction) => {
      await evidence.append(record, context, transaction);
      await ledger.append(
        ExecutionLedgerEntry.create({
          id: nextEntry(),
          taskId: "task:roles",
          jobId: "job:1",
          recordedAt: T0,
          kind: "check_result",
          checkName: "build.check",
          passed: true,
          detail: "build.check passed",
          facts: [
            {
              resourceKind: "check_report",
              locator: "reports/build.check.json",
              fingerprint: sha256Hex("build-report"),
            },
          ],
        }),
        context,
        transaction,
      );
    });
    const current = await tasks.loadCurrent(taskId, context);
    if (current === null) throw new Error("missing capsule");
    const moved = await tasks.proposeTransition(
      {
        taskId: "task:roles",
        expectedHeadRevision: current.head.revision,
        expectedCapsuleRevision: current.capsule.capsuleRevision,
        from: "execute",
        to: "verify",
        evidenceIds: [],
        reason: "the executor declared readiness",
      },
      { verifiedEvidenceIds: ["evidence:one"], updatedAt: T0 },
      context,
    );
    capsule = moved.capsule;
  }

  function auditorRequest(overrides: Record<string, unknown> = {}) {
    return {
      taskId,
      jobId,
      modelId: modelId as never,
      snapshot,
      expectedContractFingerprint: snapshot.contractFingerprint,
      allowedOperations: ["code.inspect", "git.status"] as const,
      skillVersions: ["skill:none@1.0.0"],
      harnessVersion: HARNESS_VERSION,
      currentFingerprints: { "reports/build.check.json": sha256Hex("build-report") },
      changedPaths: [],
      executorOutcome: "ready_for_verification" as const,
      ...overrides,
    };
  }

  function auditorDependencies() {
    return { evidence, ledger, tasks, unitOfWork: database.unitOfWork, now: () => T0 };
  }

  /** The full governed wiring an advisory model pass needs; partial wiring is refused. */
  function advisoryWiring(gateway: AgentModelGatewayPort) {
    return {
      gateway,
      surface,
      reconciler,
      buildContext,
      budget,
      resourceBudget,
      workspace,
      sandbox,
      generateEntryId: nextEntry,
      probe: applied,
    };
  }

  it("refuses an advisory pass that is only half wired", async () => {
    await expect(
      runTaskAuditor(
        { ...auditorDependencies(), gateway: new ScriptedGateway([finish]), budget },
        auditorRequest(),
        context,
      ),
    ).rejects.toMatchObject({ code: "INVALID_APPLICATION_INPUT" });
  });

  it("accepts only a genuinely satisfied contract", async () => {
    await satisfyContract();
    const result = await runTaskAuditor(auditorDependencies(), auditorRequest(), context);
    expect(result.verdict.kind).toBe("accepted");
    expect(result.manifest.role).toBe("auditor");
    expect(result.manifest.readOnly).toBe(true);
  });

  it("independently rejects an Executor finish that the contract does not support", async () => {
    const result = await runTaskAuditor(auditorDependencies(), auditorRequest(), context);
    expect(result.verdict.kind).toBe("rejected");
    expect(result.verdict.reasons.join(" ")).toMatch(/build\.check|requirement:one/u);
  });

  it("receives a separate fresh context that structurally cannot carry Executor turns", async () => {
    await satisfyContract();
    const gateway = new ScriptedGateway([finish]);
    contextRequests = [];
    const result = await runTaskAuditor(
      { ...auditorDependencies(), ...advisoryWiring(gateway) },
      auditorRequest(),
      context,
    );
    expect(result.verdict.kind).toBe("accepted");
    const audited = JSON.stringify(contextRequests);
    for (const forbidden of ["ready for verification", "reasoning", "thinking", "turns"]) {
      expect(audited).not.toMatch(new RegExp(forbidden, "iu"));
    }
    // The auditor's context is its own; it never reuses the artifact the executor was given.
    expect(gateway.requests[0]?.promptArtifactId).toBe("artifact-role-1");
  });

  it("cannot be talked out of a deterministic rejection by a model turn", async () => {
    const gateway = new ScriptedGateway([finish]);
    const result = await runTaskAuditor(
      { ...auditorDependencies(), ...advisoryWiring(gateway) },
      auditorRequest(),
      context,
    );
    // The model said it was fine. The deterministic verdict is the one that counts.
    expect(result.advisory?.kind).toBe("ready_for_verification");
    expect(result.verdict.kind).toBe("rejected");
  });

  it("holds no write, execute, or network-effect operation however it is asked", async () => {
    for (const operation of ["code.patch", "command.run", "test.regression"]) {
      await expect(
        runTaskAuditor(
          auditorDependencies(),
          auditorRequest({ allowedOperations: [operation] }),
          context,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("rejects a contract that was weakened after the work was seen", async () => {
    await satisfyContract();
    const weakerSnapshot = freezeEntryAcceptanceSnapshot({
      capsule,
      requiredChecks: ["build.check"],
      requiredEvidenceKinds: ["unit_test"],
      riskPolicyIds: [],
      workspaceFingerprint: null,
      frozenAt: T0,
    });
    // Dispatching against the weaker contract while claiming the original's fingerprint fails.
    await expect(
      runTaskAuditor(
        auditorDependencies(),
        auditorRequest({
          snapshot: weakerSnapshot,
          expectedContractFingerprint: snapshot.contractFingerprint,
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });
});

// ===========================================================================
// Restart safety at both handoffs
// ===========================================================================
describe("the handoff survives a restart because it is derived, not remembered", () => {
  it("re-derives the identical Manager selection from a reopened database", async () => {
    const { selectNextTask } = await import("@v31m4/application");
    const command = {
      taskId,
      requiredChecks: ["build.check"],
      requiredEvidenceKinds: ["unit_test"] as const,
      riskPolicyIds: [],
      workspaceFingerprint: null,
      currentFingerprints: {},
      frozenAt: T0,
    };
    const before = await selectNextTask({ capsules, ledger }, command, context);
    database.close();
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);
    const after = await selectNextTask({ capsules, ledger }, command, context);
    expect(after.snapshot.contractFingerprint).toBe(before.snapshot.contractFingerprint);
    expect(after.selectedNodeId).toBe(before.selectedNodeId);
    expect(after.route).toEqual(before.route);
  });

  it("re-derives the identical audit verdict after an Executor-to-Auditor restart", async () => {
    const gateway = new ScriptedGateway([inspect, finish]);
    const executed = await runTaskExecutor(
      executorDependencies(gateway),
      executorRequest(),
      context,
    );
    expect(executed.outcome.kind).toBe("ready_for_verification");

    database.close();
    database = new SqliteRuntimeDatabase(databasePath);
    await wire(database);

    const auditorRequest = {
      taskId,
      jobId,
      modelId: modelId as never,
      snapshot,
      expectedContractFingerprint: snapshot.contractFingerprint,
      allowedOperations: ["code.inspect"] as const,
      skillVersions: ["skill:none@1.0.0"],
      harnessVersion: HARNESS_VERSION,
      currentFingerprints: {},
      changedPaths: [],
      executorOutcome: "ready_for_verification" as const,
    };
    const deps = { evidence, ledger, tasks, unitOfWork: database.unitOfWork, now: () => T0 };
    const first = await runTaskAuditor(deps, auditorRequest, context);
    const second = await runTaskAuditor(deps, auditorRequest, context);
    expect(first.verdict).toEqual(second.verdict);
    expect(first.verdict.contractFingerprint).toBe(snapshot.contractFingerprint);
    expect(first.verdict.kind).toBe("rejected");
  });
});
