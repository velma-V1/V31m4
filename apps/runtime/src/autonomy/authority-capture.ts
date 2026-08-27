import type {
  AuthorizedSemanticExecutionPlan,
  ExecutionLedgerRepositoryPort,
  OperationContext,
  SandboxExecutionResult,
  SandboxHandle,
  SandboxPort,
  UnitOfWorkPort,
} from "@v31m4/application";
import type { EffectReconcilerDependencies } from "./effect-reconciler-contracts.js";

/**
 * Capturing authority at construction, so later mutation cannot redirect it.
 *
 * Holding a *reference* to a collaborator is not the same as holding its behaviour. A private
 * reference to a public object still resolves `object.method` at call time, so replacing that
 * property — on the instance or on its prototype — redirects a privileged call even though the
 * reference itself was never reachable. Everything here therefore captures the method *values*
 * once, bound to their owners, and returns a frozen façade. What executes later is what existed
 * at canonical construction.
 *
 * ## Trust boundary
 *
 * This is where the hardening stops, deliberately, and the line is worth stating so the recursion
 * does not continue forever.
 *
 * **In scope.** Code that possesses and mutates anything this runtime hands out or was handed:
 * the surface, the reconciler, the sandbox lifecycle façade, the options object passed to
 * `create`, the dependencies wrapper passed to `createEffectReconciler`, sandbox handles,
 * execution plans, and the public prototypes and method properties of any of them — including
 * after canonical construction. None of that may redirect execution or authoritative ledger
 * state.
 *
 * **Out of scope.** The composition-root-selected implementations themselves are trusted: the
 * policy engine, the sandbox backend, the workspace authority, the SQLite ledger repository's
 * internals, the unit of work's internals, and the lexical state of loaded modules. Their entry
 * methods are captured here at construction; corrupting their hidden internal state, or
 * rewriting module-local lexical state, is trusted-runtime process compromise and is a different
 * gate from this one.
 */

/** Sandbox lifecycle without execution: the only sandbox surface a governed caller receives. */
export type GovernedSandboxLifecycle = Readonly<
  Pick<SandboxPort, "prepare" | "inspect" | "cancel" | "destroy">
>;

/** The canonical effect sink, captured. */
export type CapturedSandboxExecute = (
  sandbox: SandboxHandle,
  plan: AuthorizedSemanticExecutionPlan,
  context: OperationContext,
) => Promise<SandboxExecutionResult>;

/**
 * Lifecycle only — deliberately **no `execute`**.
 *
 * Exposing a full `SandboxPort` made Task 3 optional: a caller holding a canonical plan could
 * reach the backend directly, past the reconciler, so no `effect_attempt` was durable before the
 * environment changed. That inverts the ordering invariant the Execution Ledger exists to hold.
 * Semantic effects now have exactly one gateway, `EffectReconciler.runGovernedEffect`, because
 * this façade offers no other.
 */
export function captureSandboxLifecycle(sandboxes: SandboxPort): GovernedSandboxLifecycle {
  return Object.freeze({
    prepare: sandboxes.prepare.bind(sandboxes),
    inspect: sandboxes.inspect.bind(sandboxes),
    cancel: sandboxes.cancel.bind(sandboxes),
    destroy: sandboxes.destroy.bind(sandboxes),
  });
}

/** The effect sink itself, bound once so a later `prototype.execute` patch cannot replace it. */
export function captureSandboxExecute(sandboxes: SandboxPort): CapturedSandboxExecute {
  return sandboxes.execute.bind(sandboxes);
}

/**
 * A private, frozen copy of the reconciler's dependencies.
 *
 * The caller's wrapper is never retained. Freezing that wrapper would not have been enough — it
 * belongs to the caller, who can hand over one object and mutate it afterwards — so a new object
 * is built here from method values captured at this instant.
 */
export function captureDependencies(
  dependencies: EffectReconcilerDependencies,
): EffectReconcilerDependencies {
  const ledger: ExecutionLedgerRepositoryPort = dependencies.ledger;
  const unitOfWork: UnitOfWorkPort = dependencies.unitOfWork;
  return Object.freeze({
    ledger: Object.freeze({
      append: ledger.append.bind(ledger),
      getById: ledger.getById.bind(ledger),
      listForTask: ledger.listForTask.bind(ledger),
    }),
    unitOfWork: Object.freeze({ execute: unitOfWork.execute.bind(unitOfWork) }),
    generateEntryId: dependencies.generateEntryId,
    now: dependencies.now,
  });
}
