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
import type { TaskCapsule, TaskCapsuleChanges, TaskCapsuleInput, TaskId } from "@v31m4/domain";

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
  readonly capsule: TaskCapsule;
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
 * DAG nodes that are workable right now: not blocked themselves, and with no blocked node
 * anywhere in their transitive dependencies. Returned in the capsule's own node order so the
 * answer is deterministic, and derived purely from stored state.
 *
 * Task 2's DAG models dependency and *blocker* state, which is what this reads. It deliberately
 * does not model per-node completion or decide which ready node to work on — selecting the next
 * task belongs to the later Manager phase.
 */
export function readyDagNodeIds(capsule: TaskCapsule): readonly string[] {
  const nodes = new Map(capsule.dagNodes.map((node) => [node.id, node]));
  const blockedTransitively = new Map<string, boolean>();

  const isBlocked = (id: string): boolean => {
    const cached = blockedTransitively.get(id);
    if (cached !== undefined) return cached;
    const node = nodes.get(id);
    if (node === undefined) return true;
    // Provisionally false so a malformed self-reference cannot loop; the entity already
    // guarantees the DAG is acyclic.
    blockedTransitively.set(id, false);
    const blocked = node.blocked || node.dependsOn.some((dependency) => isBlocked(dependency));
    blockedTransitively.set(id, blocked);
    return blocked;
  };

  return Object.freeze(
    capsule.dagNodes.filter((node) => !isBlocked(node.id)).map((node) => node.id),
  );
}
