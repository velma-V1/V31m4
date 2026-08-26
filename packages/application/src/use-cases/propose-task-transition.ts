import {
  TaskCapsule,
  type TaskCapsuleChanges,
  type TaskCapsule as TaskCapsuleType,
  TaskId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type {
  TaskCapsuleHead,
  TaskCapsuleRepositoryPort,
} from "../ports/task-capsule-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import {
  assessTaskEvidence,
  type TaskEvidenceAssessment,
  TaskEvidenceScope,
  TaskTransitionPolicy,
  type TaskTransitionProposal,
  type TaskTransitionRefusalCode,
} from "../services/task-transition-policy.js";
import { resolveTaskEvidence } from "./task-evidence.js";

export interface ProposeTaskTransitionDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capsules: TaskCapsuleRepositoryPort;
  /**
   * The one authoritative evidence store. Transitions that require proof resolve their citations
   * here rather than trusting the identifiers a proposer supplies; there is no second evidence
   * authority and no free-form assertion path.
   */
  readonly evidence: EvidenceRepositoryPort;
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

    // Evidence is judged against the state being **committed**, not the one that was read. A
    // transition can replace the acceptance criteria or the change artifacts in the same move, so
    // validating against `current` would let a record prove a subject the new capsule no longer
    // owns. Every reference that will exist afterwards is revalidated — carried references
    // included, because "it was in scope under the previous capsule" is not a claim about this
    // one. The verified set is bounded, so the revalidation is bounded too.
    const scope = TaskEvidenceScope.prospective(current, changes);
    const nextEvidenceIds = nextVerifiedEvidenceIds(current, proposal, changes);
    const mustResolve = [...new Set([...proposal.evidenceIds, ...nextEvidenceIds])];
    const assessment = assessTaskEvidence(
      scope,
      mustResolve,
      await resolveTaskEvidence(dependencies.evidence, mustResolve, context, transaction),
    );

    const decision = TaskTransitionPolicy.evaluate(current, proposal, assessment);
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

    // `verifiedEvidenceIds` may only ever hold references the evidence layer validated against
    // the scope this revision establishes. A transition may drop references and may keep or add
    // ones that are still in scope; it may not relabel an out-of-scope record as verified.
    assertOnlyVerifiedEvidence(taskId, nextEvidenceIds, assessment);

    const next = TaskCapsule.next(current, {
      ...changes,
      phase: decision.to,
      attempts: current.attempts + decision.attemptCost,
      verifiedEvidenceIds: nextEvidenceIds,
    });
    // The scope evidence was judged against must be the scope actually written. This can only
    // fail if the derivation above and the entity disagree, which would be a defect rather than
    // caller input — so it is an integrity failure, not a refusal.
    if (!TaskEvidenceScope.matches(scope, next)) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "The evidence scope evaluated does not match the revision being committed.",
        { details: { taskId, capsuleRevision: next.capsuleRevision } },
      );
    }
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
function nextVerifiedEvidenceIds(
  current: TaskCapsuleType,
  proposal: TaskTransitionProposal,
  changes: TaskCapsuleChanges,
): readonly string[] {
  if (changes.verifiedEvidenceIds !== undefined) {
    return [...new Set(changes.verifiedEvidenceIds)];
  }
  return [...new Set([...current.verifiedEvidenceIds, ...proposal.evidenceIds])];
}

/**
 * A capsule's `verifiedEvidenceIds` is a claim that the evidence layer verified those records
 * *for this capsule*. Neither rewriting the set through `changes` nor quietly carrying an earlier
 * reference forward may launder an identifier the current scope does not support.
 */
function assertOnlyVerifiedEvidence(
  taskId: string,
  nextEvidenceIds: readonly string[],
  assessment: TaskEvidenceAssessment,
): void {
  const unverified = nextEvidenceIds.filter(
    (evidenceId) => !assessment.verifiedEvidenceIds.has(evidenceId),
  );
  if (unverified.length === 0) return;
  throw new ApplicationError(
    "INVALID_APPLICATION_INPUT",
    "A capsule's verified evidence may only name records the evidence authority validated.",
    { details: { taskId, unverifiedEvidenceIds: Object.freeze([...unverified]) } },
  );
}
