import {
  ApplicationError,
  createTaskCapsule,
  type EvidenceRepositoryPort,
  type OperationContext,
  proposeTaskTransition,
  type TaskCapsuleHead,
  type TaskCapsuleRepositoryPort,
  type TaskTransitionProposal,
  type UnitOfWorkPort,
  type Versioned,
} from "@v31m4/application";
import type { TaskCapsuleChanges, TaskCapsuleInput, TaskId } from "@v31m4/domain";

/**
 * Runtime composition for durable task state.
 *
 * This is a wiring seam, not an orchestrator. It loads the authoritative current capsule, routes
 * creation and transition proposals through the existing use cases, and answers one deterministic
 * question about DAG state. Choosing *which* task to work on, with which model, role, and
 * context, belongs to the later Manager/Executor/Auditor phase and is deliberately absent here.
 */
export interface TaskManagerDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capsules: TaskCapsuleRepositoryPort;
  /**
   * The existing authoritative evidence store. A transition that claims evidence resolves it
   * here; nothing in this seam is a second evidence authority.
   */
  readonly evidence: EvidenceRepositoryPort;
}

export interface CurrentTask {
  readonly capsule: import("@v31m4/domain").TaskCapsule;
  readonly head: Versioned<TaskCapsuleHead>;
}

export class TaskManager {
  constructor(private readonly dependencies: TaskManagerDependencies) {}

  createTask(input: TaskCapsuleInput, context: OperationContext) {
    return createTaskCapsule(this.dependencies, input, context);
  }

  proposeTransition(
    proposal: TaskTransitionProposal,
    changes: TaskCapsuleChanges,
    context: OperationContext,
  ) {
    return proposeTaskTransition(this.dependencies, proposal, changes, context);
  }

  /**
   * Reads the authoritative current state: the head, then the exact revision it names. A head
   * that names a missing revision is an integrity failure, never a reason to fall back to some
   * other revision.
   */
  async loadCurrent(taskId: TaskId, context: OperationContext): Promise<CurrentTask | null> {
    const head = await this.dependencies.capsules.getHead(taskId, context);
    if (head === null) return null;
    const capsule = await this.dependencies.capsules.getRevision(
      taskId,
      head.value.capsuleRevision,
      context,
    );
    if (capsule === null) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "The task capsule head points at a revision that is missing.",
        { details: { taskId, capsuleRevision: head.value.capsuleRevision } },
      );
    }
    if (capsule.fingerprint !== head.value.fingerprint) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "The stored head fingerprint does not match the revision it names.",
        { details: { taskId, capsuleRevision: head.value.capsuleRevision } },
      );
    }
    return Object.freeze({ capsule, head });
  }
}

/**
 * Re-exported from the Manager use case, which is now the single definition.
 *
 * The rule is a pure function of an authoritative capsule, so it belongs with the selection use
 * case that depends on it rather than in a runtime wiring seam. Keeping the name reachable here
 * preserves every existing caller without leaving two copies of the traversal to drift apart.
 */
export { readyDagNodeIds } from "@v31m4/application";
