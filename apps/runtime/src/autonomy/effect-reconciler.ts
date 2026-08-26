import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  canTransitionAttemptOutcome,
  decideRetry,
  type LedgerProjection,
  type OperationContext,
  reconcileExecutionEffect,
  type SandboxExecutionResult,
  type SandboxPort,
  type UnitOfWorkTransaction,
} from "@v31m4/application";
import { type ContentHash, ExecutionLedgerEntry, type TaskId } from "@v31m4/domain";
import { SandboxSupervisor } from "@v31m4/infrastructure";
import type {
  EffectPostState,
  EffectReconcilerDependencies,
  EffectReconciliationProbe,
  EffectReconciliationRequest,
  EffectReconciliationResult,
  GovernedEffectOutcome,
  GovernedEffectRequest,
  GovernedExecutionSurfaceOptions,
  PairedExecutionSurface,
  ReconciliationAttemptDescriptor,
} from "./effect-reconciler-contracts.js";
import {
  LEDGER_KIND_FOR_POST_STATE,
  OUTCOME_FOR_POST_STATE,
} from "./effect-reconciler-contracts.js";
import {
  assertScopedIdentity,
  observePostState,
  recordOutcome,
} from "./governed-effect-recording.js";
import { describeAttempt, requireReconcilableAttempt } from "./reconciliation-attempt-lookup.js";
import {
  createSemanticAuthorizationBoundary,
  type SemanticAuthorizationBoundary,
} from "./semantic-execution-authorization.js";

export * from "./effect-reconciler-contracts.js";

/**
 * The credential that links a governed execution surface to the reconciler it creates.
 *
 * Deliberately **not exported**. An earlier revision exported an equivalent token, which meant a
 * caller could import it and construct a reconciler around a hand-assembled surface pairing
 * authority A's verifier with authority B's sandbox — exactly the mismatch this design exists to
 * prevent. A credential that any caller can obtain is not a credential.
 */
const RECONCILER_CONSTRUCTION: unique symbol = Symbol("v31m4.effect-reconciler");

/**
 * Runtime authenticity for the two objects that carry authority here.
 *
 * Both registries and both predicates are module-private: not exported, not re-exported, not
 * reachable from any public value. That is the whole security property, and it is deliberately
 * *not* delegated to anything a caller can reach or replace.
 *
 * Two earlier revisions failed here in different ways. One exported the construction credential,
 * so a caller could import it and wrap a hand-assembled surface. The other routed the check
 * through a public static method — a writable property on an exported class — so replacing that
 * method with a no-op let a forged surface reach the real credential inside
 * `createEffectReconciler`. A security decision that any caller can rewrite is not a decision.
 *
 * Membership, not shape, prototype, `instanceof`, `Object.freeze`, or a TypeScript brand, is what
 * these answer — none of the others survives `Object.create`.
 */
const genuineSurfaces = new WeakSet<object>();
const genuineReconcilers = new WeakSet<object>();

function requireGenuineSurface(candidate: unknown): asserts candidate is GovernedExecutionSurface {
  if (typeof candidate !== "object" || candidate === null || !genuineSurfaces.has(candidate)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A governed execution surface must be one this runtime created, so that its Task 1 verifier and the sandbox it governs are provably the same authority.",
      {},
    );
  }
}

/**
 * Proves `this` is a reconciler whose constructor actually ran against a genuine surface.
 *
 * Without this, `Object.create(EffectReconciler.prototype)` skips the constructor entirely, and
 * because the reconciliation path reads only the ordinary `dependencies` property, assigning that
 * one field would hand an attacker authoritative settlement over recorded history.
 */
function requireGenuineReconciler(candidate: unknown): void {
  if (typeof candidate !== "object" || candidate === null || !genuineReconcilers.has(candidate)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Only an EffectReconciler created by a governed execution surface may read or write authoritative Execution Ledger history.",
      {},
    );
  }
}

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
   * Not constructible from outside this module.
   *
   * `RECONCILER_CONSTRUCTION` is a module-private symbol: it is never exported, never re-exported,
   * and never reachable through any public value, so importing the entire public surface of this
   * package does not yield it. The second check is the one that matters even inside the module —
   * `GovernedExecutionSurface.assertGenuine` proves the surface is an instance this module's own
   * `create` produced, so a structural object, a prototype forgery, or a hand-built pair of
   * `{ sandboxes, verifyExecutionAuthority }` taken from two different authorities is refused.
   * Together those close the pairing hole at runtime, not merely in the type system.
   */
  constructor(
    token: symbol,
    surface: PairedExecutionSurface,
    private readonly dependencies: EffectReconcilerDependencies,
  ) {
    if (token !== RECONCILER_CONSTRUCTION) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "An EffectReconciler is created only by a governed execution surface, so that its Task 1 verifier and its sandbox cannot come from different authorities.",
        {},
      );
    }
    // The module-private predicate, never the exported diagnostic: a public static is a writable
    // property on an exported class, so routing the decision through one would let it be replaced.
    requireGenuineSurface(surface);
    this.#surface = surface;
    genuineReconcilers.add(this);
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

  async runGovernedEffect(
    request: GovernedEffectRequest,
    context: OperationContext,
  ): Promise<GovernedEffectOutcome> {
    // This object first: a constructor-bypassed instance has no authority at all, however many
    // ordinary properties it carries.
    requireGenuineReconciler(this);
    const { plan, sandbox, taskId } = request;
    // Then the capability: before the projection this claim reads, before the attempt is
    // appended, and before anything reaches SandboxPort.
    this.requireCanonicalAuthority(plan);
    assertScopedIdentity(request);
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

    const post = await observePostState(request, result, context);
    return recordOutcome(
      this.dependencies,
      request,
      attempt,
      result,
      post,
      dispatchFailure,
      context,
    );
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
    // Before the ledger read that authorizes this settlement, before the probe, before any
    // append. Settling recorded history is authority, and only a canonically created reconciler
    // holds it.
    requireGenuineReconciler(this);
    const { taskId, attemptEntryId } = request;
    const attempt = requireReconcilableAttempt(await this.projection(taskId, context), request);
    const descriptor = describeAttempt(attempt);

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
}

