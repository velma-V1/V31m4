import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDomainEvent, type DomainEvent } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { EventReplayStore, SqliteOutbox, SqliteRuntimeDatabase } from "../src/index.js";
import { context } from "./fixtures.js";

function database() {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-replay-")), "state.db"));
}

function event(id: string): DomainEvent {
  return createDomainEvent({
    id,
    type: "job.started",
    aggregateType: "job",
    aggregateId: "job-1",
    occurredAt: context.startedAt,
    payload: {},
    metadata: {},
  });
}

async function seed(db: SqliteRuntimeDatabase, count: number): Promise<void> {
  const outbox = new SqliteOutbox(db);
  await db.unitOfWork.execute(context, async (transaction) => {
    for (let index = 1; index <= count; index += 1) {
      await outbox.append(event(`event-${index}`), transaction);
    }
  });
}

describe("EventReplayStore", () => {
  it("reports null bounds for an empty log and real bounds once events commit", async () => {
    const db = database();
    const replay = new EventReplayStore(db);
    expect(replay.bounds()).toEqual({ oldest: null, latest: null });
    await seed(db, 3);
    expect(replay.bounds()).toEqual({ oldest: 1, latest: 3 });
    db.close();
  });

  it("returns strictly ordered events after the cursor and nothing when caught up", async () => {
    const db = database();
    const replay = new EventReplayStore(db);
    await seed(db, 5);
    expect(replay.readAfter(2, 10).map((entry) => entry.sequence)).toEqual([3, 4, 5]);
    expect(replay.readAfter(2, 2).map((entry) => entry.sequence)).toEqual([3, 4]);
    expect(replay.readAfter(5, 10)).toEqual([]);
    db.close();
  });

  it("detects an internal gap in retained history and refuses ambiguous replay", async () => {
    const db = database();
    const replay = new EventReplayStore(db);
    await seed(db, 4);
    // Simulate a corrupt/pruned interior sequence, leaving a hole at sequence 3.
    db.connection.prepare("DELETE FROM outbox_events WHERE sequence = ?").run(3);
    expect(() => replay.readAfter(1, 10)).toThrow(/internal gap/i);
    db.close();
  });

  it("rejects a non-positive limit and a negative cursor", async () => {
    const db = database();
    const replay = new EventReplayStore(db);
    expect(() => replay.readAfter(0, 0)).toThrow(/limit/i);
    expect(() => replay.readAfter(-1, 10)).toThrow(/cursor/i);
    db.close();
  });
});
