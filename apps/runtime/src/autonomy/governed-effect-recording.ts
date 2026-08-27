import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  type ExecutionLedgerRepositoryPort,
  type OperationContext,
  type SandboxExecutionResult,
  type UnitOfWorkPort,
} from "@v31m4/application";
import {
  type ContentHash,
  ExecutionLedgerEntry,
  type ExecutionLedgerEntry as LedgerEntry,
} from "@v31m4/domain";
import type {
  EffectPostState,
  GovernedEffectOutcome,
  GovernedEffectRequest,
} from "./effect-reconciler-contracts.js";

/**
 * The execution half of the governed effect lifecycle: proving scope, observing what happened,
 * and writing exactly one outcome.
 *
 * Split out of `effect-reconciler.ts` so that file can own the pairing invariant — the reconciler
 * and the governed execution surface must live in one module for the credential that links them
 * to stay module-private. Nothing here is reachable from the reconciliation path.
 */

export interface OutcomeRecordingDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly generateEntryId: () => string;
  readonly now: () => string;
}

/**
 * Every identity this effect is checked and recorded against must be the same identity it
 * executes under. The request carries its own `taskId`, and the plan and the sandbox each
 * carry theirs; if those disagree, an effect authorized for one task could be projected
 * against — and written into — another task's ledger. That is checked here, before the
 * projection, before the claim, and before dispatch, so a mismatch produces no ledger entry
 * and no backend call at all.
 */
export function assertScopedIdentity(request: GovernedEffectRequest): void {
  const { plan, sandbox, taskId } = request;
  const mismatches: string[] = [];
  if (taskId !== plan.taskId) mismatches.push("request.taskId != plan.taskId");
  if (plan.taskId !== sandbox.taskId) mismatches.push("plan.taskId != sandbox.taskId");
  if (plan.jobId !== sandbox.jobId) mismatches.push("plan.jobId != sandbox.jobId");
  if (plan.workspaceId !== sandbox.workspaceId) {
    mismatches.push("plan.workspaceId != sandbox.workspaceId");
  }
  // A governed effect always dispatches into a sandbox, so a plan that names no sandbox — or
  // names a different one — was not authorized for this execution.
  if (plan.sandboxId !== sandbox.id) mismatches.push("plan.sandboxId != sandbox.id");
  if (mismatches.length === 0) return;
  throw new ApplicationError(
    "PERMISSION_DENIED",
    "The effect's request, authorization, and sandbox do not describe the same scoped identity.",
    {
      details: {
        operationId: plan.operationId,
        requestTaskId: taskId,
        planTaskId: plan.taskId,
        sandboxTaskId: sandbox.taskId,
        mismatches: Object.freeze([...mismatches]),
      },
    },
  );
}

export async function observePostState(
  request: GovernedEffectRequest,
  result: SandboxExecutionResult | null,
  context: OperationContext,
): Promise<EffectPostState> {
  // An internal `unknown` sandbox status already means the effect is unproven; no probe can
  // upgrade that.
  if (result !== null && result.status === "unknown") {
    return Object.freeze({
      kind: "unknown" as const,
      reason: "the sandbox reported an unreconciled effect",
    });
  }
  try {
    return await request.probe(request.plan, result, context);
  } catch (error) {
    return Object.freeze({
      kind: "unknown" as const,
      reason: error instanceof Error ? error.message : "the post-state could not be observed",
    });
  }
}

export async function recordOutcome(
  dependencies: OutcomeRecordingDependencies,
  request: GovernedEffectRequest,
  attempt: LedgerEntry,
  result: SandboxExecutionResult | null,
  post: EffectPostState,
  dispatchFailure: string | null,
  context: OperationContext,
): Promise<GovernedEffectOutcome> {
  const common = {
    id: dependencies.generateEntryId(),
    taskId: request.taskId,
    jobId: request.plan.jobId,
    recordedAt: dependencies.now(),
    attemptEntryId: attempt.id,
  };
  const outcomeKind =
    post.kind === "applied"
      ? "effect_confirmation"
      : post.kind === "not_applied"
        ? "effect_nonapplication"
        : "reconciliation_indeterminate";

  const entry = ExecutionLedgerEntry.create({
    ...common,
    kind: outcomeKind,
    facts: post.kind === "unknown" ? [] : post.facts,
    detail:
      post.kind === "unknown"
        ? `${request.plan.operationId} could not be proved applied or unapplied: ${post.reason}`
        : `${request.plan.operationId} verified as ${post.kind}${
            dispatchFailure === null ? "" : ` after a failed dispatch: ${dispatchFailure}`
          }`,
  });
  await appendExecutionLedgerEntry(dependencies, entry, context);

  return Object.freeze({
    attemptEntryId: attempt.id,
    outcomeEntryId: entry.id,
    outcomeKind,
    result,
  });
}

/**
 * The deterministic identity of the effect a plan would perform, excluding everything that varies
 * between tries so a repeat is recognisable as a repeat.
 *
 * A module-private free function, not a method: duplicate-intent protection rests entirely on this
 * value, and a writable prototype member could be replaced after construction to hand identical
 * effects different fingerprints and defeat it.
 */
export function intentFingerprintOf(plan: AuthorizedSemanticExecutionPlan): ContentHash {
  return ExecutionLedgerEntry.intentFingerprint({
    taskId: plan.taskId,
    operationId: plan.operationId,
    workspaceId: plan.workspaceId,
    command: plan.command,
    parameters: plan.parameters as never,
  });
}
