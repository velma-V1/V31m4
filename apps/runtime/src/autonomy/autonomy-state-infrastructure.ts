import {
  ApplicationError,
  type OperationContext,
  type PortPage,
  type PortPageRequest,
  type TaskCapsuleHead,
  type TaskCapsuleRepositoryPort,
  type UnitOfWorkTransaction,
  type Versioned,
  type WriteCondition,
} from "@v31m4/application";
import { TaskCapsule, type TaskCapsule as TaskCapsuleType, type TaskId } from "@v31m4/domain";
import { SqliteRecordStore, type SqliteRuntimeDatabase } from "@v31m4/infrastructure";

/**
 * Durable Task Capsule state on the existing record store.
 *
 * Two record types, reusing the one authoritative SQLite mechanism rather than introducing a
 * second store:
 *
 * - `task_capsule_revision` — immutable history, one record per logical revision, keyed
 *   `<taskId>#<capsuleRevision>` and written with `mustNotExist` so a revision can never be
 *   rewritten in place.
 * - `task_capsule_head` — one mutable pointer per task, guarded by the store's own optimistic
 *   concurrency revision.
 *
 * Both writes happen inside the caller's single transaction, revision first. If the head write
 * is refused, the enclosing transaction rolls the revision insert back with it, so a head can
 * never point at a missing revision and a revision can never be stranded by a failed head move.
 */
const REVISION_TYPE = "task_capsule_revision";
const HEAD_TYPE = "task_capsule_head";

function revisionKey(taskId: string, capsuleRevision: number): string {
  return `${taskId}#${capsuleRevision}`;
}

export class SqliteTaskCapsuleRepository implements TaskCapsuleRepositoryPort {
  readonly #records: SqliteRecordStore;

  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }

  async getHead(
    taskId: TaskId,
    _context?: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<TaskCapsuleHead> | null> {
    return this.#records.get<TaskCapsuleHead>(HEAD_TYPE, taskId);
  }

  async getRevision(
    taskId: TaskId,
    capsuleRevision: number,
    _context?: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<TaskCapsuleType | null> {
    const stored = await this.#records.get<unknown>(
      REVISION_TYPE,
      revisionKey(taskId, capsuleRevision),
    );
    // Rehydration re-verifies the fingerprint, so storage tampering surfaces as an error rather
    // than as trusted state.
    return stored === null ? null : TaskCapsule.rehydrate(stored.value);
  }

  async listRevisions(
    taskId: TaskId,
    request: PortPageRequest,
    _context?: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<TaskCapsuleType>> {
    const limit = Math.max(1, Math.min(request.limit, 500));
    // The repository's pagination convention: an exact non-negative decimal offset as the
    // cursor. Anything else is malformed rather than silently coerced to the first page.
    if (request.cursor !== undefined && !/^(?:0|[1-9]\d{0,15})$/u.test(request.cursor)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Pagination cursor is malformed.", {
        details: { cursor: request.cursor },
      });
    }
    const offset = request.cursor === undefined ? 0 : Number(request.cursor);
    const prefix = `${taskId}#`.replace(/[%_\\]/gu, "\\$&");
    const rows = this.database.connection
      .prepare(
        "SELECT body FROM records WHERE record_type = ? AND record_id LIKE ? ESCAPE '\\' ORDER BY rowid ASC",
      )
      .all(REVISION_TYPE, `${prefix}%`) as { body: string }[];
    const all = rows.map((row) => TaskCapsule.rehydrate(JSON.parse(row.body)));
    const page = all.slice(offset, offset + limit);
    return Object.freeze({
      items: Object.freeze(page),
      total: all.length,
      ...(offset + page.length < all.length ? { nextCursor: String(offset + page.length) } : {}),
    });
  }

  async appendRevision(
    capsule: TaskCapsuleType,
    headCondition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<TaskCapsuleHead>> {
    // History first. A `mustNotExist` append makes re-writing an existing logical revision a
    // conflict rather than a silent overwrite.
    await this.#records.append(
      REVISION_TYPE,
      revisionKey(capsule.taskId, capsule.capsuleRevision),
      capsule,
      transaction,
    );
    const head: TaskCapsuleHead = Object.freeze({
      taskId: capsule.taskId,
      capsuleRevision: capsule.capsuleRevision,
      fingerprint: capsule.fingerprint,
      updatedAt: capsule.updatedAt,
    });
    const stored = await this.#records.save(
      HEAD_TYPE,
      capsule.taskId,
      head,
      headCondition,
      transaction,
    );
    if (stored.value.capsuleRevision !== capsule.capsuleRevision) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "The stored head does not point at the revision just appended.",
        { details: { taskId: capsule.taskId } },
      );
    }
    return stored;
  }
}
