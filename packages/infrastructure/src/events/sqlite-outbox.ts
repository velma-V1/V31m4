import type { UnitOfWorkTransaction } from "@v31m4/application";
import type { DomainEvent } from "@v31m4/domain";
import type { SqliteRuntimeDatabase } from "../database/sqlite-runtime-database.js";

export interface SequencedEvent {
  readonly sequence: number;
  readonly event: DomainEvent;
}
interface OutboxRow {
  readonly sequence: number;
  readonly body: string;
}

export class SqliteOutbox {
  constructor(readonly database: SqliteRuntimeDatabase) {}
  async append(event: DomainEvent, transaction: UnitOfWorkTransaction): Promise<number> {
    this.database.assertTransaction(transaction);
    const result = this.database.connection
      .prepare("INSERT INTO outbox_events(event_id, body) VALUES(?, ?)")
      .run(event.id, JSON.stringify(event));
    return Number(result.lastInsertRowid);
  }
  async pending(limit: number): Promise<readonly SequencedEvent[]> {
    const rows = this.database.connection
      .prepare(
        "SELECT sequence, body FROM outbox_events WHERE published_at IS NULL ORDER BY sequence LIMIT ?",
      )
      .all(limit) as unknown as OutboxRow[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({ sequence: row.sequence, event: JSON.parse(row.body) as DomainEvent }),
      ),
    );
  }
  async markPublished(sequence: number): Promise<void> {
    this.database.connection
      .prepare(
        "UPDATE outbox_events SET published_at = ? WHERE sequence = ? AND published_at IS NULL",
      )
      .run(new Date().toISOString(), sequence);
  }
}
