import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  appendExecutionLedgerEntry,
  canTransitionAttemptOutcome,
  decideRetry,
  type LedgerProjection,
  type OperationContext,
  type SandboxExecutionResult,
  type UnitOfWorkTransaction,
} from "@v31m4/application";
import { type ContentHash, ExecutionLedgerEntry, type TaskId } from "@v31m4/domain";
import { SandboxSupervisor } from "@v31m4/infrastructure";
import {
  type CapturedSandboxExecute,
  captureDependencies,
  captureSandboxExecute,
  captureSandboxLifecycle,
  type GovernedSandboxLifecycle,
} from "./authority-capture.js";
import type {
  EffectReconcilerDependencies,
  EffectReconciliationRequest,
  EffectReconciliationResult,
  GovernedEffectOutcome,
  GovernedEffectRequest,
  GovernedExecutionSurfaceOptions,
} from "./effect-reconciler-contracts.js";
import {
  LEDGER_KIND_FOR_POST_STATE,
  OUTCOME_FOR_POST_STATE,
} from "./effect-reconciler-contracts.js";
import {
  assertScopedIdentity,
  intentFingerprintOf,
  observePostState,
  recordOutcome,
} from "./governed-effect-recording.js";
import {
  describeAttempt,
  observeReconciledState,
  projectionFor,
  requireReconcilableAttempt,
} from "./reconciliation-attempt-lookup.js";
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
 * Runtime authority state for the two objects that carry authority here.
 *
 * Identity alone was not enough, and neither was a private reference to a public object. Authority
 * does not live on these objects at all: it lives in module-private `WeakMap`s keyed by them,
 * holding behaviour captured at construction and frozen. Membership is both the identity brand and
 * the source of every privileged value, so shadowing a public member — on an instance or on a
 * prototype — changes what an ordinary caller sees and nothing about what executes. Neither map,
 * nor any operation that writes to one, is exported. See `authority-capture.ts` for what is
 * captured and for the trust boundary this stops at.
 */
interface SurfaceAuthorityState {
  readonly authorize: SemanticAuthorizationBoundary["authorize"];
  /** Captured at construction: a later prototype or instance patch cannot replace it. */
  readonly verifyExecutionAuthority: (plan: AuthorizedSemanticExecutionPlan) => void;
  /** The canonical effect sink, bound once. Never reached through a property lookup. */
  readonly executeSandbox: CapturedSandboxExecute;
  /** Lifecycle only. There is deliberately no execution path in what callers receive. */
  readonly lifecycle: GovernedSandboxLifecycle;
}

interface ReconcilerAuthorityState {
  readonly surface: SurfaceAuthorityState;
  /** A private frozen snapshot; the caller's wrapper is never retained. */
  readonly dependencies: EffectReconcilerDependencies;
}

const surfaceState = new WeakMap<object, SurfaceAuthorityState>();
const reconcilerState = new WeakMap<object, ReconcilerAuthorityState>();

function requireSurfaceState(candidate: unknown): SurfaceAuthorityState {
  const state =
    typeof candidate === "object" && candidate !== null ? surfaceState.get(candidate) : undefined;
  if (state === undefined) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A governed execution surface must be one this runtime created, so that its Task 1 verifier and the sandbox it governs are provably the same authority.",
      {},
    );
  }
  return state;
}

/**
 * The authority behind a reconciler, or a refusal.
 *
 * A constructor-bypassed `Object.create(EffectReconciler.prototype)` has no entry however many
 * ordinary properties it carries, and a genuine reconciler whose `dependencies` property has been
 * redefined still yields the ledger, unit of work, id generator, and clock it was built with.
 */
function requireReconcilerState(candidate: unknown): ReconcilerAuthorityState {
  const state =
    typeof candidate === "object" && candidate !== null
      ? reconcilerState.get(candidate)
      : undefined;
  if (state === undefined) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Only an EffectReconciler created by a governed execution surface may read or write authoritative Execution Ledger history.",
      {},
    );
  }
  return state;
}

