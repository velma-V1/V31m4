import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  decideRetry,
  type ExecutionLedgerRepositoryPort,
  type LedgerProjection,
  type OperationContext,
  reconcileExecutionEffect,
  type SandboxExecutionResult,
  type SandboxHandle,
  type SandboxPort,
  type UnitOfWorkPort,
  type UnitOfWorkTransaction,
} from "@v31m4/application";
import {
  type ContentHash,
  ExecutionLedgerEntry,
  type ExecutionLedgerEntry as LedgerEntry,
  type LedgerResourceFact,
  type TaskId,
} from "@v31m4/domain";

/**
 * The governed effect lifecycle, with the Execution Ledger recording what actually happened.
 *
 * The order is the whole point:
 *
 *   authorize (Task 1) → append effect_attempt → dispatch through SandboxPort
 *     → inspect verified post-state → append exactly one outcome
 *
 * The attempt is durable *before* anything can happen in the environment, so a crash mid-effect
 * leaves an unresolved attempt rather than silence. Nothing here re-authorizes, re-dispatches,
 * or retries: an effect whose result cannot be proved becomes
 * `reconciliation_indeterminate`, which blocks the same intent from being attempted again until
 * something observable resolves it.
 *
 * This composes Task 1 rather than replacing it. Authorization, the semantic operation catalog,
 * `SandboxPort`, and `WorkspaceManagerPort` all still apply; the reconciler only decides what to
 * write down.
 */
export type EffectPostState =
  | Readonly<{ kind: "applied"; facts: readonly LedgerResourceFact[] }>
  | Readonly<{ kind: "not_applied"; facts: readonly LedgerResourceFact[] }>
  | Readonly<{ kind: "unknown"; reason: string }>;

/**
 * Observes the world after a dispatch and reports whether the effect landed. Supplied by the
 * caller because only the caller knows how to verify its own operation. Anything it cannot
 * prove must be reported as `unknown` — guessing here would defeat the ledger.
 */
export type EffectPostStateProbe = (
  plan: AuthorizedSemanticExecutionPlan,
  result: SandboxExecutionResult | null,
  context: OperationContext,
) => Promise<EffectPostState>;

export interface EffectReconcilerDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly sandboxes: SandboxPort;
  readonly generateEntryId: () => string;
  readonly now: () => string;
}

export interface GovernedEffectRequest {
  readonly taskId: TaskId;
  readonly sandbox: SandboxHandle;
  readonly plan: AuthorizedSemanticExecutionPlan;
  readonly probe: EffectPostStateProbe;
}

export interface GovernedEffectOutcome {
  readonly attemptEntryId: string;
  readonly outcomeEntryId: string;
  readonly outcomeKind:
    | "effect_confirmation"
    | "effect_nonapplication"
    | "reconciliation_indeterminate";
  readonly result: SandboxExecutionResult | null;
}

export class EffectReconciler {
  constructor(private readonly dependencies: EffectReconcilerDependencies) {}

  /**
   * The current folded history for a task, read from durable entries alone and from *all* of
   * them: the canonical scan follows the ledger's cursor to exhaustion rather than deciding
   * against whatever fits in one page.
   */
  async projection(
    taskId: TaskId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<LedgerProjection> {
    return reconcileExecutionEffect(this.dependencies, taskId, context, transaction);
  }

  /**
   * The deterministic identity of the effect this plan would perform, excluding everything that
   * varies between tries so a repeat is recognisable as a repeat.
   */
  intentFingerprintFor(plan: AuthorizedSemanticExecutionPlan): ContentHash {
    return ExecutionLedgerEntry.intentFingerprint({
      taskId: plan.taskId,
      operationId: plan.operationId,
      workspaceId: plan.workspaceId,
      command: plan.command,
      parameters: plan.parameters as never,
    });
  }

  /**
   * Every identity this effect is checked and recorded against must be the same identity it
   * executes under. The request carries its own `taskId`, and the plan and the sandbox each
   * carry theirs; if those disagree, an effect authorized for one task could be projected
   * against — and written into — another task's ledger. That is checked here, before the
   * projection, before the claim, and before dispatch, so a mismatch produces no ledger entry
   * and no backend call at all.
   */
  private assertScopedIdentity(request: GovernedEffectRequest): void {
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

  async runGovernedEffect(
    request: GovernedEffectRequest,
    context: OperationContext,
  ): Promise<GovernedEffectOutcome> {
    const { plan, sandbox, taskId } = request;
    this.assertScopedIdentity(request);
    const intentFingerprint = this.intentFingerprintFor(plan);

    // Claiming the intent is one atomic step, not a check followed by a write. Reading the
    // history, deciding, and appending the attempt all happen inside a single authoritative
    // transaction, so a second caller for the same intent waits for this commit and then sees
    // the unresolved attempt it must lose to. Nothing may reach the environment until the claim
    // is durable — which is also what makes a crash from here on show up as an unresolved
    // attempt rather than as silence.
    const attempt = await this.dependencies.unitOfWork.execute(context, async (transaction) => {
      const decision = decideRetry(
        await this.projection(taskId, context, transaction),
        intentFingerprint,
      );
      if (!decision.allowed) {
        throw new ApplicationError(
          "CONFLICT",
          `This effect cannot be attempted again: ${decision.reason}.`,
          {
            details: {
              taskId,
              operationId: plan.operationId,
              code: decision.code,
              attemptEntryId: decision.attemptEntryId,
            },
          },
        );
      }
      const claimed = ExecutionLedgerEntry.create({
        id: this.dependencies.generateEntryId(),
        taskId,
        jobId: plan.jobId,
        recordedAt: this.dependencies.now(),
        detail: `attempting ${plan.operationId}`,
        kind: "effect_attempt",
        intentFingerprint,
        operationId: plan.operationId,
        workspaceId: plan.workspaceId,
        sandboxId: plan.sandboxId,
      });
      await appendExecutionLedgerEntry(this.dependencies, claimed, context, transaction);
      return claimed;
    });

    let result: SandboxExecutionResult | null = null;
    let dispatchFailure: string | null = null;
    try {
      result = await this.dependencies.sandboxes.execute(sandbox, plan, context);
    } catch (error) {
      // A refused or failed dispatch is not proof that nothing happened; the probe decides.
      dispatchFailure = error instanceof Error ? error.message : "dispatch failed";
    }

    const post = await this.observePostState(request, result, context);
    return this.recordOutcome(request, attempt, result, post, dispatchFailure, context);
  }

  async observePostState(
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

  private async recordOutcome(
    request: GovernedEffectRequest,
    attempt: LedgerEntry,
    result: SandboxExecutionResult | null,
    post: EffectPostState,
    dispatchFailure: string | null,
    context: OperationContext,
  ): Promise<GovernedEffectOutcome> {
    const common = {
      id: this.dependencies.generateEntryId(),
      taskId: request.taskId,
      jobId: request.plan.jobId,
      recordedAt: this.dependencies.now(),
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
    await appendExecutionLedgerEntry(this.dependencies, entry, context);

    return Object.freeze({
      attemptEntryId: attempt.id,
      outcomeEntryId: entry.id,
      outcomeKind,
      result,
    });
  }
}
