import { ApplicationError } from "@v31m4/application";
import type { SqliteRuntimeDatabase } from "./sqlite-runtime-database.js";

interface IdempotencyRow {
  readonly command_type: string;
  readonly payload_hash: string;
  readonly status: string;
  readonly result: string;
}
export interface IdempotencyLookup {
  readonly status: string;
  readonly result: unknown;
}

export class SqliteIdempotencyStore {
  constructor(readonly database: SqliteRuntimeDatabase) {}
  async complete(
    actorId: string,
    key: string,
    commandType: string,
    payloadHash: string,
    result: unknown,
  ): Promise<void> {
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch (error) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Idempotency result must be serializable JSON.",
        { cause: error },
      );
    }
    try {
      this.database.connection
        .prepare(
          "INSERT INTO idempotency_records(actor_id, idempotency_key, command_type, payload_hash, status, result) VALUES(?, ?, ?, ?, 'completed', ?)",
        )
        .run(actorId, key, commandType, payloadHash, serialized);
    } catch (error) {
      // A duplicate primary key means a concurrent or retried command already recorded this
      // outcome: confirm the stored command matches (lookup throws CONFLICT on a type/hash
      // mismatch) and treat a matching duplicate as idempotent success. Any other write failure
      // must propagate so the enclosing transaction rolls back rather than committing the
      // authoritative effect without its idempotency record.
      const existing = await this.lookup(actorId, key, commandType, payloadHash);
      if (existing !== null) return;
      throw error instanceof Error
        ? error
        : new ApplicationError("TRANSACTION_FAILED", "Idempotency record write failed.", {
            cause: error,
          });
    }
  }
  async lookup(
    actorId: string,
    key: string,
    commandType: string,
    payloadHash: string,
  ): Promise<IdempotencyLookup | null> {
    const row = this.database.connection
      .prepare(
        "SELECT command_type, payload_hash, status, result FROM idempotency_records WHERE actor_id = ? AND idempotency_key = ?",
      )
      .get(actorId, key) as IdempotencyRow | undefined;
    if (row === undefined) return null;
    if (row.command_type !== commandType || row.payload_hash !== payloadHash) {
      throw new ApplicationError("CONFLICT", "Idempotency key payload conflict.");
    }
    return Object.freeze({ status: row.status, result: JSON.parse(row.result) as unknown });
  }
}
