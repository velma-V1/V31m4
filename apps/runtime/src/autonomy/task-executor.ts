import {
  type AgentReasoningPolicy,
  appendExecutionLedgerEntry,
  assertEntryAcceptanceContract,
  type EntryAcceptanceSnapshot,
  type OperationContext,
  type SandboxHandle,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  type ContentHash,
  ExecutionLedgerEntry,
  type JobId,
  type ModelId,
  type ResourceBudget,
  type TaskId,
} from "@v31m4/domain";
import type {
  AgentContextRequest,
  AgentLoopOutcome,
  AgentTurnBudget,
  AgentTurnContext,
  AgentTurnLoopDependencies,
} from "./agent-turn-contracts.js";
import { runAgentTurnLoop } from "./agent-turn-loop.js";
import type { EffectPostStateProbe } from "./effect-reconciler-contracts.js";
import {
  assertRoleInvocationPermitted,
  mintRoleInvocationManifest,
  type RoleInvocationManifest,
  roleInvocationFacts,
} from "./role-manifest.js";
import type { SemanticOperationId } from "./semantic-operation-catalog.js";

/**
 * The Executor: one fresh bounded context, one governed agent-turn loop, one recorded invocation.
 *
 * It is deliberately thin. Everything that decides anything already exists — the frozen acceptance
 * contract says what done means, the manifest says what this role may do, and the agent-turn loop
 * owns validation, authorization, and the Ledger. What this adds is the role boundary: the contract
 * is proved before the model is asked anything, the operations the model is offered come from a
 * minted manifest rather than from the caller's request, and the invocation itself is written into
 * durable history as ordinary observed facts.
 *
 * The Executor cannot complete a task. It proposes no transition, writes no evidence, and returns
 * at best `ready_for_verification` — which is a request for an independent audit, not a result.
 */
export interface TaskExecutorDependencies extends AgentTurnLoopDependencies {}

export interface TaskExecutorRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly modelId: ModelId;
  readonly snapshot: EntryAcceptanceSnapshot;
  /**
   * The contract fingerprint this Executor was dispatched with. Supplied separately from the
   * snapshot on purpose: comparing the two is what catches a swapped contract.
   */
  readonly expectedContractFingerprint?: ContentHash;
  readonly capsuleFingerprint: ContentHash;
  readonly allowedOperations: readonly SemanticOperationId[];
  readonly skillVersions: readonly string[];
  readonly harnessVersion: string;
  readonly reasoningPolicy: AgentReasoningPolicy;
  readonly budget: AgentTurnBudget;
  readonly resourceBudget: ResourceBudget;
  readonly workspace: WorkspaceHandle;
  readonly sandbox: SandboxHandle;
  readonly probe: EffectPostStateProbe;
}

export interface TaskExecutorResult {
  readonly manifest: RoleInvocationManifest;
  readonly outcome: AgentLoopOutcome;
  readonly observationEntryId: string;
}

/**
 * Builds the entry context once and serves it to the loop's first turn.
 *
 * The manifest must name the context this role was actually dispatched with, and the loop rebuilds
 * context every turn — so the entry context is taken here, before the manifest is minted, and the
 * loop is handed a source that returns that exact context for turn 0 and delegates afterwards.
 * Without the cache the entry context would be compiled twice and the manifest would fingerprint a
 * context the model never saw.
 */
function entryContextSource(
  build: AgentTurnLoopDependencies["buildContext"],
  entry: AgentTurnContext,
): AgentTurnLoopDependencies["buildContext"] {
  return async (request: AgentContextRequest, context: OperationContext) =>
    request.turnIndex === 0 ? entry : build(request, context);
}

export async function runTaskExecutor(
  dependencies: TaskExecutorDependencies,
  request: TaskExecutorRequest,
  context: OperationContext,
): Promise<TaskExecutorResult> {
  // Before anything is compiled or asked: this must be the contract we were sent to satisfy, and
  // these must be operations an Executor may hold.
  assertEntryAcceptanceContract(
    request.snapshot,
    request.expectedContractFingerprint ?? request.snapshot.contractFingerprint,
  );
  assertRoleInvocationPermitted("executor", request.allowedOperations);

  const current = await dependencies.tasks.loadCurrent(request.taskId, context);
  const entry = await dependencies.buildContext(
    {
      taskId: request.taskId,
      jobId: request.jobId,
      turnIndex: 0,
      capsule: current?.capsule ?? (undefined as never),
      projection: await dependencies.reconciler.projection(request.taskId, context),
      lastObservation: null,
    },
    context,
  );

  const manifest = mintRoleInvocationManifest({
    role: "executor",
    taskId: request.taskId,
    capsuleFingerprint: request.capsuleFingerprint,
    contextFingerprint: entry.contextFingerprint,
    modelId: request.modelId,
    allowedOperations: request.allowedOperations,
    skillVersions: request.skillVersions,
    harnessVersion: request.harnessVersion,
    acceptanceContractFingerprint: request.snapshot.contractFingerprint,
  });
  const observationEntryId = await recordRoleInvocation(dependencies, request, manifest, context);

  const outcome = await runAgentTurnLoop(
    { ...dependencies, buildContext: entryContextSource(dependencies.buildContext, entry) },
    {
      taskId: request.taskId,
      jobId: request.jobId,
      modelId: request.modelId,
      role: "executor",
      // From the manifest, never from the request: one canonical, already-checked set.
      allowedOperations: manifest.allowedOperations,
      reasoningPolicy: request.reasoningPolicy,
      budget: request.budget,
      resourceBudget: request.resourceBudget,
      workspace: request.workspace,
      sandbox: request.sandbox,
      probe: request.probe,
    },
    context,
  );

  return Object.freeze({ manifest, outcome, observationEntryId });
}

/** Writes the role invocation into the task's history as ordinary observed resource facts. */
export async function recordRoleInvocation(
  dependencies: Pick<
    AgentTurnLoopDependencies,
    "unitOfWork" | "ledger" | "generateEntryId" | "now"
  >,
  request: Pick<TaskExecutorRequest, "taskId" | "jobId">,
  manifest: RoleInvocationManifest,
  context: OperationContext,
): Promise<string> {
  const entry = ExecutionLedgerEntry.create({
    id: dependencies.generateEntryId(),
    taskId: request.taskId,
    jobId: request.jobId,
    recordedAt: dependencies.now(),
    kind: "observation",
    detail: `${manifest.role} invocation under harness ${manifest.harnessVersion}`,
    facts: roleInvocationFacts(manifest),
  });
  await appendExecutionLedgerEntry(
    { unitOfWork: dependencies.unitOfWork, ledger: dependencies.ledger },
    entry,
    context,
  );
  return entry.id;
}
