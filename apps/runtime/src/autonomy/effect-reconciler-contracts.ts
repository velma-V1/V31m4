import type {
  AttemptOutcome,
  AuthorizedSemanticExecutionPlan,
  ExecutionLedgerRepositoryPort,
  OperationContext,
  PolicyEnginePort,
  SandboxExecutionResult,
  SandboxHandle,
  SandboxPort,
  UnitOfWorkPort,
} from "@v31m4/application";
import type { ContentHash, LedgerResourceFact, TaskId } from "@v31m4/domain";
import type { SandboxSupervisorOptions } from "@v31m4/infrastructure";

/**
 * The contracts of the governed effect lifecycle.
 *
 * Split out of `effect-reconciler.ts` to stay under the mandatory source-size limit. The seam is
 * deliberate rather than arbitrary: everything here describes *what may be asked of* the
 * reconciler, and the two request shapes are the whole point of the design — one carries an
 * execution capability, the other carries nothing but a durable attempt id.
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

/**
 * What the reconciler needs beyond its execution surface.
 *
 * There is deliberately **no** `sandboxes` and **no** `capabilities` here. Accepting an arbitrary
 * `SandboxPort` alongside an arbitrary verifier is precisely what let a reconciler be built whose
 * verifier and sink came from different Task 1 authorities — the reconciler would admit a
 * capability the sandbox would refuse, and record authoritative history for an effect that never
 * happened. Both now arrive together, from one factory, as a `GovernedExecutionSurface`.
 */
export interface EffectReconcilerDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly generateEntryId: () => string;
  readonly now: () => string;
}

/**
 * The paired execution authority an `EffectReconciler` runs against: one Task 1 verifier and the
 * one `SandboxPort` that same authority governs. Only a governed-execution-surface factory can
 * satisfy this, and it builds both halves from a single boundary.
 */
export interface PairedExecutionSurface {
  readonly sandboxes: SandboxPort;
  verifyExecutionAuthority(plan: AuthorizedSemanticExecutionPlan): void;
}

export interface GovernedEffectRequest {
  readonly taskId: TaskId;
  readonly sandbox: SandboxHandle;
  readonly plan: AuthorizedSemanticExecutionPlan;
  readonly probe: EffectPostStateProbe;
}

export type EffectOutcomeKind =
  | "effect_confirmation"
  | "effect_nonapplication"
  | "reconciliation_indeterminate";

export interface GovernedEffectOutcome {
  readonly attemptEntryId: string;
  readonly outcomeEntryId: string;
  readonly outcomeKind: EffectOutcomeKind;
  readonly result: SandboxExecutionResult | null;
}

/**
 * One effect attempt exactly as durable history records it — the only input a reconciliation
 * probe receives.
 *
 * Deliberately **not** an `AuthorizedSemanticExecutionPlan` and **not** a `SandboxHandle`. Both
 * are process-local: the capability lives in an authority's in-memory mint registry, and the
 * handle names a sandbox that a crash may have taken with it. Handing either to a reconciliation
 * probe would make restart-safety cosmetic — the caller could not build the argument after a
 * restart without fabricating execution authority for an effect it must never run.
 */
export type ReconciliationAttemptDescriptor = Readonly<{
  attemptEntryId: string;
  taskId: TaskId;
  jobId: string;
  operationId: string;
  workspaceId: string;
  sandboxId: string | null;
  intentFingerprint: ContentHash;
  outcome: AttemptOutcome;
}>;

/**
 * Observes the world on behalf of an attempt that already happened. It receives only what the
 * ledger durably knows, and it performs no effect — it reports what it can prove about reality.
 */
export type EffectReconciliationProbe = (
  attempt: ReconciliationAttemptDescriptor,
  context: OperationContext,
) => Promise<EffectPostState>;

/**
 * Settling an attempt that already happened.
 *
 * There is no plan, no sandbox, no fresh authorization and no dispatch: everything this needs is
 * read from the recorded attempt. `expectedIntentFingerprint` is an optional *integrity*
 * assertion — a caller stating which effect it believes it observed, so an observation of one
 * attempt cannot settle another. It is never authority.
 */
export interface EffectReconciliationRequest {
  readonly taskId: TaskId;
  readonly attemptEntryId: string;
  readonly expectedIntentFingerprint?: ContentHash;
  readonly probe: EffectReconciliationProbe;
}

export interface EffectReconciliationResult {
  readonly attemptEntryId: string;
  /** The attempt's state after this reconciliation. */
  readonly outcome: AttemptOutcome;
  /** The entry appended, or `null` when reality stayed unprovable and nothing changed. */
  readonly outcomeEntryId: string | null;
  readonly outcomeKind: EffectOutcomeKind | null;
  /** Why nothing was written, when nothing was. */
  readonly reason: string | null;
}

export const OUTCOME_FOR_POST_STATE: Readonly<Record<EffectPostState["kind"], AttemptOutcome>> =
  Object.freeze({
    applied: "confirmed",
    not_applied: "not_applied",
    unknown: "indeterminate",
  });

export const LEDGER_KIND_FOR_POST_STATE: Readonly<
  Record<EffectPostState["kind"], EffectOutcomeKind>
> = Object.freeze({
  applied: "effect_confirmation",
  not_applied: "effect_nonapplication",
  unknown: "reconciliation_indeterminate",
});

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

/** Everything the surface needs that is genuinely the caller's to choose. */
export interface GovernedExecutionSurfaceOptions
  extends Omit<SandboxSupervisorOptions, "capabilities"> {
  /** The canonical policy engine the semantic boundary consults for itself. */
  readonly policy: PolicyEnginePort;
  readonly generateExecutionPlanId?: () => string;
  readonly now?: () => string;
}
