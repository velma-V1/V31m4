import type { ContentHash, TaskCapsule, TaskId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

/**
 * The mutable pointer to a task's current logical revision.
 *
 * `TaskCapsuleHead.capsuleRevision` is the capsule's own logical revision number. The
 * `Versioned<TaskCapsuleHead>.revision` wrapped around it is the store's optimistic-concurrency
 * revision. They advance independently and must never be substituted for one another: the
 * logical revision is domain state, the store revision is a write condition.
 */
export interface TaskCapsuleHead {
  readonly taskId: TaskId;
  readonly capsuleRevision: number;
  readonly fingerprint: ContentHash;
  readonly updatedAt: string;
}

export interface TaskCapsuleRepositoryPort {
  getHead(
    taskId: TaskId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<TaskCapsuleHead> | null>;

  /** One immutable historical revision. Stored revisions are never updated in place. */
  getRevision(
    taskId: TaskId,
    capsuleRevision: number,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<TaskCapsule | null>;

  listRevisions(
    taskId: TaskId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<TaskCapsule>>;

  /**
   * Appends the immutable revision **and** advances the head, both inside the caller's single
   * transaction. Either both land or neither does: a head may never point at a revision that
   * does not exist, and a revision may never be stranded by a failed head write.
   *
   * `headCondition` carries the store-revision write condition — `mustNotExist` for a task's
   * first revision, `matchRevision` thereafter.
   */
  appendRevision(
    capsule: TaskCapsule,
    headCondition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<TaskCapsuleHead>>;
}