/**
 * One governed execution surface: a Task 1 semantic authorization boundary, the sandbox that
 * boundary governs, and the Execution Ledger reconciler that records what they do.
 *
 * These three cannot be assembled from parts of different origins. Independently injecting a
 * verifier and a `SandboxPort` allowed a reconciler whose verifier came from authority A while its
 * sink enforced authority B: A's capabilities passed the reconciler's check, B refused them at the
 * sink, and the ledger recorded an authoritative outcome — including a *confirmation* — for an
 * effect that never reached a backend. There is no configuration of this factory that produces
 * that pairing, because the caller never supplies either half.
 *
 * Authenticity is a private static `WeakSet` populated only by `create`. `assertGenuine` is a
 * predicate, not a registration operation: there is no exported way to add a surface to it, so a
 * forged instance can never become genuine. `instanceof` alone would not do — `Object.create`
 * produces an object that passes it — which is why membership, not shape or prototype, decides.
 */
export class GovernedExecutionSurface {
  readonly #boundary: SemanticAuthorizationBoundary;
  readonly #sandboxes: SandboxPort;

  private constructor(boundary: SemanticAuthorizationBoundary, sandboxes: SandboxPort) {
    this.#boundary = boundary;
    this.#sandboxes = sandboxes;
  }

  /**
   * Builds the boundary and the sandbox together, from one authority, and records the result as
   * genuine. This is the only way a `GovernedExecutionSurface` comes into existence.
   */
  static create(options: GovernedExecutionSurfaceOptions): GovernedExecutionSurface {
    const { policy, generateExecutionPlanId, now, ...sandbox } = options;
    const boundary = createSemanticAuthorizationBoundary({
      policy,
      ...(generateExecutionPlanId === undefined ? {} : { generateExecutionPlanId }),
      ...(now === undefined ? {} : { now }),
    });
    const surface = new GovernedExecutionSurface(
      boundary,
      // The sandbox is paired with this boundary's verifier here and nowhere else.
      new SandboxSupervisor({ ...sandbox, capabilities: boundary.capabilities }),
    );
    genuineSurfaces.add(surface);
    return surface;
  }

  /**
   * A **diagnostic** predicate, not the security boundary.
   *
   * It reports the same answer as the module-private check, but nothing security-relevant calls
   * it: it is a public static, so it is a writable property on an exported class and a caller can
   * replace it. Construction consults `requireGenuineSurface` directly, so monkey-patching this
   * changes what a caller is told and nothing about what is permitted.
   */
  static isGenuine(candidate: unknown): boolean {
    return typeof candidate === "object" && candidate !== null && genuineSurfaces.has(candidate);
  }

  /** Requests an execution capability from this surface's own Task 1 boundary. */
  get authorize(): SemanticAuthorizationBoundary["authorize"] {
    return this.#boundary.authorize;
  }

  /**
   * The sandbox this surface governs. Safe to expose: it enforces the same authority, so handing
   * it out cannot create a mismatched pair — only `createEffectReconciler` decides what an
   * `EffectReconciler` runs against, and it always passes this surface itself.
   */
  get sandboxes(): SandboxPort {
    return this.#sandboxes;
  }

  /** Proves a capability came from this surface's boundary, and that its grant is still current. */
  verifyExecutionAuthority(plan: AuthorizedSemanticExecutionPlan): void {
    this.#boundary.capabilities.verify(plan);
  }

  /**
   * The reconciler for this surface. It receives the surface itself, so its authority check and
   * its dispatch sink are the same authority by construction rather than by convention.
   */
  createEffectReconciler(options: EffectReconcilerDependencies): EffectReconciler {
    return new EffectReconciler(RECONCILER_CONSTRUCTION, this, options);
  }
}
