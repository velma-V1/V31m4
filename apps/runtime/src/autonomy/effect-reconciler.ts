import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  decideRetry,
  type ExecutionLedgerRepositoryPort,
  type LedgerProjection,
  type OperationContext,
  projectLedger,
  type SandboxExecutionResult,
  type SandboxHandle,
  type SandboxPort,
  type UnitOfWorkPort,
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

  /** The current folded history for a task, read from durable entries alone. */
  async projection(taskId: TaskId, context: OperationContext): Promise<LedgerProjection> {
    const page = await this.dependencies.ledger.listForTask(taskId, { limit: 500 }, context);
    return projectLedger(page.items);
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

  async runGovernedEffect(
    request: GovernedEffectRequest,
    context: OperationContext,
  ): Promise<GovernedEffectOutcome> {
    const { plan, sandbox, taskId } = request;
    const intentFingerprint = this.intentFingerprintFor(plan);

    // Refuse before anything happens: an unresolved, indeterminate, or already-applied intent
    // must not be attempted again.
    const decision = decideRetry(await this.projection(taskId, context), intentFingerprint);
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

    // The attempt is durable before dispatch. A crash from here on leaves it unresolved, which
    // is exactly what blocks a blind retry.
    const attempt = ExecutionLedgerEntry.create({
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
    await appendExecutionLedgerEntry(this.dependencies, attempt, context);

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
