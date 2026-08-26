import {
  TaskCapsule,
  type TaskCapsuleInput,
  type TaskCapsule as TaskCapsuleType,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type {
  TaskCapsuleHead,
  TaskCapsuleRepositoryPort,
} from "../ports/task-capsule-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";

export interface CreateTaskCapsuleDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capsules: TaskCapsuleRepositoryPort;
}

export interface CreateTaskCapsuleResult {
  readonly capsule: TaskCapsuleType;
  readonly head: Versioned<TaskCapsuleHead>;
}

/**
 * Creates a task's first logical revision and the head that points at it, in one transaction.
 * `mustNotExist` makes re-creating an existing task a conflict rather than a silent reset.
 */
export async function createTaskCapsule(
  dependencies: CreateTaskCapsuleDependencies,
  input: TaskCapsuleInput,
  context: OperationContext,
): Promise<CreateTaskCapsuleResult> {
  const capsule = TaskCapsule.create(input);
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const head = await dependencies.capsules.appendRevision(
      capsule,
      WriteConditions.mustNotExist(),
      context,
      transaction,
    );
    return Object.freeze({ capsule, head });
  });
}
