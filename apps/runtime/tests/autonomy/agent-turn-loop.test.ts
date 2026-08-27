import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentModelGatewayPort,
  type AgentTurnInvocationRequest,
  type AgentTurnInvocationResult,
  type AgentTurnProposal,
  ApplicationError,
  type PolicyDecision,
  type PolicyEnginePort,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type WorkspaceHandle,
} from "@v31m4/application";
import { AGENT_TURN_CONTRACT_VERSION } from "@v31m4/contracts";
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
  type SandboxExecutionSpec,
  type SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentTurnBudget,
  type AgentTurnContext,
  runAgentTurnLoop,
} from "../../src/autonomy/agent-turn-loop.js";
import type { GovernedSandboxLifecycle } from "../../src/autonomy/authority-capture.js";
import {
  SqliteExecutionLedgerRepository,
  SqliteTaskCapsuleRepository,
} from "../../src/autonomy/autonomy-state-infrastructure.js";
import type { EffectPostState, EffectReconciler } from "../../src/autonomy/effect-reconciler.js";
import { GovernedExecutionSurface } from "../../src/autonomy/effect-reconciler.js";
import { PRECONDITION_RESOURCE_KINDS } from "../../src/autonomy/evidence-precondition-catalog.js";
import { createEvidencePreconditionGate } from "../../src/autonomy/evidence-precondition-gate.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * The governed iterative runtime loop.
 *
 * Everything here is about one property: model output is an untrusted proposal, and nothing
 * reaches the environment that the runtime did not itself validate, authorize, and record. The
 * loop is driven by a scripted gateway so every refusal path is exercised deterministically, and
 * a counting sandbox backend proves that a refused turn produced no execution at all.
 */
const taskId = TaskId.parse("task:agent");
const jobId = JobId.parse("job:1");
const projectId = ProjectId.parse("project:1");
const modelId = "qwen-agent:27b";
const T0 = "2026-08-26T00:00:00.000Z";

const isolation = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const resourceBudget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 8,
  maxToolInvocations: 8,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});

const budget: AgentTurnBudget = Object.freeze({
  maxTurns: 6,
  maxToolCalls: 4,
  maxDefers: 1,
  maxRefusedTurns: 2,
  maxNoProgressTurns: 1,
  maxPromptBytes: 131_072,
  maxPromptTokens: 32_768,
});

const capsuleDraft = {
  taskId: "task:agent",
  jobId: "job:1",
  projectId: "project:1",
  objective: "Prove the governed agent-turn loop.",
  phase: "execute" as const,
  dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
  // Entering `execute` spends an attempt, so a capsule created directly in it accounts for one.
  attempts: 1,
  maxAttempts: 3,
  stopCondition: "stop after three attempts",
  updatedAt: T0,
};

const inspect = (scope: string): AgentTurnProposal =>
  Object.freeze({
    kind: "tool_call" as const,
    operation: "code.inspect",
    parameters: { pathScope: [scope] },
  });
const finish = (summary: string): AgentTurnProposal =>
  Object.freeze({ kind: "finish" as const, summary });
const defer = (reason: string): AgentTurnProposal =>
  Object.freeze({ kind: "defer" as const, reason });

/** A model that answers from a script. Anything not scripted is a test defect, not a fallback. */
class ScriptedGateway implements AgentModelGatewayPort {
  public readonly requests: AgentTurnInvocationRequest[] = [];
  constructor(private readonly script: readonly unknown[]) {}
  async list(): Promise<never> {
    throw new Error("unused");
  }
  async get() {
    return null;
  }
  async invoke(): Promise<never> {
    throw new Error("the agent loop must never use the legacy invocation path");
  }
  async cancel() {}
  async health(): Promise<never> {
    throw new Error("unused");
  }
  async invokeAgentTurn(request: AgentTurnInvocationRequest): Promise<AgentTurnInvocationResult> {
    this.requests.push(request);
    const scripted = this.script[this.requests.length - 1];
    if (scripted === undefined) throw new Error("the loop asked for an unscripted turn");
    const { __result: overrides = {}, ...turn } = scripted as Record<string, unknown>;
    return Object.freeze({
      invocationId: request.invocationId,
      modelId: request.modelId,
      outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
      turn: turn as AgentTurnProposal,
      usage: { inputTokens: 10, outputTokens: 5, wallClockMs: 12 },
      metadata: {},
      ...(overrides as Record<string, unknown>),
    }) as AgentTurnInvocationResult;
  }
}

