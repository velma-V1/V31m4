import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteIdempotencyStore, SqliteRuntimeDatabase } from "../src/index.js";

function database(): SqliteRuntimeDatabase {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-idem-")), "state.db"));
}

describe("SqliteIdempotencyStore.complete", () => {
  it("treats a matching duplicate as idempotent success and preserves the stored result", async () => {
    const db = database();
    const store = new SqliteIdempotencyStore(db);
    await store.complete("actor-1", "k1", "project.create", "hash-a", { id: "p1" });
    // A second identical completion collides on the primary key but must not throw.
    await expect(
      store.complete("actor-1", "k1", "project.create", "hash-a", { id: "p1" }),
    ).resolves.toBeUndefined();
    const found = await store.lookup("actor-1", "k1", "project.create", "hash-a");
    expect(found).toEqual({ status: "completed", result: { id: "p1" } });
    db.close();
  });

  it("reports a conflict when the same key is reused with a different type or payload hash", async () => {
    const db = database();
    const store = new SqliteIdempotencyStore(db);
    await store.complete("actor-1", "k1", "project.create", "hash-a", { id: "p1" });
    await expect(store.lookup("actor-1", "k1", "mission.submit", "hash-a")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(store.lookup("actor-1", "k1", "project.create", "hash-b")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    db.close();
  });

  it("propagates a write failure instead of silently reporting success", async () => {
    const db = database();
    const store = new SqliteIdempotencyStore(db);
    // A non-serializable result must fail loudly so the enclosing transaction rolls back; the old
    // catch-all swallowed this and left the authoritative effect committed without a durable record.
    await expect(
      store.complete("actor-1", "k1", "project.create", "hash-a", { big: 10n }),
    ).rejects.toBeInstanceOf(Error);
    // Nothing was recorded, so a corrected retry can still proceed.
    expect(await store.lookup("actor-1", "k1", "project.create", "hash-a")).toBeNull();
    db.close();
  });
});