export class EffectReconciler {
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
    surface: GovernedExecutionSurface,
    dependencies: EffectReconcilerDependencies,
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
    // The surface must be one this module created; its authority is then bound to this
    // reconciler in module-private state, frozen, and never read from a public member again.
    // Resolve the surface's authority now and keep *that*, not the surface object: nothing this
    // reconciler does later depends on a property lookup a caller could redirect.
    reconcilerState.set(
      this,
      Object.freeze({
        surface: requireSurfaceState(surface),
        dependencies: captureDependencies(dependencies),
      }),
    );
  }

  /**
   * The current folded history for a task, read from durable entries alone and from *all* of
   * them: the canonical scan follows the ledger's cursor to exhaustion rather than deciding
   * against whatever fits in one page.
   */
  /**
   * The current folded history for a task.
   *
   * A convenience wrapper for callers and tests. Privileged code never routes through it — it is
   * a writable prototype member, so a patched version could hide a blocking attempt — and calls
   * the module-private `projectionFor` directly instead.
   */
  async projection(
    taskId: TaskId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<LedgerProjection> {
    return projectionFor(requireReconcilerState(this).dependencies, taskId, context, transaction);
  }

  /**
   * The deterministic identity of the effect this plan would perform.
   *
   * A convenience wrapper, for the same reason as `projection`: duplicate-intent protection rests
   * on this value, so privileged code calls the module-private `intentFingerprintOf` instead of a
   * member that could be replaced.
   */
  intentFingerprintFor(plan: AuthorizedSemanticExecutionPlan): ContentHash {
    return intentFingerprintOf(plan);
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
  async runGovernedEffect(
    request: GovernedEffectRequest,
    context: OperationContext,
  ): Promise<GovernedEffectOutcome> {
    // Every privileged value comes from module-private state, never from a property on `this` or
    // on the surface: a constructor-bypassed instance has no state at all, and a genuine object
    // whose public members were redefined still executes against the authority it was built with.
    const state = requireReconcilerState(this);
    const surface = state.surface;
    const { plan, sandbox, taskId } = request;
    // Then the capability: before the projection this claim reads, before the attempt is
    // appended, and before anything reaches SandboxPort.
    // The verifier captured from this surface's own boundary at construction — a function
    // value in module-private state, not a member anyone can replace.
    surface.verifyExecutionAuthority(plan);
    assertScopedIdentity(request);
    const intentFingerprint = intentFingerprintOf(plan);

    // Claiming the intent is one atomic step, not a check followed by a write. Reading the
    // history, deciding, and appending the attempt all happen inside a single authoritative
    // transaction, so a second caller for the same intent waits for this commit and then sees
    // the unresolved attempt it must lose to. Nothing may reach the environment until the claim
    // is durable — which is also what makes a crash from here on show up as an unresolved
    // attempt rather than as silence.
    const attempt = await state.dependencies.unitOfWork.execute(context, async (transaction) => {
      const decision = decideRetry(
        await projectionFor(state.dependencies, taskId, context, transaction),
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
        id: state.dependencies.generateEntryId(),
        taskId,
        jobId: plan.jobId,
        recordedAt: state.dependencies.now(),
        detail: `attempting ${plan.operationId}`,
        kind: "effect_attempt",
        intentFingerprint,
        operationId: plan.operationId,
        workspaceId: plan.workspaceId,
        sandboxId: plan.sandboxId,
      });
      await appendExecutionLedgerEntry(state.dependencies, claimed, context, transaction);
      return claimed;
    });

    let result: SandboxExecutionResult | null = null;
    let dispatchFailure: string | null = null;
    try {
      result = await surface.executeSandbox(sandbox, plan, context);
    } catch (error) {
      // A refused or failed dispatch is not proof that nothing happened; the probe decides.
      dispatchFailure = error instanceof Error ? error.message : "dispatch failed";
    }

    const post = await observePostState(request, result, context);
    return recordOutcome(
      state.dependencies,
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
    // holds it — together with the ledger and clock it was built with, not whichever ones a
    // caller has since attached to it.
    const { dependencies } = requireReconcilerState(this);
    const { taskId, attemptEntryId } = request;
    const attempt = requireReconcilableAttempt(
      await projectionFor(dependencies, taskId, context),
      request,
    );
    const descriptor = describeAttempt(attempt);

    // Observation happens outside any transaction — it is external execution, and Layer 7 forbids
    // that inside one. The append below re-reads the attempt's committed state, so a racing
    // reconciliation cannot slip a second terminal outcome in behind this probe.
    const post = await observeReconciledState(descriptor, request.probe, context);
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
      id: dependencies.generateEntryId(),
      taskId,
      // From the recorded attempt, so a reconciliation cannot be filed under another job.
      jobId: attempt.jobId,
      recordedAt: dependencies.now(),
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
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      await appendExecutionLedgerEntry(dependencies, entry, context, transaction);
    });

    return Object.freeze({
      attemptEntryId,
      outcome,
      outcomeEntryId: entry.id,
      outcomeKind,
      reason: null,
    });
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
  private constructor() {}

  /**
   * Builds the boundary and the sandbox together, from one authority, and binds that pairing into
   * module-private state. This is the only way a `GovernedExecutionSurface` comes into existence,
   * and the only way anything is ever written to `surfaceState`.
   */
  static create(options: GovernedExecutionSurfaceOptions): GovernedExecutionSurface {
    const { policy, preconditions, generateExecutionPlanId, now, ...sandbox } = options;
    const boundary = createSemanticAuthorizationBoundary({
      policy,
      preconditions,
      ...(generateExecutionPlanId === undefined ? {} : { generateExecutionPlanId }),
      ...(now === undefined ? {} : { now }),
    });
    // The sandbox is paired with this boundary's verifier here and nowhere else.
    const supervisor = new SandboxSupervisor({ ...sandbox, capabilities: boundary.capabilities });
    const capabilities = boundary.capabilities;
    const surface = new GovernedExecutionSurface();
    surfaceState.set(
      surface,
      Object.freeze({
        authorize: boundary.authorize,
        // Both captured immediately, before anything is exposed: what runs later is what existed
        // at this instant, whatever is patched onto the supervisor or its prototype afterwards.
        verifyExecutionAuthority: capabilities.verify.bind(capabilities),
        executeSandbox: captureSandboxExecute(supervisor),
        lifecycle: captureSandboxLifecycle(supervisor),
      }),
    );
    return surface;
  }

  /**
   * A **diagnostic** predicate, not the security boundary.
   *
   * It is a public static — a writable property on an exported class — so a caller can replace it.
   * Nothing security-relevant consults it: privileged code calls `requireSurfaceState` directly,
   * so monkey-patching this changes what a caller is told and nothing about what is permitted.
   */
  static isGenuine(candidate: unknown): boolean {
    return typeof candidate === "object" && candidate !== null && surfaceState.has(candidate);
  }

  /**
   * Requests an execution capability from this surface's own Task 1 boundary.
   *
   * Like every member below, this reads the boundary from private state rather than from a field,
   * so redefining a property on this instance cannot redirect it.
   */
  get authorize(): SemanticAuthorizationBoundary["authorize"] {
    return requireSurfaceState(this).authorize;
  }

  /**
   * Sandbox **lifecycle** for ordinary callers: prepare, inspect, cancel, destroy.
   *
   * Deliberately no `execute`, and no way to reach one from here — see `captureSandboxLifecycle`.
   * Every semantic effect has exactly one gateway, `EffectReconciler.runGovernedEffect`.
   */
  get sandboxes(): GovernedSandboxLifecycle {
    return requireSurfaceState(this).lifecycle;
  }

  /** Proves a capability came from this surface's boundary, and that its grant is still current. */
  verifyExecutionAuthority(plan: AuthorizedSemanticExecutionPlan): void {
    requireSurfaceState(this).verifyExecutionAuthority(plan);
  }

  /**
   * The reconciler for this surface. Its authority is bound from private state, so the two halves
   * are the same authority by construction rather than by convention.
   */
  createEffectReconciler(options: EffectReconcilerDependencies): EffectReconciler {
    requireSurfaceState(this);
    return new EffectReconciler(RECONCILER_CONSTRUCTION, this, options);
  }
}
