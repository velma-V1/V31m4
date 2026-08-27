import {
  type AgentModelGatewayPort,
  type AgentReasoningPolicy,
  ApplicationError,
  type AuditedWorkspace,
  type AuditVerdict,
  assertEntryAcceptanceContract,
  assertHandoffResultStateCompatible,
  assertRoleHandoff,
  auditTaskResult,
  type EntryAcceptanceSnapshot,
  type EvidenceRepositoryPort,
  type ExecutionLedgerRepositoryPort,
  type OperationContext,
  type RoleHandoff,
  type SandboxHandle,
  type UnitOfWorkPort,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  type ContentHash,
  type JobId,
  ModelId,
  type ResourceBudget,
  type TaskId,
} from "@v31m4/domain";
import type {
  AgentLoopOutcome,
  AgentTurnBudget,
  AgentTurnContext,
} from "./agent-turn-contracts.js";
import { runAgentTurnLoop } from "./agent-turn-loop.js";
import type { EffectReconciler, GovernedExecutionSurface } from "./effect-reconciler.js";
import type { EffectPostStateProbe } from "./effect-reconciler-contracts.js";
import {
  assertRoleInvocationPermitted,
  mintRoleInvocationManifest,
  type RoleInvocationManifest,
} from "./role-manifest.js";
import type { SemanticOperationId } from "./semantic-operation-catalog.js";
import { recordRoleInvocation } from "./task-executor.js";
import type { TaskManager } from "./task-manager.js";

/**
 * The Auditor: a separate, fresh, read-only judgement of one bounded result.
 *
 * Three separations are structural here rather than procedural.
 *
 * The verdict is deterministic. `auditTaskResult` reads the frozen contract, the authoritative
 * Evidence store, and the Execution Ledger, and nothing else decides the outcome. A model may run
 * alongside it, but what it produces is `advisory` and is never consulted when the verdict is
 * formed — so a model cannot talk the Auditor out of a rejection, and cannot produce an acceptance
 * at all.
 *
 * The context is its own. `AuditorContextRequest` carries the contract, the capsule, and the
 * recorded facts; there is no field on it through which the Executor's turns, summary, or reasoning
 * could arrive. Freshness is not a convention the caller is asked to honour — there is nothing to
 * pass.
 *
 * The role is read-only. The manifest is minted for `auditor`, which derives `readOnly` and refuses
 * every write, execute, and network-effect operation before the run begins — and the operations it
 * is offered come from the Manager's audit dispatch, not from whoever called it.
 */
export interface TaskAuditorDependencies {
  readonly evidence: EvidenceRepositoryPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly tasks: TaskManager;
  readonly unitOfWork: UnitOfWorkPort;
  readonly now: () => string;
  readonly generateEntryId?: () => string;
  /** Everything below is optional: an audit is complete without a model turn. */
  readonly gateway?: AgentModelGatewayPort;
  readonly surface?: GovernedExecutionSurface;
  readonly reconciler?: EffectReconciler;
  readonly buildContext?: AuditorContextSource;
  readonly generateInvocationId?: (turnIndex: number) => string;
  readonly budget?: AgentTurnBudget;
  readonly resourceBudget?: ResourceBudget;
  readonly workspace?: WorkspaceHandle;
  readonly sandbox?: SandboxHandle;
  readonly probe?: EffectPostStateProbe;
  readonly reasoningPolicy?: AgentReasoningPolicy;
}

/**
 * Everything the Auditor's context may be built from. Deliberately a closed shape: the acceptance
 * contract, the task as it stands, and what the deterministic verdict found. No Executor output.
 */
export interface AuditorContextRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly turnIndex: number;
  readonly snapshot: EntryAcceptanceSnapshot;
  readonly capsuleFingerprint: ContentHash;
  readonly capsuleRevision: number;
  readonly changedPaths: readonly string[];
  readonly findings: readonly string[];
}

export type AuditorContextSource = (
  request: AuditorContextRequest,
  context: OperationContext,
) => Promise<AgentTurnContext>;

export interface TaskAuditorRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly snapshot: EntryAcceptanceSnapshot;
  /**
   * The Auditor's own dispatch, derived after execution from the frozen contract and the
   * authoritative result state. Nothing of the Executor's run reaches the Auditor through it.
   */
  readonly handoff: RoleHandoff;
  readonly expectedHandoffFingerprint: ContentHash;
  /** The workspace the audited result lives in, observed now. */
  readonly observedWorkspace: AuditedWorkspace;
  readonly currentFingerprints: Readonly<Record<string, string>>;
  readonly changedPaths: readonly string[];
  readonly executorOutcome: "ready_for_verification" | "deferred" | "stopped";
}

export interface TaskAuditorResult {
  readonly manifest: RoleInvocationManifest;
  /** The authority. Deterministic, and never influenced by `advisory`. */
  readonly verdict: AuditVerdict;
  /** What a model said, when one was asked. Recorded, never consulted. */
  readonly advisory: AgentLoopOutcome | null;
  readonly observationEntryId: string | null;
}

const AUDIT_CONTEXT_FINGERPRINT_FALLBACK = "audit";

