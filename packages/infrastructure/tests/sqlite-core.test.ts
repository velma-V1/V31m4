import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriteConditions } from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { SqliteRecordStore, SqliteRuntimeDatabase } from "../src/index.js";
import { context } from "./fixtures.js";

function database() {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-sqlite-")), "state.db"));
}

describe("SQLite unit of work and records", () => {
  it("migrates an empty database and rolls back failed work", async () => {
    const db = database();
    const records = new SqliteRecordStore(db);
    await expect(
      db.unitOfWork.execute(context, async (transaction) => {
        await records.save(
          "project",
          "project-1",
          { name: "alpha" },
          WriteConditions.mustNotExist(),
          transaction,
        );
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(await records.get("project", "project-1")).toBeNull();
    db.close();
  });

  it("enforces compare-and-swap and immutable append conflicts", async () => {
    const db = database();
    const records = new SqliteRecordStore(db);
    const first = await db.unitOfWork.execute(context, (transaction) =>
      records.save(
        "project",
        "project-1",
        { name: "alpha" },
        WriteConditions.mustNotExist(),
        transaction,
      ),
    );
    await expect(
      db.unitOfWork.execute(context, (transaction) =>
        records.save(
          "project",
          "project-1",
          { name: "beta" },
          WriteConditions.matchRevision("stale"),
          transaction,
        ),
      ),
    ).rejects.toThrow("revision");
    const second = await db.unitOfWork.execute(context, (transaction) =>
      records.save(
        "project",
        "project-1",
        { name: "beta" },
        WriteConditions.matchRevision(first.revision),
        transaction,
      ),
    );
    expect(second.revision).not.toBe(first.revision);
    await expect(
      db.unitOfWork.execute(context, (transaction) =>
        records.append("evidence", "evidence-1", { passed: true }, transaction),
      ),
    ).resolves.toBeDefined();
    await expect(
      db.unitOfWork.execute(context, (transaction) =>
        records.append("evidence", "evidence-1", { passed: false }, transaction),
      ),
    ).rejects.toThrow("already exists");
    db.close();
  });

  it("rejects nested authoritative transactions", async () => {
    const db = database();
    await expect(
      db.unitOfWork.execute(context, () => db.unitOfWork.execute(context, async () => true)),
    ).rejects.toThrow("Nested");
    db.close();
  });

  it("serializes concurrent writers into one success and one version conflict", async () => {
    const db = database();
    const records = new SqliteRecordStore(db);
    const initial = await db.unitOfWork.execute(context, (transaction) =>
      records.save(
        "project",
        "project-1",
        { name: "alpha" },
        WriteConditions.mustNotExist(),
        transaction,
      ),
    );
    const writes = await Promise.allSettled([
      db.unitOfWork.execute(context, (transaction) =>
        records.save(
          "project",
          "project-1",
          { name: "beta" },
          WriteConditions.matchRevision(initial.revision),
          transaction,
        ),
      ),
      db.unitOfWork.execute(context, (transaction) =>
        records.save(
          "project",
          "project-1",
          { name: "gamma" },
          WriteConditions.matchRevision(initial.revision),
          transaction,
        ),
      ),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
    db.close();
  });
});
