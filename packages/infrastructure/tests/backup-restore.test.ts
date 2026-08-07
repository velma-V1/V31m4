import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriteConditions } from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { SqliteBackupManager, SqliteRecordStore, SqliteRuntimeDatabase } from "../src/index.js";
import { context } from "./fixtures.js";

describe("verified SQLite backup and restore", () => {
  it("restores a verified snapshot and rejects tampering", async () => {
    const root = mkdtempSync(join(tmpdir(), "v31m4-backup-"));
    const database = new SqliteRuntimeDatabase(join(root, "state.db"));
    const records = new SqliteRecordStore(database);
    await database.unitOfWork.execute(context, (transaction) =>
      records.save(
        "project",
        "project-1",
        { name: "alpha" },
        WriteConditions.mustNotExist(),
        transaction,
      ),
    );
    const backups = new SqliteBackupManager(database, join(root, "backups"));
    const backup = await backups.create("backup-1");
    expect(
      (await new SqliteBackupManager(database, join(root, "backups")).verify("backup-1"))
        .contentHash,
    ).toBe(backup.contentHash);
    await database.unitOfWork.execute(context, (transaction) =>
      records.save(
        "project",
        "project-1",
        { name: "beta" },
        WriteConditions.matchRevision("1"),
        transaction,
      ),
    );
    await backups.restore(backup.id);
    expect((await records.get<{ name: string }>("project", "project-1"))?.value.name).toBe("alpha");
    appendFileSync(backup.path, "tampered");
    await expect(backups.verify(backup.id)).rejects.toThrow("hash");
    database.close();
  });
});