/** A gateway that fails instead of answering, the way a refusing adapter does. */
class FailingGateway extends ScriptedGateway {
  constructor(private readonly failures: readonly (ApplicationError | null)[]) {
    super([]);
  }
  override async invokeAgentTurn(
    request: AgentTurnInvocationRequest,
  ): Promise<AgentTurnInvocationResult> {
    this.requests.push(request);
    const failure = this.failures[this.requests.length - 1];
    if (failure instanceof ApplicationError) throw failure;
    return Object.freeze({
      invocationId: request.invocationId,
      modelId: request.modelId,
      outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
      turn: finish("ready"),
      usage: { wallClockMs: 3 },
      metadata: {},
    }) as AgentTurnInvocationResult;
  }
}

class CountingBackend extends ReferenceSandboxBackend {
  executions = 0;
  override async execute(spec: SandboxExecutionSpec, plan: never) {
    this.executions += 1;
    return super.execute(spec, plan);
  }
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

let decision: PolicyDecision;
const policy: PolicyEnginePort = {
  async evaluate() {
    return { decision, policyId: "policy:agent", reasons: [], requiredApprovalScopes: [] };
  },
};

let database: SqliteRuntimeDatabase;
let root: string;
let workspace: WorkspaceHandle;
let ledger: SqliteExecutionLedgerRepository;
let capsules: SqliteTaskCapsuleRepository;
let evidence: SqliteEvidenceRepository;
let tasks: TaskManager;
let surface: GovernedExecutionSurface;
let reconciler: EffectReconciler;
let sandboxes: GovernedSandboxLifecycle;
let sandbox: SandboxHandle;
let backend: CountingBackend;
let entryCounter = 0;
let contextBytes = 4_096;
let contextTokens = 512;
let contextBuilds = 0;

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

/**
 * The context source. It is handed the authoritative capsule and the folded Ledger every turn and
 * fingerprints exactly those, so a test can prove the context really is rebuilt from durable state
 * rather than carried forward from the previous turn.
 */
async function buildContext(request: {
  readonly turnIndex: number;
  readonly capsule: { readonly capsuleRevision: number; readonly phase: string };
  readonly projection: { readonly attempts: readonly unknown[] };
}): Promise<AgentTurnContext> {
  contextBuilds += 1;
  return Object.freeze({
    promptArtifactId: `artifact-agent-context-${request.turnIndex}` as never,
    promptBytes: contextBytes,
    promptTokens: contextTokens,
    contextFingerprint: ContentHash.parse(
      sha256Hex(
        `${request.capsule.capsuleRevision}:${request.capsule.phase}:${request.projection.attempts.length}`,
      ),
    ),
  });
}

async function runWith<Gateway extends AgentModelGatewayPort>(
  gateway: Gateway,
  overrides: Partial<AgentTurnBudget> = {},
) {
  const outcome = await runAgentTurnLoop(
    {
      gateway,
      surface,
      reconciler,
      tasks,
      ledger,
      unitOfWork: database.unitOfWork,
      buildContext,
      // These runs use only ungated reads, so what the ledger recorded is what is observed now.
      observeResources: observeLedgerFacts,
      generateEntryId: () => `ledger:${++entryCounter}`,
      generateInvocationId: (turnIndex: number) => `invocation-agent-${turnIndex}`,
      now: () => T0,
    },
    {
      taskId,
      jobId,
      modelId: modelId as never,
      role: "executor",
      allowedOperations: ["code.inspect", "git.status", "repo.search"],
      reasoningPolicy: "disabled",
      budget: { ...budget, ...overrides },
      resourceBudget,
      workspace,
      sandbox,
      probe: applied,
    },
    context,
  );
  return { outcome, gateway };
}

async function run(script: readonly unknown[], overrides: Partial<AgentTurnBudget> = {}) {
  return runWith(new ScriptedGateway(script), overrides);
}

async function ledgerKinds(): Promise<readonly string[]> {
  const page = await ledger.listForTask(taskId, { limit: 500 }, context);
  return page.items.map((entry) => entry.kind);
}

/** Everything the ledger recorded, treated as current: these runs never rewrite the world. */
async function observeLedgerFacts(
  taskId: Parameters<typeof ledger.listForTask>[0],
): Promise<Record<string, string>> {
  const page = await ledger.listForTask(taskId, { limit: 200 }, context);
  const current: Record<string, string> = {};
  for (const entry of page.items) {
    if (entry.kind !== "observation" && entry.kind !== "check_result") continue;
    for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
  }
  return current;
}

beforeEach(async () => {
  decision = "allow";
  entryCounter = 0;
  contextBytes = 4_096;
  contextTokens = 512;
  contextBuilds = 0;
  root = mkdtempSync(join(tmpdir(), "v31m4-agent-loop-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  writeFileSync(join(root, "other.ts"), "export const other = 2;\n", "utf8");
  workspace = Object.freeze({
    id: "workspace-1",
    projectId,
    purpose: "tool_execution" as const,
    rootPath: SafePath.parse("workspace-1"),
    status: "active" as const,
    createdAt: T0,
  });
  database = runtimeDatabase();
  ledger = new SqliteExecutionLedgerRepository(database);
  capsules = new SqliteTaskCapsuleRepository(database);
  evidence = new SqliteEvidenceRepository(database);
  tasks = new TaskManager({ unitOfWork: database.unitOfWork, capsules, evidence });
  await tasks.createTask(capsuleDraft, context);
  backend = new CountingBackend();
  surface = GovernedExecutionSurface.create({
    policy,
    // The real gate over this test's own authoritative stores: nothing here is stubbed out.
    preconditions: createEvidencePreconditionGate({ capsules, ledger, evidence }),
    backend,
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces(workspace)),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
    now: () => T0,
  });
  sandboxes = surface.sandboxes;
  sandbox = await sandboxes.prepare(taskId, jobId, workspace, resourceBudget, isolation, context);
  reconciler = surface.createEffectReconciler({
    unitOfWork: database.unitOfWork,
    ledger,
    generateEntryId: () => `ledger:${++entryCounter}`,
    now: () => T0,
  });
});

afterEach(() => {
  database.close();
});

// ===========================================================================
// The loop shape: authoritative context -> turn -> validate -> govern -> record
// ===========================================================================
describe("the runtime owns the loop", () => {
  it("rebuilds context from authoritative state before every turn", async () => {
    const { outcome, gateway } = await run([inspect("target.ts"), finish("ready")]);
    expect(outcome.kind).toBe("ready_for_verification");
    expect(contextBuilds).toBe(2);
    // Turn two saw a context fingerprint that the first turn's recorded effect changed.
    expect(outcome.turns[0]?.contextFingerprint).not.toBe(outcome.turns[1]?.contextFingerprint);
    expect(gateway.requests.map((request) => request.promptArtifactId)).toEqual([
      "artifact-agent-context-0",
      "artifact-agent-context-1",
    ]);
  });

  it("hands the model only the role manifest, the output contract, and a bounded budget", async () => {
    const { gateway } = await run([finish("ready")]);
    const request = gateway.requests[0];
    expect(request?.allowedOperations).toEqual(["code.inspect", "git.status", "repo.search"]);
    expect(request?.outputContractVersion).toBe(AGENT_TURN_CONTRACT_VERSION);
    expect(request?.reasoningPolicy).toBe("disabled");
    expect(request?.contextBudget).toEqual({ maxPromptBytes: 131_072, maxPromptTokens: 32_768 });
    expect(request?.taskId).toBe(taskId);
  });

  it("records an accepted tool call as governed Ledger history", async () => {
    const { outcome } = await run([inspect("target.ts"), finish("ready")]);
    expect(backend.executions).toBe(1);
    expect(await ledgerKinds()).toEqual(["effect_attempt", "effect_confirmation"]);
    expect(outcome.turns[0]).toMatchObject({
      kind: "tool_call",
      operation: "code.inspect",
      accepted: true,
      outcomeKind: "effect_confirmation",
    });
    expect(outcome.turns[0]?.attemptEntryId).not.toBeNull();
  });
});

// ===========================================================================
// finish is not success
// ===========================================================================
describe("finish declares readiness, never success", () => {
  it("returns ready_for_verification and certifies nothing", async () => {
    const { outcome } = await run([finish("the failing test now passes")]);
    expect(outcome).toMatchObject({
      kind: "ready_for_verification",
      summary: "the failing test now passes",
    });
    expect(Object.keys(outcome)).not.toContain("success");
    expect(Object.keys(outcome)).not.toContain("accepted");
    // No transition was proposed and no evidence was created on the model's word.
    const current = await tasks.loadCurrent(taskId, context);
    expect(current?.capsule.phase).toBe("execute");
    expect(current?.capsule.capsuleRevision).toBe(1);
  });
});

// ===========================================================================
// Bounded defer
// ===========================================================================
describe("defer is bounded", () => {
  it("stops on the deferral budget rather than re-asking for ever", async () => {
    const { outcome, gateway } = await run([defer("no reproduction yet"), finish("unreachable")]);
    expect(outcome).toMatchObject({ kind: "deferred", reason: "no reproduction yet" });
    expect(gateway.requests).toHaveLength(1);
  });

  it("may rebuild context and try again when more than one deferral is allowed", async () => {
    const { outcome, gateway } = await run(
      [defer("no reproduction yet"), inspect("target.ts"), finish("ready")],
      { maxDefers: 2 },
    );
    expect(outcome.kind).toBe("ready_for_verification");
    expect(gateway.requests).toHaveLength(3);
  });
});

// ===========================================================================
// Runtime revalidation of every model-produced turn
// ===========================================================================
describe("the runtime revalidates every turn the adapter already validated", () => {
  it("refuses a malformed turn without reaching the environment", async () => {
    const { outcome } = await run([
      { kind: "tool_call", operation: "code.inspect" },
      { kind: "finish" },
    ]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "REFUSED_TURN_BUDGET_EXHAUSTED" });
    expect(outcome.turns.every((turn) => turn.refusal === "MALFORMED_TURN")).toBe(true);
    expect(backend.executions).toBe(0);
  });

  it("refuses a turn carrying private reasoning instead of recording it", async () => {
    const { outcome } = await run([
      { kind: "finish", summary: "done", reasoning: "first I ..." },
      { kind: "tool_call", operation: "code.inspect", parameters: { thinking: "then I ..." } },
    ]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "REFUSED_TURN_BUDGET_EXHAUSTED" });
    expect(outcome.turns.every((turn) => turn.refusal === "MALFORMED_TURN")).toBe(true);
    // The refusal itself is recorded — that is the point — but none of the reasoning text is.
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    const recorded = JSON.stringify(page.items);
    expect(recorded).not.toMatch(/first I \.\.\.|then I \.\.\./u);
    expect(recorded).toMatch(/MALFORMED_TURN/u);
    for (const turn of outcome.turns) {
      expect(JSON.stringify(turn)).not.toMatch(/first I \.\.\.|then I \.\.\./u);
    }
  });

  it("refuses a turn whose output contract is not the one the runtime asked for", async () => {
    const { outcome } = await run([
      { ...finish("ready"), __result: { outputContractVersion: "1.1.0" } },
      finish("ready"),
    ]);
    expect(outcome.turns[0]?.refusal).toBe("OUTPUT_CONTRACT_MISMATCH");
    expect(outcome.kind).toBe("ready_for_verification");
  });

  it("refuses an operation outside the closed catalog", async () => {
    const { outcome } = await run([
      { kind: "tool_call", operation: "git.worktree", parameters: {} },
      finish("ready"),
    ]);
    expect(outcome.turns[0]?.refusal).toBe("UNKNOWN_OPERATION");
    expect(backend.executions).toBe(0);
  });

  it("refuses an operation the role manifest did not offer", async () => {
    const { outcome } = await run([
      {
        kind: "tool_call",
        operation: "command.run",
        parameters: { executable: "sh", arguments: [] },
      },
      finish("ready"),
    ]);
    expect(outcome.turns[0]?.refusal).toBe("OPERATION_NOT_ALLOWED");
    expect(backend.executions).toBe(0);
  });

  it("refuses a write operation proposed by a non-executor role", async () => {
    const gateway = new ScriptedGateway([
      {
        kind: "tool_call",
        operation: "code.patch",
        parameters: {
          expectedFingerprint: sha256Hex("before"),
          targetPath: "target.ts",
          pathScope: ["target.ts"],
          patch: "@@",
        },
      },
      finish("ready"),
    ]);
    const outcome = await runAgentTurnLoop(
      {
        gateway,
        surface,
        reconciler,
        tasks,
        ledger,
        unitOfWork: database.unitOfWork,
        buildContext,
        observeResources: observeLedgerFacts,
        generateEntryId: () => `ledger:${++entryCounter}`,
        generateInvocationId: (turnIndex: number) => `invocation-agent-${turnIndex}`,
        now: () => T0,
      },
      {
        taskId,
        jobId,
        modelId: modelId as never,
        role: "auditor",
        allowedOperations: ["code.patch", "git.status"],
        reasoningPolicy: "auto",
        budget,
        resourceBudget,
        workspace,
        sandbox,
        probe: applied,
      },
      context,
    );
    expect(outcome.turns[0]?.refusal).toBe("OPERATION_NOT_ALLOWED");
    expect(backend.executions).toBe(0);
  });

  it("refuses parameters the authorization boundary rejects", async () => {
    const { outcome } = await run([
      { kind: "tool_call", operation: "code.inspect", parameters: { executable: "sh" } },
      finish("ready"),
    ]);
    expect(outcome.turns[0]?.refusal).toBe("AUTHORIZATION_REFUSED");
    expect(backend.executions).toBe(0);
  });

  it("refuses everything once policy denies, without executing", async () => {
    decision = "deny";
    const { outcome } = await run([inspect("target.ts"), inspect("other.ts")]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "REFUSED_TURN_BUDGET_EXHAUSTED" });
    expect(outcome.turns.every((turn) => turn.refusal === "AUTHORIZATION_REFUSED")).toBe(true);
    expect(backend.executions).toBe(0);
  });

