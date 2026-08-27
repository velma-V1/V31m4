import {
  ApplicationError,
  type AttemptState,
  type ExecutionLedgerRepositoryPort,
  isTerminalAttemptOutcome,
  type LedgerProjection,
  type OperationContext,
  reconcileExecutionEffect,
  type UnitOfWorkPort,
  type UnitOfWorkTransaction,
} from "@v31m4/application";
import type { ContentHash, TaskId } from "@v31m4/domain";
import type {
  EffectPostState,
  EffectReconciliationProbe,
  ReconciliationAttemptDescriptor,
} from "./effect-reconciler-contracts.js";

/**
 * Finding the attempt a reconciliation is about, and describing it from durable history alone.
 *
 * Split out of `effect-reconciler.ts` so that file can own the runtime authority invariant — the
 * reconciler, the governed execution surface, and the module-private registries that link them
 * must share one module for those registries to stay unreachable.
 */

export interface ReconciliationLookup {
  readonly taskId: TaskId;
  readonly attemptEntryId: string;
  readonly expectedIntentFingerprint?: ContentHash;
}

/** The recorded attempt, as a descriptor built purely from durable history. */
export function describeAttempt(attempt: AttemptState): ReconciliationAttemptDescriptor {
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
 * The attempt must exist in this task's durable history and still be open to being settled.
 * Anything else is a deterministic conflict before any observation is made.
 *
 * Note what is *not* checked: no capability, no issuer, no policy grant. Task ownership comes
 * from the ledger scan itself, which reads only this task's history, so an attempt belonging to
 * another task is simply not found.
 */
export function requireReconcilableAttempt(
  projection: LedgerProjection,
  request: ReconciliationLookup,
): AttemptState {
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

/**
 * The folded history for a task, from durable entries alone.
 *
 * A free function rather than a method for the same reason as the rest of this module: a writable
 * prototype member could be replaced after construction to return an empty projection, which would
 * hide a blocking unresolved or confirmed attempt and let the same effect dispatch twice.
 */
export function projectionFor(
  dependencies: Readonly<{ ledger: ExecutionLedgerRepositoryPort; unitOfWork: UnitOfWorkPort }>,
  taskId: TaskId,
  context: OperationContext,
  transaction?: UnitOfWorkTransaction,
): Promise<LedgerProjection> {
  return reconcileExecutionEffect(dependencies, taskId, context, transaction);
}

/** A probe that cannot observe is not proof of anything; it leaves the attempt unproven. */
export async function observeReconciledState(
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
