import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { ApplicationError } from "@v31m4/application";
import type { ContentHash } from "@v31m4/domain";
import type { SqliteRuntimeDatabase } from "../database/sqlite-runtime-database.js";

export interface SqliteBackupRecord {
  readonly id: string;
  readonly path: string;
  readonly contentHash: ContentHash;
}

export class SqliteBackupManager {
  constructor(
    readonly database: SqliteRuntimeDatabase,
    readonly root: string,
  ) {}

  async create(id: string): Promise<SqliteBackupRecord> {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, `${id}.sqlite`);
    await backup(this.database.connection, path);
    const contentHash = await this.#hash(path);
    const record = Object.freeze({ id, path, contentHash });
    await writeFile(this.#manifestPath(id), JSON.stringify(record), {
      encoding: "utf8",
      flag: "wx",
    });
    return record;
  }

  async verify(id: string): Promise<SqliteBackupRecord> {
    let record: SqliteBackupRecord;
    try {
      record = JSON.parse(await readFile(this.#manifestPath(id), "utf8")) as SqliteBackupRecord;
    } catch (error) {
      throw new ApplicationError("NOT_FOUND", "Backup does not exist.", { cause: error });
    }
    if ((await this.#hash(record.path)) !== record.contentHash) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Backup hash verification failed.");
    }
    return record;
  }

  async restore(id: string): Promise<void> {
    const record = await this.verify(id);
    await this.database.replaceWith(record.path);
  }

  async #hash(path: string): Promise<ContentHash> {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex") as ContentHash;
  }

  #manifestPath(id: string): string {
    return join(this.root, `${id}.json`);
  }
}
