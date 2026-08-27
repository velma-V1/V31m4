import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentModelGatewayPort,
  type AgentReasoningPolicy,
  type PolicyEnginePort,
  SandboxIsolationPolicy,
  supportsAgentTurns,
  type WorkspaceHandle,
} from "@v31m4/application";
import { AGENT_TURN_CONTRACT_VERSION } from "@v31m4/contracts";
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
  type SqliteRuntimeDatabase,
  SupervisedAdapterProcess,
  SupervisedModelGateway,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  type AgentContextRequest,
  type AgentTurnBudget,
  type AgentTurnContext,
  runAgentTurnLoop,
} from "../../src/autonomy/agent-turn-loop.js";
import {
  SqliteExecutionLedgerRepository,
  SqliteTaskCapsuleRepository,
} from "../../src/autonomy/autonomy-state-infrastructure.js";
import type { EffectPostState } from "../../src/autonomy/effect-reconciler.js";
import { GovernedExecutionSurface } from "../../src/autonomy/effect-reconciler.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 4 target-host proof.
 *
 * The whole real path, with nothing simulated: the governed runtime loop, the real supervised
 * model gateway, the real supervised adapter child process, the real Ollama service on this
 * machine, and a real local model. It exists to prove properties that no in-process test can — an
 * actual model producing an actual structured turn that V31M4 validates, authorizes, executes, and
 * records — and it reports honestly when a prerequisite is missing rather than passing vacuously.
 *
 *   V31M4_RUN_REAL_AGENT_TURN=1     run it at all
 *   V31M4_AGENT_MODEL               the installed model to prove against
 *   V31M4_OLLAMA_ENDPOINT           default http://127.0.0.1:11434
 *   V31M4_AGENT_CONTEXT_TOKENS      practical context target, default 32768
 */
const enabled = process.env["V31M4_RUN_REAL_AGENT_TURN"] === "1";
const realTest = enabled ? it : it.skip;

const ADAPTER_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/local-supervised",
);
const endpoint = process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434";
const modelId = process.env["V31M4_AGENT_MODEL"] ?? "qwen3.8:27b";
const contextTokens = Number(process.env["V31M4_AGENT_CONTEXT_TOKENS"] ?? "32768");
const HARD_BYTE_CEILING = 512 * 1024;
/** Corrected against the provider's reported prompt token count in the context measurement. */
const BYTES_PER_TOKEN_ESTIMATE = 6;

const taskId = TaskId.parse("task:agent-real");
const jobId = JobId.parse("job-agent-real");
const projectId = ProjectId.parse("project-agent-real");
const T0 = "2026-08-26T00:00:00.000Z";

const resourceBudget = ResourceBudget.create({
  maxWallClockMs: 600_000,
  maxModelInvocations: 8,
  maxToolInvocations: 8,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});
const isolation = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const budget: AgentTurnBudget = Object.freeze({
  maxTurns: 4,
  maxToolCalls: 3,
  maxDefers: 1,
  maxRefusedTurns: 3,
  maxNoProgressTurns: 1,
  maxPromptBytes: HARD_BYTE_CEILING,
  maxPromptTokens: contextTokens,
});

const policy: PolicyEnginePort = {
  async evaluate() {
    return {
      decision: "allow",
      policyId: "policy:agent-real",
      reasons: [],
      requiredApprovalScopes: [],
    };
  },
};

let stageRoot: string;
let workspaceRoot: string;
let adapter: SupervisedAdapterProcess;
let gateway: SupervisedModelGateway;
let database: SqliteRuntimeDatabase;
let workspace: WorkspaceHandle;
let entryCounter = 0;
let promptCounter = 0;
const measured: string[] = [];

/** The gateway wraps an adapter refusal, so the reason lives on the cause chain. */
function causeChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" <- ");
}

function nextEntry(): number {
  entryCounter += 1;
  return entryCounter;
}

function record(line: string): void {
  measured.push(line);
  process.stdout.write(`[agent-turn-proof] ${line}\n`);
}

async function installedModels(): Promise<readonly { name: string; capabilities: string[] }[]> {
  const response = await fetch(new URL("/api/tags", endpoint));
  if (!response.ok) throw new Error(`Ollama discovery returned HTTP ${response.status}.`);
  const parsed = (await response.json()) as {
    models: { name: string; capabilities?: string[] }[];
  };
  return parsed.models.map((entry) => ({
    name: entry.name,
    capabilities: entry.capabilities ?? [],
  }));
}

