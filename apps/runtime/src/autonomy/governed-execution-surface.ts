import type {
  AuthorizedSemanticExecutionPlan,
  ExecutionLedgerRepositoryPort,
  PolicyEnginePort,
  SandboxPort,
  UnitOfWorkPort,
} from "@v31m4/application";
import { SandboxSupervisor, type SandboxSupervisorOptions } from "@v31m4/infrastructure";
import {
  EFFECT_RECONCILER_CONSTRUCTION_TOKEN,
  EffectReconciler,
  type EffectReconcilerDependencies,
} from "./effect-reconciler.js";
import {
  createSemanticAuthorizationBoundary,
  type SemanticAuthorizationBoundary,
} from "./semantic-execution-authorization.js";

/**
 * One governed execution surface: a Task 1 semantic authorization boundary, the sandbox that
 * boundary governs, and the Execution Ledger reconciler that records what they do.
 *
 * The point is that these three cannot be assembled from parts of different origins.
 * Independently injecting a verifier and a `SandboxPort` allowed a reconciler whose verifier came
 * from authority A while its sink enforced authority B: A's capabilities passed the reconciler's
 * check, B refused them at the sink, and the ledger recorded an authoritative outcome — including
 * a *confirmation* — for an effect that never reached a backend. There is no configuration of
 * this factory that produces that pairing, because the caller never supplies either half.
 *
 * What a caller supplies is the substrate: a policy engine, a sandbox backend, the workspace
 * authority, the approved operation set. The authority itself is created here and never escapes
 * except as `authorize` (mint, already closure-private) and `capabilities` (verify/consume only).
 */

/** Everything the surface needs that is genuinely the caller's to choose. */
export interface GovernedExecutionSurfaceOptions
  extends Omit<SandboxSupervisorOptions, "capabilities"> {
  /** The canonical policy engine the semantic boundary consults for itself. */
  readonly policy: PolicyEnginePort;
  readonly generateExecutionPlanId?: () => string;
  readonly now?: () => string;
}

/** What an `EffectReconciler` needs beyond the paired authority the surface owns. */
export type GovernedReconcilerOptions = EffectReconcilerDependencies &
  Readonly<{ unitOfWork: UnitOfWorkPort; ledger: ExecutionLedgerRepositoryPort }>;

export class GovernedExecutionSurface {
  readonly #boundary: SemanticAuthorizationBoundary;
  readonly #sandboxes: SandboxPort;

  private constructor(boundary: SemanticAuthorizationBoundary, sandboxes: SandboxPort) {
    this.#boundary = boundary;
    this.#sandboxes = sandboxes;
  }

  /**
   * Builds the boundary and the sandbox together, from one authority. This is the only way to
   * obtain a `GovernedExecutionSurface`: the constructor is private, so no caller can pair a
   * verifier with a sandbox it does not govern.
   */
  static create(options: GovernedExecutionSurfaceOptions): GovernedExecutionSurface {
    const { policy, generateExecutionPlanId, now, ...sandbox } = options;
    const boundary = createSemanticAuthorizationBoundary({
      policy,
      ...(generateExecutionPlanId === undefined ? {} : { generateExecutionPlanId }),
      ...(now === undefined ? {} : { now }),
    });
    return new GovernedExecutionSurface(
      boundary,
      // The sandbox is paired with this boundary's verifier here and nowhere else.
      new SandboxSupervisor({ ...sandbox, capabilities: boundary.capabilities }),
    );
  }

  /** Requests an execution capability from this surface's own Task 1 boundary. */
  get authorize(): SemanticAuthorizationBoundary["authorize"] {
    return this.#boundary.authorize;
  }

  /**
   * The sandbox this surface governs. Safe to expose: it enforces the same authority, so handing
   * it out cannot create a mismatched pair — only this class's own reconciler factory decides
   * what an `EffectReconciler` runs against.
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
  createEffectReconciler(options: GovernedReconcilerOptions): EffectReconciler {
    return new EffectReconciler(EFFECT_RECONCILER_CONSTRUCTION_TOKEN, this, options);
  }
}
