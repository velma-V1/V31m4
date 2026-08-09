import { ApplicationError } from "@v31m4/application";
import type { DomainEvent } from "@v31m4/domain";
import type { SqliteRuntimeDatabase } from "../database/sqlite-runtime-database.js";
import type { SequencedEvent } from "./sqlite-outbox.js";

/** The retained sequence window, or `null` bounds when no events have been committed. */
export interface ReplayBounds {
  readonly oldest: number | null;
  readonly latest: number | null;
}

interface ReplayRow {
  readonly sequence: number;
  readonly body: string;
}

/**
 * Durable read side of the committed-event log.
 *
 * Every committed event already carries one monotonically increasing durable `sequence`
 * (assigned by {@link SqliteOutbox.append} inside the same authoritative transaction as its
 * state change). This store exposes that log for replay: strictly ordered reads after a
 * cursor, the retained-history bounds, and internal-gap detection that refuses ambiguous
 * replay rather than silently skipping a missing sequence.
 */
export class EventReplayStore {
  constructor(private readonly database: SqliteRuntimeDatabase) {}

  /** Oldest and newest retained sequences, or `null` bounds when the log is empty. */
  bounds(): ReplayBounds {
    const row = this.database.connection
      .prepare("SELECT MIN(sequence) AS oldest, MAX(sequence) AS latest FROM outbox_events")
      .get() as { oldest: number | null; latest: number | null } | undefined;
    return Object.freeze({ oldest: row?.oldest ?? null, latest: row?.latest ?? null });
  }

  /**
   * Returns committed events with `sequence` strictly greater than `afterSequence`, in
   * ascending order, up to `limit`. Callers must confirm the cursor is still within retained
   * history (via {@link bounds}) before replaying; a contiguity break in the retained window
   * is an internal gap and throws `INTEGRITY_FAILURE` instead of resuming ambiguously.
   */
  readAfter(afterSequence: number, limit: number): readonly SequencedEvent[] {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Replay cursor must be a sequence.", {
        details: { afterSequence },
      });
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Replay limit must be positive.", {
        details: { limit },
      });
    }
    const rows = this.database.connection
      .prepare(
        "SELECT sequence, body FROM outbox_events WHERE sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(afterSequence, limit) as unknown as ReplayRow[];
    let expected = afterSequence + 1;
    for (const row of rows) {
      if (row.sequence !== expected) {
        throw new ApplicationError(
          "INTEGRITY_FAILURE",
          "Committed-event log has an internal gap; replay is ambiguous.",
          { details: { expected, found: row.sequence } },
        );
      }
      expected += 1;
    }
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({ sequence: row.sequence, event: JSON.parse(row.body) as DomainEvent }),
      ),
    );
  }
}