beforeAll(async () => {
  if (!enabled) return;
  stageRoot = await mkdtemp(join(tmpdir(), "v31m4-agent-real-stage-"));
  workspaceRoot = await mkdtemp(join(tmpdir(), "v31m4-agent-real-workspace-"));
  await mkdir(join(stageRoot, "model-inputs"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "target.ts"),
    "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "notes.md"),
    "# Notes\n\nThe subtraction is wrong.\n",
    "utf8",
  );
  adapter = new SupervisedAdapterProcess({
    id: "ollama-local-supervised",
    process: {
      command: process.execPath,
      args: [join(ADAPTER_ROOT, "model-adapter.mjs")],
      environment: {
        V31M4_STAGE4_ROOT: stageRoot,
        V31M4_OLLAMA_ENDPOINT: endpoint,
        V31M4_OLLAMA_MODEL: modelId,
        V31M4_AGENT_MAX_PROMPT_BYTES: String(HARD_BYTE_CEILING),
      },
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 2_000,
    },
    maxFrameBytes: 256 * 1024,
  });
  gateway = new SupervisedModelGateway([], new Map(), 600_000, { primary: adapter });
  database = runtimeDatabase();
  workspace = Object.freeze({
    id: "workspace-1",
    projectId,
    purpose: "tool_execution" as const,
    rootPath: SafePath.parse("workspace-1"),
    status: "active" as const,
    createdAt: T0,
  });
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await adapter?.stop();
  database?.close();
  await rm(stageRoot, { recursive: true, force: true });
  await rm(workspaceRoot, { recursive: true, force: true });
  process.stdout.write(`[agent-turn-proof] --- measured ---\n${measured.join("\n")}\n`);
});

/** Stages one real prompt file and measures it. Nothing is trimmed to fit. */
async function stagePrompt(body: string): Promise<AgentTurnContext> {
  promptCounter += 1;
  const promptArtifactId = `artifact-agent-real-${promptCounter}`;
  await writeFile(join(stageRoot, "model-inputs", `${promptArtifactId}.txt`), body, "utf8");
  const promptBytes = Buffer.byteLength(body);
  return Object.freeze({
    promptArtifactId: promptArtifactId as never,
    promptBytes,
    // A deliberately conservative estimate; the authoritative token bound is `num_ctx` below.
    promptTokens: Math.ceil(promptBytes / 3),
    contextFingerprint: ContentHash.parse(sha256Hex(body)),
  });
}

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

interface Harness {
  readonly surface: GovernedExecutionSurface;
  readonly reconciler: ReturnType<GovernedExecutionSurface["createEffectReconciler"]>;
  readonly sandbox: Awaited<ReturnType<GovernedSandboxes["prepare"]>>;
  readonly ledger: SqliteExecutionLedgerRepository;
  readonly tasks: TaskManager;
  readonly backend: CountingBackend;
}
type GovernedSandboxes = GovernedExecutionSurface["sandboxes"];

class CountingBackend extends ReferenceSandboxBackend {
  executions = 0;
  override async execute(...args: Parameters<ReferenceSandboxBackend["execute"]>) {
    this.executions += 1;
    return super.execute(...args);
  }
}

/** A fresh authoritative task, ledger, and governed surface for one scenario. */
async function harness(scenario: string): Promise<Harness> {
  const scopedTask = TaskId.parse(`${taskId}-${scenario}`);
  const ledger = new SqliteExecutionLedgerRepository(database);
  const tasks = new TaskManager({
    unitOfWork: database.unitOfWork,
    capsules: new SqliteTaskCapsuleRepository(database),
    evidence: new SqliteEvidenceRepository(database),
  });
  await tasks.createTask(
    {
      taskId: scopedTask,
      jobId,
      projectId,
      objective: "Prove the governed agent turn loop on the target host.",
      phase: "execute",
      dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
      attempts: 1,
      maxAttempts: 3,
      stopCondition: "stop after three attempts",
      updatedAt: T0,
    },
    context,
  );
  const backend = new CountingBackend();
  const surface = GovernedExecutionSurface.create({
    policy,
    backend,
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces()),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async () => workspaceRoot,
    generateSandboxId: () => `sandbox:${scenario}`,
    now: () => new Date().toISOString(),
  });
  const sandbox = await surface.sandboxes.prepare(
    scopedTask,
    jobId,
    workspace,
    resourceBudget,
    isolation,
    context,
  );
  const reconciler = surface.createEffectReconciler({
    unitOfWork: database.unitOfWork,
    ledger,
    generateEntryId: () => `ledger:${scenario}:${nextEntry()}`,
    now: () => new Date().toISOString(),
  });
  return { surface, reconciler, sandbox, ledger, tasks, backend };
}

