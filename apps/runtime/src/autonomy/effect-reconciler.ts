import {
  ApplicationError,
  type AttemptState,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  canTransitionAttemptOutcome,
  decideRetry,
  isTerminalAttemptOutcome,
  type LedgerProjection,
  type OperationContext,
  reconcileExecutionEffect,
  type SandboxExecutionResult,
  type UnitOfWorkTransaction,
} from "@v31m4/application";
import {
  type ContentHash,
  ExecutionLedgerEntry,
  type ExecutionLedgerEntry as LedgerEntry,
  type TaskId,
} from "@v31m4/domain";
import type {
  EffectPostState,
  EffectReconcilerDependencies,
  EffectReconciliationProbe,
  EffectReconciliationRequest,
  EffectReconciliationResult,
  GovernedEffectOutcome,
  GovernedEffectRequest,
  PairedExecutionSurface,
  ReconciliationAttemptDescriptor,
} from "./effect-reconciler-contracts.js";
import {
  EFFECT_RECONCILER_CONSTRUCTION_TOKEN,
  LEDGER_KIND_FOR_POST_STATE,
  OUTCOME_FOR_POST_STATE,
} from "./effect-reconciler-contracts.js";

export * from "./effect-reconciler-contracts.js";

/**
 * The governed effect lifecycle, with the Execution Ledger recording what actually happened.
 *
 * The order is the whole point:
 *
 *   authorize (Task 1) → verify the issuer → append effect_attempt → dispatch through
 *     SandboxPort (which verifies and *spends* the capability) → inspect verified post-state
 *     → append exactly one outcome
 *
 * Issuer verification is this reconciler's own first step, not something it inherits from the
 * sink. The ledger is authoritative history; a capability minted by some other semantic
 * authorization boundary must not be able to write to it, and on the reconciliation path — which
 * never dispatches — the sink would never see it at all.
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
export class EffectReconciler {
  readonly #surface: PairedExecutionSurface;

  /**
   * Not publicly constructible: a governed-execution-surface factory passes the token along with
   * a surface whose verifier and sandbox provably come from one Task 1 authority. Hand-assembling
   * a reconciler from a verifier and a `SandboxPort` chosen independently is the mismatch this
   * refuses, at runtime as well as in the type system.
   */
  constructor(
    token: symbol,
    surface: PairedExecutionSurface,
    private readonly dependencies: EffectReconcilerDependencies,
  ) {
    if (token !== EFFECT_RECONCILER_CONSTRUCTION_TOKEN) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "An EffectReconciler is created only by a governed execution surface, so that its Task 1 verifier and its sandbox cannot come from different authorities.",
        {},
      );
    }
    this.#surface = surface;
  }

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

  /** The recorded attempt, as a descriptor built purely from durable history. */
  private static describe(attempt: AttemptState): ReconciliationAttemptDescriptor {
    return Object.freeze({
      attemptEntryId: attempt.attemptEntryId,
      taskId: attempt.taskId,
      jobId: attempt.jobId,
      operationId: attempt.operationId,
      workspaceId: attempt.workspaceId,
      sandboxId: attempt.sandboxId,
      intentFingerprint: attempt.intentFingerprint,
      outcome: attempt.outcome,
    });
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
   * Proves the capability was issued by the canonical Task 1 authority, before this reconciler
   * takes any authoritative action on its behalf.
   *
   * The sandbox verifies and spends the capability at the execution sink, but that is far too
   * late for Task 3: by then the attempt is already durable. A plan minted by a foreign semantic
   * authorization boundary — or a structural copy that merely looks like one — would otherwise
   * create authoritative ledger history, and on the reconciliation path, which never dispatches
   * at all, its issuer would never be checked by anyone.
   *
   * This is `verify`, never `consume`. Verification proves authenticity and issuer; consumption
   * is the single-use spend that belongs immediately before the real effect sink, where
   * `SandboxSupervisor` still performs it. Reconciliation performs no effect, so re-spending
   * execution authority there would be wrong — and an already-consumed capability stays
   * authentic, which is what lets the attempt it created be settled later.
   */
  private requireCanonicalAuthority(plan: AuthorizedSemanticExecutionPlan): void {
    this.#surface.verifyExecutionAuthority(plan);
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
    // Authority first: before the projection this claim reads, before the attempt is appended,
    // and before anything reaches SandboxPort.
    this.requireCanonicalAuthority(plan);
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
      result = await this.#surface.sandboxes.execute(sandbox, plan, context);
    } catch (error) {
      // A refused or failed dispatch is not proof that nothing happened; the probe decides.
      dispatchFailure = error instanceof Error ? error.message : "dispatch failed";
    }

    const post = await this.observePostState(request, result, context);
    return this.recordOutcome(request, attempt, result, post, dispatchFailure, context);
  }

  private async observePostState(
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

  /**
   * Settles an effect that was already attempted, from observed reality alone.
   *
   * This is the way out of a blocking-but-unsettled attempt — `unresolved`, `failed`, or
   * `indeterminate`. It **never dispatches**: the effect may already have landed, and running it
   * again to find out would be the duplicate the ledger exists to prevent.
   *
   * Settling is not executing, and this method is built so the two cannot be confused. It takes
   * no capability, verifies none, consumes none, and touches neither `SandboxPort` nor a backend.
   * Everything it needs — job, workspace, sandbox, operation, intent — is read from the durable
   * `effect_attempt` row. That is what makes an ambiguous effect settleable after the grant that
   * authorized it has expired, after policy has turned to deny, and after a restart has taken the
   * issuing authority's in-memory mint registry with it. None of those events changes what
   * already happened, so none of them may prevent recording it.
   *
   * The authority to settle is possession of this object: only a governed execution surface
   * builds one. There is no passable credential to forge, copy, or mis-pair.
   *
   * When reality is still unprovable, an attempt that has not yet been recorded as indeterminate
   * becomes indeterminate, and one that already is stays exactly as it is: repeating a status is
   * not progress and is never written. Nothing here consults a model.
   */
  async reconcileAttempt(
    request: EffectReconciliationRequest,
    context: OperationContext,
  ): Promise<EffectReconciliationResult> {
    const { taskId, attemptEntryId } = request;
    const attempt = await this.requireReconcilableAttempt(request, context);
    const descriptor = EffectReconciler.describe(attempt);

    // Observation happens outside any transaction — it is external execution, and Layer 7 forbids
    // that inside one. The append below re-reads the attempt's committed state, so a racing
    // reconciliation cannot slip a second terminal outcome in behind this probe.
    const post = await this.observeReconciledState(descriptor, request.probe, context);
    const outcome = OUTCOME_FOR_POST_STATE[post.kind];

    if (!canTransitionAttemptOutcome(attempt.outcome, outcome)) {
      // `requireReconcilableAttempt` already refused every terminal state, and both terminal
      // outcomes are reachable from all three reconcilable ones. So this is exactly one case:
      // still unprovable, and already on record as unprovable. Saying so beats appending a
      // no-progress entry that would only pad history.
      return Object.freeze({
        attemptEntryId,
        // The state as this reconciliation observed it; nothing here changed it.
        outcome: attempt.outcome,
        outcomeEntryId: null,
        outcomeKind: null,
        reason: post.kind === "unknown" ? post.reason : `already recorded as ${attempt.outcome}`,
      });
    }

    const outcomeKind = LEDGER_KIND_FOR_POST_STATE[post.kind];
    const entry = ExecutionLedgerEntry.create({
      id: this.dependencies.generateEntryId(),
      taskId,
      // From the recorded attempt, so a reconciliation cannot be filed under another job.
      jobId: attempt.jobId,
      recordedAt: this.dependencies.now(),
      attemptEntryId,
      kind: outcomeKind,
      facts: post.kind === "unknown" ? [] : post.facts,
      detail:
        post.kind === "unknown"
          ? `${attempt.operationId} still could not be proved applied or unapplied: ${post.reason}`
          : `${attempt.operationId} reconciled as ${post.kind} without re-dispatching`,
    });
    // One transaction: the append path folds the attempt's committed state and validates the
    // transition before writing, so exactly one of two concurrent reconciliations can win and the
    // loser gets a deterministic conflict.
    await this.dependencies.unitOfWork.execute(context, async (transaction) => {
      await appendExecutionLedgerEntry(this.dependencies, entry, context, transaction);
    });

    return Object.freeze({
      attemptEntryId,
      outcome,
      outcomeEntryId: entry.id,
      outcomeKind,
      reason: null,
    });
  }

  /** A probe that cannot observe is not proof of anything; it leaves the attempt unproven. */
  private async observeReconciledState(
    attempt: ReconciliationAttemptDescriptor,
    probe: EffectReconciliationProbe,
    context: OperationContext,
  ): Promise<EffectPostState> {
    try {
      return await probe(attempt, context);
    } catch (error) {
      return Object.freeze({
        kind: "unknown" as const,
        reason: error instanceof Error ? error.message : "the post-state could not be observed",
      });
    }
  }

  /**
   * The attempt must exist in this task's durable history and still be open to being settled.
   * Anything else is a deterministic conflict before any observation is made.
   *
   * Note what is *not* checked: no capability, no issuer, no policy grant. Task ownership comes
   * from the ledger scan itself, which reads only this task's history, so an attempt belonging to
   * another task is simply not found.
   */
  private async requireReconcilableAttempt(
    request: EffectReconciliationRequest,
    context: OperationContext,
  ): Promise<AttemptState> {
    const projection = await this.projection(request.taskId, context);
    const attempt = projection.attempts.find(
      (candidate) => candidate.attemptEntryId === request.attemptEntryId,
    );
    if (attempt === undefined) {
      throw new ApplicationError(
        "NOT_FOUND",
        "There is no such effect attempt in this task's history.",
        { details: { taskId: request.taskId, attemptEntryId: request.attemptEntryId } },
      );
    }
    if (attempt.taskId !== request.taskId) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "The recorded attempt belongs to a different task than the one being reconciled.",
        { details: { attemptEntryId: request.attemptEntryId, attemptTaskId: attempt.taskId } },
      );
    }
    if (
      request.expectedIntentFingerprint !== undefined &&
      attempt.intentFingerprint !== request.expectedIntentFingerprint
    ) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "The attempt being reconciled describes a different effect than the caller observed.",
        {
          details: {
            attemptEntryId: request.attemptEntryId,
            attemptOperationId: attempt.operationId,
          },
        },
      );
    }
    if (isTerminalAttemptOutcome(attempt.outcome)) {
      throw new ApplicationError(
        "CONFLICT",
        "This effect attempt has already settled and cannot be reconciled again.",
        { details: { attemptEntryId: request.attemptEntryId, outcome: attempt.outcome } },
      );
    }
    return attempt;
  }
}