  it("writes every refusal into durable history so the rebuilt context can see it", async () => {
    const { outcome } = await run([
      { kind: "tool_call", operation: "git.worktree", parameters: {} },
      finish("ready"),
    ]);
    expect(outcome.kind).toBe("ready_for_verification");
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    expect(page.items.map((entry) => entry.kind)).toEqual(["failure"]);
    expect(page.items[0]).toMatchObject({ kind: "failure", attemptEntryId: null });
  });
});

// ===========================================================================
// Budgets
// ===========================================================================
describe("bounded turns, tools, and context", () => {
  it("stops on the turn budget", async () => {
    const { outcome } = await run(
      [inspect("target.ts"), inspect("other.ts"), inspect("target.ts")],
      { maxTurns: 2, maxNoProgressTurns: 5, maxRefusedTurns: 5 },
    );
    expect(outcome).toMatchObject({ kind: "stopped", code: "TURN_BUDGET_EXHAUSTED" });
    expect(outcome.turns).toHaveLength(2);
  });

  it("stops on the tool-call budget before authorizing another effect", async () => {
    const { outcome } = await run([inspect("target.ts"), inspect("other.ts")], {
      maxToolCalls: 1,
    });
    expect(outcome).toMatchObject({ kind: "stopped", code: "TOOL_BUDGET_EXHAUSTED" });
    expect(backend.executions).toBe(1);
  });

  it("fails closed on an oversized context instead of truncating it", async () => {
    contextBytes = 131_073;
    const { outcome, gateway } = await run([finish("ready")]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "CONTEXT_BUDGET_EXCEEDED" });
    expect(gateway.requests).toHaveLength(0);
    expect(backend.executions).toBe(0);
  });

  it("fails closed on an over-token context even when the byte ceiling is met", async () => {
    contextTokens = 32_769;
    const { outcome, gateway } = await run([finish("ready")]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "CONTEXT_BUDGET_EXCEEDED" });
    expect(gateway.requests).toHaveLength(0);
  });
});

