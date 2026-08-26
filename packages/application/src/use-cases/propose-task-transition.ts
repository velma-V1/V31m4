import {
  TaskCapsule,
  type TaskCapsuleChanges,
  type TaskCapsule as TaskCapsuleType,
  TaskId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type {
  TaskCapsuleHead,
  TaskCapsuleRepositoryPort,
} from "../ports/task-capsule-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import {
  TaskTransitionPolicy,
  type TaskTransitionProposal,
  type TaskTransitionRefusalCode,
} from "../services/task-transition-policy.js";

export interface ProposeTaskTransitionDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capsules: TaskCapsuleRepositoryPort;
}

export interface ProposeTaskTransitionResult {
  readonly capsule: TaskCapsuleType;
  readonly head: Versioned<TaskCapsuleHead>;
}

/** How a deterministic refusal is reported to a caller. */
const REFUSAL_ERRORS: Readonly<
  Record<TaskTransitionRefusalCode, "CONFLICT" | "INVALID_APPLICATION_INPUT" | "RESOURCE_EXHAUSTED">
> = Object.freeze({
  TASK_MISMATCH: "INVALID_APPLICATION_INPUT",
  STALE_CAPSULE_REVISION: "CONFLICT",
  PHASE_MISMATCH: "CONFLICT",
  ILLEGAL_TRANSITION: "INVALID_APPLICATION_INPUT",
  MISSING_EVIDENCE: "INVALID_APPLICATION_INPUT",
  INVALID_EVIDENCE: "INVALID_APPLICATION_INPUT",
  ATTEMPTS_EXHAUSTED: "RESOURCE_EXHAUSTED",
  INVALID_REASON: "INVALID_APPLICATION_INPUT",
});

/**
 * Validates a proposed phase transition and, only if every predicate holds, appends the next
 * logical revision and advances the head atomically.
 *
 * Two independent staleness checks apply, and both are required. The **logical** capsule
 * revision must be the one the proposer read, which the policy enforces; the **store** head
 * revision must also be the one the proposer read, which the write condition enforces. Passing
 * one does not excuse the other — that is the revision conflation this design forbids.
 */
export async function proposeTaskTransition(
  dependencies: ProposeTaskTransitionDependencies,
  proposal: TaskTransitionProposal,
  changes: TaskCapsuleChanges,
  context: OperationContext,
): Promise<ProposeTaskTransitionResult> {
  const taskId = TaskId.parse(proposal.taskId);
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const head = await dependencies.capsules.getHead(taskId, context, transaction);
    if (head === null) {
      throw new ApplicationError("NOT_FOUND", "The task capsule does not exist.", {
        details: { taskId },
      });
    }
    if (head.revision !== proposal.expectedHeadRevision) {
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "The task capsule head moved since the proposal was prepared.",
        {
          details: {
            taskId,
            expectedHeadRevision: proposal.expectedHeadRevision,
            actualHeadRevision: head.revision,
          },
        },
      );
    }

    const current = await dependencies.capsules.getRevision(
      taskId,
      head.value.capsuleRevision,
      context,
      transaction,
    );
    if (current === null) {
      // A head must never point at a revision that does not exist.
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "The task capsule head points at a revision that is missing.",
        { details: { taskId, capsuleRevision: head.value.capsuleRevision } },
      );
    }

    const decision = TaskTransitionPolicy.evaluate(current, proposal);
    if (!decision.allowed) {
      throw new ApplicationError(
        REFUSAL_ERRORS[decision.code],
        "The proposed task transition was refused.",
        {
          details: {
            taskId,
            code: decision.code,
            reasons: Object.freeze([...decision.reasons]),
          },
        },
      );
    }

    const next = TaskCapsule.next(current, {
      ...changes,
      phase: decision.to,
      attempts: current.attempts + decision.attemptCost,
      verifiedEvidenceIds: mergeEvidence(current, proposal, changes),
    });
    const advanced = await dependencies.capsules.appendRevision(
      next,
      WriteConditions.matchRevision(head.revision),
      context,
      transaction,
    );
    return Object.freeze({ capsule: next, head: advanced });
  });
}

/**
 * Evidence cited by an accepted transition becomes part of the capsule's verified references,
 * unless the caller is explicitly rewriting that set. Bounds and uniqueness are enforced by the
 * entity, so an overflowing merge is rejected rather than silently truncated.
 */
function mergeEvidence(
  current: TaskCapsuleType,
  proposal: TaskTransitionProposal,
  changes: TaskCapsuleChanges,
): readonly string[] {
  if (changes.verifiedEvidenceIds !== undefined) {
    return changes.verifiedEvidenceIds;
  }
  return [...new Set([...current.verifiedEvidenceIds, ...proposal.evidenceIds])];
}
