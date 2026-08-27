import {
  ApplicationError,
  appendExecutionLedgerEntry,
  assertEntryAcceptanceContract,
  assertHandoffStillCurrent,
  assertRoleHandoff,
  type EntryAcceptanceSnapshot,
  type OperationContext,
  type RoleHandoff,
  type SandboxHandle,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  type ContentHash,
  ExecutionLedgerEntry,
  type JobId,
  ModelId,
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
 * It is deliberately thin. Everything that decides anything already exists — the Manager's handoff
 * says which capsule, workspace, model, skills, operations, and context budget this run is bound
 * to, the frozen acceptance contract says what done means, and the agent-turn loop owns validation,
 * authorization, and the Ledger. What this adds is the role boundary.
 *
 * The Executor accepts *no* policy from its caller. Model, operations, skills, reasoning policy,
 * turn budget, and the capsule identity all come from the handoff, whose fingerprint is verified
 * against the dispatch it was sent with — so widening any of them is a refusal rather than a
 * quieter run. It then re-reads authoritative state and proves the handoff still describes it:
 * selection happened at one moment and execution happens at another, and a capsule or workspace
 * that moved in between makes the frozen contract a description of a world that no longer exists.
 *
 * The Executor cannot complete a task. It proposes no transition, writes no evidence, and returns
 * at best `ready_for_verification` — which is a request for an independent audit, not a result.
 */
export interface TaskExecutorDependencies extends AgentTurnLoopDependencies {}

export interface TaskExecutorRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly snapshot: EntryAcceptanceSnapshot;
  /** The Manager's dispatch. Every policy this run uses is read from here, and only from here. */
  readonly handoff: RoleHandoff;
  /**
   * The dispatch fingerprint this Executor was sent with. Mandatory and supplied separately from
   * the handoff on purpose: a value taken from the handoff itself would prove nothing.
   */
  readonly expectedHandoffFingerprint: ContentHash;
  /** The workspace state as observed now, for the time-of-use check against the frozen entry. */
  readonly observedWorkspaceFingerprint: ContentHash | null;
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
  const { handoff } = request;
  // Before anything is compiled or asked. The dispatch first, because everything below is read
  // from it; then the contract it names; then the operations an Executor may hold at all.
  assertRoleHandoff(handoff, request.expectedHandoffFingerprint);
  if (handoff.role !== "executor" || handoff.taskId !== request.taskId) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "This handoff does not dispatch this Executor.",
      {
        details: { role: handoff.role, taskId: handoff.taskId, requested: request.taskId },
      },
    );
  }
  assertEntryAcceptanceContract(request.snapshot, handoff.acceptanceContractFingerprint);
  const allowedOperations = assertRoleInvocationPermitted(
    "executor",
    handoff.allowedOperations as readonly SemanticOperationId[],
  );

  const current = await dependencies.tasks.loadCurrent(request.taskId, context);
  if (current === null) {
    throw new ApplicationError("NOT_FOUND", "There is no task capsule to execute against.", {
      details: { taskId: request.taskId },
    });
  }
  // Time of use. Selection read one world; this must still be that world, or the step is reselected.
  assertHandoffStillCurrent(handoff, {
    capsule: current.capsule,
    workspaceId: request.workspace.id,
    workspaceFingerprint: request.observedWorkspaceFingerprint,
  });

  const entry = await dependencies.buildContext(
    {
      taskId: request.taskId,
      jobId: request.jobId,
      turnIndex: 0,
      capsule: current.capsule,
      projection: await dependencies.reconciler.projection(request.taskId, context),
      lastObservation: null,
    },
    context,
  );

  const manifest = mintRoleInvocationManifest({
    role: "executor",
    taskId: request.taskId,
    // The authoritative capsule just proved current, never a fingerprint a caller named.
    capsuleFingerprint: current.capsule.fingerprint,
    contextFingerprint: entry.contextFingerprint,
    modelId: ModelId.parse(handoff.modelId),
    allowedOperations,
    skillVersions: handoff.skillVersions,
    harnessVersion: handoff.harnessVersion,
    acceptanceContractFingerprint: handoff.acceptanceContractFingerprint,
  });
  const observationEntryId = await recordRoleInvocation(dependencies, request, manifest, context);

  const outcome = await runAgentTurnLoop(
    { ...dependencies, buildContext: entryContextSource(dependencies.buildContext, entry) },
    {
      taskId: request.taskId,
      jobId: request.jobId,
      modelId: manifest.modelId,
      role: "executor",
      // From the manifest, never from the request: one canonical, already-checked set.
      allowedOperations: manifest.allowedOperations,
      reasoningPolicy: handoff.reasoningPolicy,
      // The Manager's context policy. `AgentTurnBudget` remains the shape the loop enforces.
      budget: handoff.contextPolicy satisfies AgentTurnBudget,
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