// ===========================================================================
// Deterministic no-progress detection
// ===========================================================================
describe("repeated action without new evidence is detected from the Ledger", () => {
  it("refuses an identical intent and stops on the no-progress budget", async () => {
    const { outcome } = await run([
      inspect("target.ts"),
      inspect("target.ts"),
      inspect("target.ts"),
    ]);
    expect(outcome).toMatchObject({ kind: "stopped", code: "NO_PROGRESS" });
    expect(outcome.turns[0]?.accepted).toBe(true);
    expect(outcome.turns[1]?.refusal).toBe("NO_NEW_EVIDENCE");
    // Exactly one execution: the repeat never reached the environment.
    expect(backend.executions).toBe(1);
  });

  it("treats a genuinely different action as progress", async () => {
    const { outcome } = await run([inspect("target.ts"), inspect("other.ts"), finish("ready")], {
      maxNoProgressTurns: 1,
    });
    expect(outcome.kind).toBe("ready_for_verification");
    expect(backend.executions).toBe(2);
  });

  it("is decided by the recorded intent fingerprint, not by turn order", async () => {
    const { outcome } = await run(
      [inspect("target.ts"), inspect("other.ts"), inspect("target.ts"), finish("ready")],
      { maxNoProgressTurns: 2 },
    );
    expect(outcome.turns[2]?.refusal).toBe("NO_NEW_EVIDENCE");
    expect(outcome.kind).toBe("ready_for_verification");
    expect(backend.executions).toBe(2);
  });
});