const MANIFEST = ["code.inspect", "git.status"] as const;

function instruction(request: AgentContextRequest, extra: string): string {
  return [
    "You are the executor inside the V31M4 autonomous runtime.",
    `Task: ${request.capsule.objective}`,
    `Task phase: ${request.capsule.phase}. Turn index: ${request.turnIndex}.`,
    `Governed operations already recorded: ${request.projection.attempts.length}.`,
    request.lastObservation === null
      ? "No governed operation has been performed yet."
      : `The previous operation ${request.lastObservation.operation} was recorded as ${request.lastObservation.outcomeKind}.`,
    `Permitted operations: ${MANIFEST.join(", ")}.`,
    extra,
  ].join("\n");
}

/**
 * Runs the loop and, if it throws, records the real underlying reason before rethrowing.
 *
 * The gateway wraps an adapter or provider failure in one generic message, so an unadorned
 * failure here would report "the supervised adapter call failed" and hide whether the host, the
 * model, or the contract was at fault — which is exactly the evidence a target-host proof owes.
 */
async function runAgentTurnLoopReporting(
  ...args: Parameters<typeof runAgentTurnLoop>
): ReturnType<typeof runAgentTurnLoop> {
  try {
    return await runAgentTurnLoop(...args);
  } catch (error) {
    record(`FAILURE: ${causeChain(error)}`);
    throw error;
  }
}

async function runScenario(
  scenario: string,
  instructionFor: (request: AgentContextRequest) => string,
  overrides: Partial<AgentTurnBudget> = {},
  reasoningPolicy: AgentReasoningPolicy = "disabled",
) {
  const wired = await harness(scenario);
  const started = Date.now();
  const outcome = await runAgentTurnLoopReporting(
    {
      gateway: gateway as AgentModelGatewayPort,
      surface: wired.surface,
      reconciler: wired.reconciler,
      tasks: wired.tasks,
      ledger: wired.ledger,
      unitOfWork: database.unitOfWork,
      buildContext: (request) => stagePrompt(instructionFor(request)),
      generateEntryId: () => `ledger:${scenario}:loop:${nextEntry()}`,
      generateInvocationId: (turnIndex) => `invocation-${scenario}-${turnIndex}`,
      now: () => new Date().toISOString(),
    },
    {
      taskId: TaskId.parse(`${taskId}-${scenario}`),
      jobId,
      modelId: modelId as never,
      role: "executor",
      allowedOperations: [...MANIFEST],
      reasoningPolicy,
      budget: { ...budget, ...overrides },
      resourceBudget,
      workspace,
      sandbox: wired.sandbox,
      probe: applied,
    },
    context,
  );
  record(
    `${scenario}: outcome=${outcome.kind}${
      outcome.kind === "stopped" ? `/${outcome.code}` : ""
    } turns=${outcome.turns.length} executions=${wired.backend.executions} elapsedMs=${Date.now() - started}`,
  );
  for (const turn of outcome.turns) {
    record(
      `  turn ${turn.index}: kind=${turn.kind} operation=${turn.operation ?? "-"} accepted=${turn.accepted} refusal=${turn.refusal ?? "-"} tokens=${turn.usage.inputTokens ?? "?"}/${turn.usage.outputTokens ?? "?"}`,
    );
  }
  return { outcome, wired };
}

realTest(
  "the target host is running Ollama with the requested model installed",
  async () => {
    const installed = await installedModels();
    record(`endpoint=${endpoint} installed=${installed.map((entry) => entry.name).join(", ")}`);
    const entry = installed.find((candidate) => candidate.name === modelId);
    expect(
      entry,
      `The requested agent model ${modelId} is not installed on this host.`,
    ).toBeDefined();
    record(`model=${modelId} capabilities=${entry?.capabilities.join(",") ?? "none"}`);
    expect(supportsAgentTurns(gateway)).toBe(true);
  },
  120_000,
);

