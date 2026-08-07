import {
  ApplicationError,
  type UnitOfWorkTransaction,
  type Versioned,
  type WriteCondition,
} from "@v31m4/application";
import type { SqliteRuntimeDatabase } from "./sqlite-runtime-database.js";

interface RecordRow {
  readonly revision: number;
  readonly body: string;
}

export class SqliteRecordStore {
  constructor(readonly database: SqliteRuntimeDatabase) {}

  async get<Value>(recordType: string, recordId: string): Promise<Versioned<Value> | null> {
    const row = this.database.connection
      .prepare("SELECT revision, body FROM records WHERE record_type = ? AND record_id = ?")
      .get(recordType, recordId) as RecordRow | undefined;
    return row === undefined
      ? null
      : Object.freeze({ value: JSON.parse(row.body) as Value, revision: String(row.revision) });
  }

  async save<Value>(
    recordType: string,
    recordId: string,
    value: Value,
    condition: WriteCondition,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Value>> {
    this.database.assertTransaction(transaction);
    const current = await this.get<Value>(recordType, recordId);
    if (condition.kind === "must_not_exist" && current !== null)
      this.#conflict("Record already exists.");
    if (condition.kind === "match_revision" && current?.revision !== condition.revision)
      this.#conflict("Record revision conflict.");
    const revision = current === null ? 1 : Number(current.revision) + 1;
    this.database.connection
      .prepare(`
      INSERT INTO records(record_type, record_id, revision, body) VALUES(?, ?, ?, ?)
      ON CONFLICT(record_type, record_id) DO UPDATE SET revision = excluded.revision, body = excluded.body
    `)
      .run(recordType, recordId, revision, JSON.stringify(value));
    return Object.freeze({ value, revision: String(revision) });
  }

  append<Value>(
    recordType: string,
    recordId: string,
    value: Value,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Value>> {
    return this.save(recordType, recordId, value, { kind: "must_not_exist" }, transaction);
  }

  #conflict(message: string): never {
    throw new ApplicationError("CONFLICT", message);
  }
}
