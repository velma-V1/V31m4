import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { copyFile, rename, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  ApplicationError,
  type OperationContext,
  type UnitOfWorkPort,
  type UnitOfWorkTransaction,
} from "@v31m4/application";

interface TransactionHooks {
  readonly commit: Array<() => void | Promise<void>>;
  readonly rollback: Array<() => void | Promise<void>>;
}

class SqliteTransaction implements UnitOfWorkTransaction {
  readonly id = `transaction-${randomUUID()}`;
  readonly startedAt: string;
  readonly hooks: TransactionHooks = { commit: [], rollback: [] };

  constructor(startedAt: string) {
    this.startedAt = startedAt;
  }
  afterCommit(action: () => void | Promise<void>): void {
    this.hooks.commit.push(action);
  }
  afterRollback(action: () => void | Promise<void>): void {
    this.hooks.rollback.push(action);
  }
}

export class SqliteRuntimeDatabase {
  #connection: DatabaseSync;
  readonly unitOfWork: UnitOfWorkPort;
  readonly #scope = new AsyncLocalStorage<SqliteTransaction>();
  #tail: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {
    this.#connection = new DatabaseSync(path);
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
    );
    this.#migrate();
    this.unitOfWork = Object.freeze({
      execute: <Result>(
        context: OperationContext,
        work: (transaction: UnitOfWorkTransaction) => Promise<Result>,
      ) => this.#execute(context, work),
    });
  }

  get connection(): DatabaseSync {
    return this.#connection;
  }
  close(): void {
    this.#connection.close();
  }

  async replaceWith(backupPath: string): Promise<void> {
    if (this.#scope.getStore() !== undefined) {
      throw new ApplicationError(
        "TRANSACTION_FAILED",
        "Cannot restore while a transaction is active.",
      );
    }
    const staged = `${this.path}.restore`;
    await copyFile(backupPath, staged);
    this.#connection.close();
    await rm(this.path, { force: true });
    await rm(`${this.path}-wal`, { force: true });
    await rm(`${this.path}-shm`, { force: true });
    await rename(staged, this.path);
    this.#connection = new DatabaseSync(this.path);
    this.#connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
    );
    this.#migrate();
  }

  assertTransaction(transaction: UnitOfWorkTransaction): void {
    const active = this.#scope.getStore();
    if (active === undefined || active.id !== transaction.id) {
      throw new ApplicationError(
        "TRANSACTION_FAILED",
        "Transaction is not active for this database.",
      );
    }
  }

  async #execute<Result>(
    context: OperationContext,
    work: (transaction: UnitOfWorkTransaction) => Promise<Result>,
  ): Promise<Result> {
    if (this.#scope.getStore() !== undefined) {
      throw new ApplicationError(
        "TRANSACTION_FAILED",
        "Nested authoritative transactions are forbidden.",
      );
    }
    let release: (() => void) | undefined;
    const previous = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const transaction = new SqliteTransaction(context.startedAt);
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = await this.#scope.run(transaction, () => work(transaction));
      this.connection.exec("COMMIT");
      for (const action of transaction.hooks.commit) await action();
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      for (const action of transaction.hooks.rollback) await action();
      throw error;
    } finally {
      release?.();
    }
  }

  #migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(
        record_type TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY(record_type, record_id)
      );
      CREATE TABLE IF NOT EXISTS outbox_events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL, published_at TEXT
      );
      CREATE TABLE IF NOT EXISTS idempotency_records(
        actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(actor_id, idempotency_key)
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, '2026-08-07T00:00:00.000Z');
    `);
  }
}