realTest(
  "a real model drives governed semantic operations and declares readiness for verification",
  async () => {
    const { outcome, wired } = await runScenario("act", (request) =>
      instruction(
        request,
        request.projection.attempts.length === 0
          ? 'Inspect the workspace file target.ts. Emit exactly {"kind":"tool_call","operation":"code.inspect","parameters":{"pathScope":["target.ts"]}}.'
          : 'The inspection is recorded. Emit exactly {"kind":"finish","summary":"target.ts inspected and ready for verification"}.',
      ),
    );
    expect(outcome.kind).toBe("ready_for_verification");
    const accepted = outcome.turns.filter((turn) => turn.accepted && turn.kind === "tool_call");
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted[0]?.operation).toBe("code.inspect");
    expect(accepted[0]?.outcomeKind).toBe("effect_confirmation");
    expect(wired.backend.executions).toBe(accepted.length);
    const page = await wired.ledger.listForTask(
      TaskId.parse(`${taskId}-act`),
      { limit: 100 },
      context,
    );
    expect(page.items.some((entry) => entry.kind === "effect_attempt")).toBe(true);
  },
  900_000,
);

realTest(
  "a real model can decline to proceed, and the deferral is bounded",
  async () => {
    const { outcome, wired } = await runScenario("defer", (request) =>
      instruction(
        request,
        'There is no evidence available and you cannot proceed. Emit exactly {"kind":"defer","reason":"no reproduction evidence is available"}.',
      ),
    );
    expect(["deferred", "stopped"]).toContain(outcome.kind);
    if (outcome.kind === "deferred") expect(outcome.reason.length).toBeGreaterThan(0);
    expect(wired.backend.executions).toBe(0);
  },
  600_000,
);

