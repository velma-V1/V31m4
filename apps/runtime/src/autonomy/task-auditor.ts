import {
  type AgentModelGatewayPort,
  type AgentReasoningPolicy,
  ApplicationError,
  type AuditVerdict,
  assertEntryAcceptanceContract,
  auditTaskResult,
  type EntryAcceptanceSnapshot,
  type EvidenceRepositoryPort,
  type ExecutionLedgerRepositoryPort,
  type OperationContext,
  type SandboxHandle,
  type UnitOfWorkPort,
  type WorkspaceHandle,
} from "@v31m4/application";
import type { ContentHash, JobId, ModelId, ResourceBudget, TaskId } from "@v31m4/domain";
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
 * every write, execute, and network-effect operation before the run begins.
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
  readonly modelId: ModelId;
  readonly snapshot: EntryAcceptanceSnapshot;
  readonly expectedContractFingerprint: ContentHash;
  readonly allowedOperations: readonly SemanticOperationId[];
  readonly skillVersions: readonly string[];
  readonly harnessVersion: string;
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
  // The contract this Auditor was dispatched against, before it reads anything at all.
  assertEntryAcceptanceContract(request.snapshot, request.expectedContractFingerprint);
  // And the operations it may hold, before a manifest exists to hold them.
  assertRoleInvocationPermitted("auditor", request.allowedOperations);

  const current = await dependencies.tasks.loadCurrent(request.taskId, context);
  if (current === null) {
    throw new ApplicationError("NOT_FOUND", "There is no task capsule to audit.", {
      details: { taskId: request.taskId },
    });
  }

  const verdict = await auditTaskResult(
    { evidence: dependencies.evidence, ledger: dependencies.ledger },
    {
      snapshot: request.snapshot,
      expectedContractFingerprint: request.expectedContractFingerprint,
      capsule: current.capsule,
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
    modelId: request.modelId,
    allowedOperations: request.allowedOperations,
    skillVersions: request.skillVersions,
    harnessVersion: request.harnessVersion,
    acceptanceContractFingerprint: request.snapshot.contractFingerprint,
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
      modelId: request.modelId,
      role: "auditor",
      allowedOperations: request.allowedOperations,
      reasoningPolicy: dependencies.reasoningPolicy ?? "disabled",
      budget,
      resourceBudget,
      workspace,
      sandbox,
      probe: dependencies.probe ?? (async () => ({ kind: "unknown", reason: "audits observe" })),
    },
    context,
  );
}
