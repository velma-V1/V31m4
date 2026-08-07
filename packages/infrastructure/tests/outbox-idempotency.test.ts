import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDomainEvent } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { SqliteIdempotencyStore, SqliteOutbox, SqliteRuntimeDatabase } from "../src/index.js";
import { context } from "./fixtures.js";

function database() {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-outbox-")), "state.db"));
}

describe("transactional outbox and idempotency", () => {
  it("commits events atomically and resumes unpublished events in sequence", async () => {
    const db = database();
    const outbox = new SqliteOutbox(db);
    await db.unitOfWork.execute(context, async (transaction) => {
      await outbox.append(
        createDomainEvent({
          id: "event-1",
          type: "job.started",
          aggregateType: "job",
          aggregateId: "job-1",
          occurredAt: context.startedAt,
          payload: {},
          metadata: {},
        }),
        transaction,
      );
      await outbox.append(
        createDomainEvent({
          id: "event-2",
          type: "job.completed",
          aggregateType: "job",
          aggregateId: "job-1",
          occurredAt: context.startedAt,
          payload: {},
          metadata: {},
        }),
        transaction,
      );
    });
    const pending = await outbox.pending(10);
    expect(pending.map((event) => event.sequence)).toEqual([1, 2]);
    await outbox.markPublished(1);
    expect((await outbox.pending(10)).map((event) => event.sequence)).toEqual([2]);
    db.close();
  });

  it("rolls back outbox events with their failed authoritative transaction", async () => {
    const db = database();
    const outbox = new SqliteOutbox(db);
    await expect(
      db.unitOfWork.execute(context, async (transaction) => {
        await outbox.append(
          createDomainEvent({
            id: "event-rollback",
            type: "job.failed",
            aggregateType: "job",
            aggregateId: "job-1",
            occurredAt: context.startedAt,
            payload: {},
            metadata: {},
          }),
          transaction,
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await outbox.pending(10)).toEqual([]);
    db.close();
  });

  it("returns an existing result for the same payload and conflicts on reuse", async () => {
    const db = database();
    const store = new SqliteIdempotencyStore(db);
    await store.complete("user-1", "key-1", "project.create", "hash-a", { projectId: "project-1" });
    expect(await store.lookup("user-1", "key-1", "project.create", "hash-a")).toEqual({
      status: "completed",
      result: { projectId: "project-1" },
    });
    await expect(store.lookup("user-1", "key-1", "project.create", "hash-b")).rejects.toThrow(
      "conflict",
    );
    db.close();
  });
});