// ===========================================================================
// There is no model-direct tool path
// ===========================================================================
describe("the model never invokes a tool itself", () => {
  it("reaches the sandbox only through the governed effect gateway", async () => {
    const { outcome, gateway } = await run([inspect("target.ts"), finish("ready")]);
    expect(outcome.kind).toBe("ready_for_verification");
    // Every backend execution is paired with an authoritative attempt entry; a direct path would
    // show as an execution with no attempt recorded.
    const page = await ledger.listForTask(taskId, { limit: 500 }, context);
    const attempts = page.items.filter((entry) => entry.kind === "effect_attempt");
    expect(attempts).toHaveLength(backend.executions);
    // And the loop never used the legacy model path, which would throw.
    expect(gateway.requests).toHaveLength(2);
  });

  it("gives the model no execution capability of any kind in its request", async () => {
    const { gateway } = await run([finish("ready")]);
    const serialized = JSON.stringify(gateway.requests[0]);
    for (const forbidden of ["executable", "sandboxId", "workspaceId", "rootPath", "command"]) {
      expect(serialized).not.toMatch(new RegExp(forbidden, "u"));
    }
  });
});

// ===========================================================================
// A refusal from the adapter is model output, not infrastructure
// ===========================================================================
describe("an adapter that refuses a turn does not end the run as a failure", () => {
  it("counts a deterministic adapter refusal against the refusal budget", async () => {
    const { outcome, gateway } = await runWith(
      new FailingGateway([
        new ApplicationError("DEPENDENCY_FAILURE", "The supervised adapter call failed.", {
          cause: new Error("Agent turn named an operation outside the permitted manifest."),
        }),
        null,
      ]),
    );
    expect(outcome.kind).toBe("ready_for_verification");
    expect(outcome.turns[0]).toMatchObject({
      accepted: false,
      refusal: "ADAPTER_REJECTED_TURN",
    });
    // The underlying reason survives into durable history, not just the wrapper's message.
    expect(outcome.turns[0]?.detail).toMatch(/outside the permitted manifest/u);
    expect(gateway.requests).toHaveLength(2);
    expect(backend.executions).toBe(0);
  });

  it("propagates a retryable dependency failure instead of swallowing it", async () => {
    await expect(
      runWith(
        new FailingGateway([
          new ApplicationError("DEPENDENCY_UNAVAILABLE", "no adapter is bound", {
            retryable: true,
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("stops once the refusal budget is spent on adapter refusals alone", async () => {
    const refusal = () =>
      new ApplicationError("DEPENDENCY_FAILURE", "The supervised adapter call failed.", {
        cause: new Error("Agent turn is malformed: kind must be tool_call, finish, or defer."),
      });
    const { outcome } = await runWith(new FailingGateway([refusal(), refusal(), null]));
    expect(outcome).toMatchObject({ kind: "stopped", code: "REFUSED_TURN_BUDGET_EXHAUSTED" });
    expect(outcome.turns).toHaveLength(2);
  });
});

/** A `code.patch` turn against the real workspace file the fixtures write. */
function patchTurn() {
  return {
    kind: "tool_call" as const,
    operation: "code.patch",
    parameters: {
      expectedFingerprint: sha256Hex("export const value = 1;\n"),
      targetPath: "target.ts",
      pathScope: ["target.ts"],
      patch: "export const value = 2;\n",
    },
  };
}

/** Records one governed read's finding, exactly as the harness would. */
async function record(resourceKind: string, locator: string, fingerprint?: string): Promise<void> {
  entryCounter += 1;
  await database.unitOfWork.execute(context, async (transaction) => {
    await ledger.append(
      ExecutionLedgerEntry.create({
        id: `ledger:${entryCounter}`,
        taskId: "task:agent",
        jobId: "job:1",
        recordedAt: T0,
        kind: "observation",
        detail: `${resourceKind} observed`,
        facts: [{ resourceKind, locator, fingerprint: fingerprint ?? sha256Hex(locator) }],
      }),
      context,
      transaction,
    );
  });
}

describe("a model turn cannot reach an effect its evidence does not support", () => {
  async function patchRun(script: readonly unknown[]) {
    return runAgentTurnLoop(
      {
        gateway: new ScriptedGateway(script),
        surface,
        reconciler,
        tasks,
        ledger,
        unitOfWork: database.unitOfWork,
        buildContext,
        observeResources: observeLedgerFacts,
        generateEntryId: () => `ledger:${++entryCounter}`,
        generateInvocationId: (turnIndex: number) => `invocation-agent-${turnIndex}`,
        now: () => T0,
      },
      {
        taskId,
        jobId,
        modelId: modelId as never,
        role: "executor",
        allowedOperations: ["code.patch", "code.inspect"],
        reasoningPolicy: "disabled",
        budget,
        resourceBudget,
        workspace,
        sandbox,
        probe: applied,
      },
      context,
    );
  }

  it("refuses a syntactically perfect patch whose prerequisites are not recorded", async () => {
    // The target itself is observed and current, so the only thing left to refuse is the evidence.
    await record("workspace_file", "target.ts", sha256Hex("export const value = 1;\n"));
    const outcome = await patchRun([patchTurn(), finish("ready")]);
    expect(outcome.turns[0]?.refusal).toBe("AUTHORIZATION_REFUSED");
    expect(outcome.turns[0]?.detail).toMatch(/evidence precondition/iu);
    // The run continues rather than dying, and nothing reached the backend.
    expect(outcome.kind).toBe("ready_for_verification");
    expect(backend.executions).toBe(0);
  });

  it("executes the same patch once the prerequisites and the target are observed", async () => {
    await record(PRECONDITION_RESOURCE_KINDS.symbolDefinition, "src/target.ts#value");
    await record(PRECONDITION_RESOURCE_KINDS.impactAnalysis, "src/target.ts");
    await record(PRECONDITION_RESOURCE_KINDS.testSelection, "tests/target.test.ts");
    // The target's own current fingerprint comes from an observation, never from the turn.
    await record("workspace_file", "target.ts", sha256Hex("export const value = 1;\n"));
    const outcome = await patchRun([patchTurn(), finish("ready")]);
    expect(outcome.turns[0]?.refusal).toBeNull();
    // The gate let the write through to the governed effect path, which recorded it.
    expect(outcome.turns[0]?.outcomeKind).toBe("effect_confirmation");
    expect(await ledgerKinds()).toContain("effect_attempt");
  });

  it("refuses again once the observed target has moved on", async () => {
    await record(PRECONDITION_RESOURCE_KINDS.symbolDefinition, "src/target.ts#value");
    await record(PRECONDITION_RESOURCE_KINDS.impactAnalysis, "src/target.ts");
    await record(PRECONDITION_RESOURCE_KINDS.testSelection, "tests/target.test.ts");
    await record("workspace_file", "target.ts", sha256Hex("someone else edited this"));
    const outcome = await patchRun([patchTurn(), finish("ready")]);
    expect(outcome.turns[0]?.refusal).toBe("AUTHORIZATION_REFUSED");
    expect(backend.executions).toBe(0);
  });
});
