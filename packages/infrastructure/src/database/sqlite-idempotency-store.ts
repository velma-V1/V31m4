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
    try {
      this.database.connection
        .prepare(
          "INSERT INTO idempotency_records(actor_id, idempotency_key, command_type, payload_hash, status, result) VALUES(?, ?, ?, ?, 'completed', ?)",
        )
        .run(actorId, key, commandType, payloadHash, JSON.stringify(result));
    } catch (error) {
      await this.lookup(actorId, key, commandType, payloadHash);
      if (error instanceof Error) return;
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