realTest(
  "a repeated identical action is refused from recorded Ledger fingerprints",
  async () => {
    const { outcome, wired } = await runScenario(
      "repeat",
      (request) =>
        instruction(
          request,
          'Emit exactly {"kind":"tool_call","operation":"code.inspect","parameters":{"pathScope":["target.ts"]}} every turn, without variation.',
        ),
      { maxNoProgressTurns: 1, maxTurns: 3 },
    );
    // Either the loop stopped on no-progress, or the model varied; in both cases the ledger must
    // never hold two attempts for one intent, and the backend must never have run the repeat.
    expect(wired.backend.executions).toBeLessThanOrEqual(2);
    const page = await wired.ledger.listForTask(
      TaskId.parse(`${taskId}-repeat`),
      { limit: 100 },
      context,
    );
    const fingerprints = page.items
      .filter((entry) => entry.kind === "effect_attempt")
      .map((entry) => (entry as { intentFingerprint: string }).intentFingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    if (outcome.kind === "stopped") expect(outcome.code).toBe("NO_PROGRESS");
  },
  900_000,
);

realTest(
  "an operation outside the role manifest never reaches the environment",
  async () => {
    const { outcome, wired } = await runScenario(
      "manifest",
      (request) =>
        instruction(
          request,
          'Emit exactly {"kind":"tool_call","operation":"command.run","parameters":{"executable":"sh","arguments":["-c","echo hi"]}}.',
        ),
      { maxRefusedTurns: 1, maxTurns: 2 },
    );
    // The adapter refuses an out-of-manifest operation, and if the model instead answers with
    // something valid the loop simply proceeds. Neither path may execute `command.run`.
    for (const turn of outcome.turns) expect(turn.operation).not.toBe("command.run");
    expect(wired.backend.executions).toBeLessThanOrEqual(1);
  },
  600_000,
);

realTest(
  "the practical 32K context target holds and oversize fails closed",
  async () => {
    // Fill the context to the practical target rather than sampling a small one: "32K holds" is
    // only a measurement if roughly 32K tokens were actually evaluated. The byte estimate is
    // corrected against the provider's own reported prompt token count below.
    const filler = "// governed context padding line for the target-host context measurement\n";
    const targetBytes = Math.min(
      HARD_BYTE_CEILING - 8_192,
      Math.floor(contextTokens * 0.92) * BYTES_PER_TOKEN_ESTIMATE,
    );
    const large = filler.repeat(Math.ceil(targetBytes / filler.length));
    const staged = await stagePrompt(
      `${large}\nEmit exactly {"kind":"finish","summary":"large context accepted"}.`,
    );
    record(`context: bytes=${staged.promptBytes} numCtxRequested=${contextTokens}`);
    const started = Date.now();
    const result = await gateway.invokeAgentTurn(
      {
        invocationId: "invocation-context-32k",
        jobId,
        taskId,
        modelId: modelId as never,
        promptArtifactId: staged.promptArtifactId,
        outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
        allowedOperations: [...MANIFEST],
        reasoningPolicy: "disabled",
        contextBudget: { maxPromptBytes: HARD_BYTE_CEILING, maxPromptTokens: contextTokens },
        resourceBudget,
        metadata: {},
      },
      context,
    );
    const inputTokens = result.usage.inputTokens ?? 0;
    record(
      `context: turn=${result.turn.kind} inputTokens=${inputTokens} ofBudget=${contextTokens} elapsedMs=${Date.now() - started}`,
    );
    // A real, large context was evaluated — not a token or two under a 32K ceiling — and the model
    // still produced a valid structured turn. Anything materially below the band would mean the
    // context never reached the model, which is the failure this measurement exists to catch.
    expect(inputTokens).toBeGreaterThan(contextTokens * 0.5);
    expect(inputTokens).toBeLessThanOrEqual(contextTokens);
    expect(["finish", "tool_call", "defer"]).toContain(result.turn.kind);

    // The same adapter refuses a context above the configured hard ceiling. Nothing is truncated.
    const oversize = await stagePrompt("y".repeat(HARD_BYTE_CEILING + 1_024));
    const refusal = await gateway
      .invokeAgentTurn(
        {
          invocationId: "invocation-context-oversize",
          jobId,
          taskId,
          modelId: modelId as never,
          promptArtifactId: oversize.promptArtifactId,
          outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
          allowedOperations: [...MANIFEST],
          reasoningPolicy: "disabled",
          contextBudget: { maxPromptBytes: HARD_BYTE_CEILING, maxPromptTokens: contextTokens },
          resourceBudget,
          metadata: {},
        },
        context,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refusal, "an oversized context must be refused, never truncated").not.toBeNull();
    expect(causeChain(refusal)).toMatch(/oversiz|exceed/i);
    record(`context: oversize refused without truncation (${causeChain(refusal)})`);
  },
  900_000,
);

realTest(
  "every provider-neutral reasoning mode this host supports yields a turn and no reasoning trace",
  async () => {
    const installed = await installedModels();
    const capabilities = installed.find((entry) => entry.name === modelId)?.capabilities ?? [];
    const policies: AgentReasoningPolicy[] = capabilities.includes("thinking")
      ? ["disabled", "auto", "enabled"]
      : ["disabled", "auto"];
    record(
      `reasoning: capabilities=${capabilities.join(",") || "none"} probing=${policies.join(",")}`,
    );
    for (const reasoningPolicy of policies) {
      const staged = await stagePrompt(
        'Emit exactly {"kind":"finish","summary":"reasoning mode probe complete"}.',
      );
      const started = Date.now();
      const result = await gateway.invokeAgentTurn(
        {
          invocationId: `invocation-reasoning-${reasoningPolicy}`,
          jobId,
          taskId,
          modelId: modelId as never,
          promptArtifactId: staged.promptArtifactId,
          outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
          allowedOperations: [...MANIFEST],
          reasoningPolicy,
          contextBudget: { maxPromptBytes: HARD_BYTE_CEILING, maxPromptTokens: contextTokens },
          resourceBudget,
          metadata: {},
        },
        context,
      );
      record(
        `reasoning ${reasoningPolicy}: turn=${result.turn.kind} outputTokens=${result.usage.outputTokens ?? "?"} elapsedMs=${Date.now() - started}`,
      );
      expect(["finish", "tool_call", "defer"]).toContain(result.turn.kind);
      expect(JSON.stringify(result)).not.toMatch(/"thinking"|"reasoning"|chain_of_thought/u);
    }
    // Nothing the adapter staged on disk may contain a reasoning trace either.
    const outputs = join(stageRoot, "model-outputs");
    for (const file of await readdir(outputs)) {
      const body = await readFile(join(outputs, file), "utf8");
      expect(body).not.toMatch(/"thinking"|"reasoning"|chain_of_thought/u);
    }
  },
  900_000,
);

realTest(
  "the legacy verified invocation path still works against the same adapter",
  async () => {
    const promptArtifactId = "artifact-agent-real-legacy";
    await writeFile(
      join(stageRoot, "model-inputs", `${promptArtifactId}.txt`),
      "Return a JavaScript module exporting const legacy = true.",
      "utf8",
    );
    const started = Date.now();
    const result = await gateway.invoke(
      {
        invocationId: "invocation-agent-real-legacy",
        jobId,
        modelId: modelId as never,
        promptArtifactId: promptArtifactId as never,
        configuration: {
          modelId: modelId as never,
          strategy: "direct",
          contextArtifactIds: [],
          toolIds: [],
          constraints: [],
        },
        resourceBudget,
        metadata: {},
      },
      context,
    );
    record(`legacy: finishReason=${result.finishReason} elapsedMs=${Date.now() - started}`);
    expect(result).toMatchObject({
      modelId,
      finishReason: "completed",
      metadata: { realInference: true, model: modelId },
    });
  },
  900_000,
);
