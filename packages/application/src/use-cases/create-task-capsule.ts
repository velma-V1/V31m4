import {
  TaskCapsule,
  type TaskCapsuleInput,
  type TaskCapsule as TaskCapsuleType,
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
import { assessTaskEvidence, TaskEvidenceScope } from "../services/task-transition-policy.js";
import { resolveTaskEvidence } from "./task-evidence.js";

export interface CreateTaskCapsuleDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capsules: TaskCapsuleRepositoryPort;
  /** The one authoritative evidence store; see `proposeTaskTransition`. */
  readonly evidence: EvidenceRepositoryPort;
}

export interface CreateTaskCapsuleResult {
  readonly capsule: TaskCapsuleType;
  readonly head: Versioned<TaskCapsuleHead>;
}

/**
 * Creates a task's first logical revision and the head that points at it, in one transaction.
 * `mustNotExist` makes re-creating an existing task a conflict rather than a silent reset.
 *
 * A capsule may be created already carrying verified evidence references. Those clear exactly the
 * bar a transition's citations do — otherwise seeding the first revision would be a way to declare
 * unverified references "verified" and have every later transition inherit them unchallenged.
 */
export async function createTaskCapsule(
  dependencies: CreateTaskCapsuleDependencies,
  input: TaskCapsuleInput,
  context: OperationContext,
): Promise<CreateTaskCapsuleResult> {
  const capsule = TaskCapsule.create(input);
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    if (capsule.verifiedEvidenceIds.length > 0) {
      const assessment = assessTaskEvidence(
        // The first revision is the state being committed, so it is its own prospective scope.
        TaskEvidenceScope.of(capsule),
        capsule.verifiedEvidenceIds,
        await resolveTaskEvidence(
          dependencies.evidence,
          capsule.verifiedEvidenceIds,
          context,
          transaction,
        ),
      );
      const unverified = capsule.verifiedEvidenceIds.filter(
        (evidenceId) => !assessment.verifiedEvidenceIds.has(evidenceId),
      );
      if (unverified.length > 0) {
        throw new ApplicationError(
          "INVALID_APPLICATION_INPUT",
          "A capsule's verified evidence may only name records the evidence authority validated.",
          {
            details: {
              taskId: capsule.taskId,
              unverifiedEvidenceIds: Object.freeze([...unverified]),
            },
          },
        );
      }
    }
    const head = await dependencies.capsules.appendRevision(
      capsule,
      WriteConditions.mustNotExist(),
      context,
      transaction,
    );
    return Object.freeze({ capsule, head });
  });
}