export async function runTaskAuditor(
  dependencies: TaskAuditorDependencies,
  request: TaskAuditorRequest,
  context: OperationContext,
): Promise<TaskAuditorResult> {
  const { handoff } = request;
  // The dispatch first: everything below is read from it rather than from the caller.
  assertRoleHandoff(handoff, request.expectedHandoffFingerprint);
  if (handoff.role !== "auditor" || handoff.taskId !== request.taskId) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "This handoff does not dispatch this Auditor.",
      {
        details: { role: handoff.role, taskId: handoff.taskId, requested: request.taskId },
      },
    );
  }
  // The contract it was dispatched against, before it reads anything at all.
  assertEntryAcceptanceContract(request.snapshot, handoff.acceptanceContractFingerprint);
  // And the operations it may hold, before a manifest exists to hold them.
  const allowedOperations = assertRoleInvocationPermitted(
    "auditor",
    handoff.allowedOperations as readonly SemanticOperationId[],
  );

  const current = await dependencies.tasks.loadCurrent(request.taskId, context);
  if (current === null) {
    throw new ApplicationError("NOT_FOUND", "There is no task capsule to audit.", {
      details: { taskId: request.taskId },
    });
  }
  // A capsule that advanced during execution is the ordinary case. One that regressed, or a
  // workspace that was rebound, cannot be the result of the execution this audit follows.
  assertHandoffResultStateCompatible(handoff, {
    capsule: current.capsule,
    workspaceId: request.observedWorkspace.workspaceId,
    workspaceFingerprint: request.observedWorkspace.workspaceFingerprint,
  });

  const verdict = await auditTaskResult(
    { evidence: dependencies.evidence, ledger: dependencies.ledger },
    {
      snapshot: request.snapshot,
      expectedContractFingerprint: handoff.acceptanceContractFingerprint,
      capsule: current.capsule,
      workspace: request.observedWorkspace,
      currentFingerprints: request.currentFingerprints,
      changedPaths: request.changedPaths,
      executorOutcome: request.executorOutcome,
    },
    context,
  );

  const advisory = await runAdvisoryAudit(dependencies, request, current.capsule, verdict, context);
  const manifest = mintRoleInvocationManifest({
    role: "auditor",
    taskId: request.taskId,
    capsuleFingerprint: current.capsule.fingerprint,
    contextFingerprint:
      advisory?.turns[0]?.contextFingerprint ?? (verdict.contractFingerprint as ContentHash),
    modelId: ModelId.parse(handoff.modelId),
    allowedOperations,
    skillVersions: handoff.skillVersions,
    harnessVersion: handoff.harnessVersion,
    acceptanceContractFingerprint: handoff.acceptanceContractFingerprint,
  });

  const observationEntryId =
    dependencies.generateEntryId === undefined
      ? null
      : await recordRoleInvocation(
          {
            unitOfWork: dependencies.unitOfWork,
            ledger: dependencies.ledger,
            generateEntryId: dependencies.generateEntryId,
            now: dependencies.now,
          },
          request,
          manifest,
          context,
        );

  // `verdict` is returned exactly as the deterministic audit produced it. There is no branch above
  // or below this line in which `advisory` can change it.
  return Object.freeze({ manifest, verdict, advisory, observationEntryId });
}

/**
 * Runs the optional read-only model pass over the Auditor's own fresh context.
 *
 * It is wired to the same governed loop every other role uses, so anything it proposes is still
 * validated, authorized, and recorded — and the manifest it runs under holds no operation that
 * could change anything.
 */
async function runAdvisoryAudit(
  dependencies: TaskAuditorDependencies,
  request: TaskAuditorRequest,
  capsule: { readonly fingerprint: ContentHash; readonly capsuleRevision: number },
  verdict: AuditVerdict,
  context: OperationContext,
): Promise<AgentLoopOutcome | null> {
  const { gateway, surface, reconciler, buildContext, budget, resourceBudget, workspace, sandbox } =
    dependencies;
  // No gateway means no advisory pass, which is a complete audit: the verdict never needed one.
  if (gateway === undefined) return null;
  // But a gateway with half its wiring is a composition mistake, and silently skipping the pass
  // would report an audit that quietly did less than the caller asked for.
  const missing = Object.entries({
    surface,
    reconciler,
    buildContext,
    budget,
    resourceBudget,
    workspace,
    sandbox,
  })
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (
    missing.length > 0 ||
    surface === undefined ||
    reconciler === undefined ||
    buildContext === undefined ||
    budget === undefined ||
    resourceBudget === undefined ||
    workspace === undefined ||
    sandbox === undefined
  ) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "An advisory audit pass needs its full governed wiring; skipping it silently would report an audit that did less than was asked.",
      { details: { missing: Object.freeze(missing) } },
    );
  }
  return runAgentTurnLoop(
    {
      gateway,
      surface,
      reconciler,
      tasks: dependencies.tasks,
      ledger: dependencies.ledger,
      unitOfWork: dependencies.unitOfWork,
      // The closed audit shape, not the executor's. There is nothing here to leak.
      buildContext: (loopRequest, operation) =>
        buildContext(
          {
            taskId: request.taskId,
            jobId: request.jobId,
            turnIndex: loopRequest.turnIndex,
            snapshot: request.snapshot,
            capsuleFingerprint: capsule.fingerprint,
            capsuleRevision: capsule.capsuleRevision,
            changedPaths: request.changedPaths,
            findings: verdict.reasons,
          },
          operation,
        ),
      generateEntryId: dependencies.generateEntryId ?? (() => AUDIT_CONTEXT_FINGERPRINT_FALLBACK),
      generateInvocationId:
        dependencies.generateInvocationId ?? ((turnIndex) => `invocation-audit-${turnIndex}`),
      now: dependencies.now,
    },
    {
      taskId: request.taskId,
      jobId: request.jobId,
      modelId: ModelId.parse(request.handoff.modelId),
      role: "auditor",
      allowedOperations: request.handoff.allowedOperations as readonly SemanticOperationId[],
      reasoningPolicy: request.handoff.reasoningPolicy,
      budget,
      resourceBudget,
      workspace,
      sandbox,
      probe: dependencies.probe ?? (async () => ({ kind: "unknown", reason: "audits observe" })),
    },
    context,
  );
}
