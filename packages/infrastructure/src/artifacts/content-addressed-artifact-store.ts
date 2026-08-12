import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  type ArtifactStorePort,
  type ArtifactWriteRequest,
  type OperationContext,
  type PortPage,
  type PortPageRequest,
  type UnitOfWorkTransaction,
  type Versioned,
  WriteConditions,
} from "@v31m4/application";
import {
  Artifact,
  type ArtifactId,
  type ContentHash,
  ContentHash as ContentHashValue,
} from "@v31m4/domain";
import { SqliteRecordStore } from "../database/sqlite-record-store.js";
import type { SqliteRuntimeDatabase } from "../database/sqlite-runtime-database.js";
import { parsePaginationCursor } from "../pagination-cursor.js";

const RECORD_TYPE = "artifact";

/** Streams an artifact blob back as byte chunks. */
async function* readBlob(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path)) {
    yield chunk as Uint8Array;
  }
}

/**
 * Filesystem content-addressed artifact store with SQLite metadata.
 *
 * Bytes are streamed to a temporary file while their SHA-256 digest is computed, then
 * atomically renamed into a hash-addressed path (`<root>/<aa>/<hash>`). Identical content
 * deduplicates to a single blob. When an `expectedHash` is supplied it is verified before
 * anything is persisted, so a mismatch leaves neither a blob nor a metadata row. Metadata
 * is written inside the caller's transaction; a rollback removes any blob this write newly
 * created, so runtime state and stored bytes never diverge.
 */
export class ContentAddressedArtifactStore implements ArtifactStorePort {
  readonly #records: SqliteRecordStore;

  constructor(
    private readonly database: SqliteRuntimeDatabase,
    private readonly root: string,
  ) {
    this.#records = new SqliteRecordStore(database);
  }

  async write(
    request: ArtifactWriteRequest,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<Artifact>> {
    this.database.assertTransaction(transaction);

    const temporaryPath = join(this.root, ".tmp", randomUUID());
    await mkdir(dirname(temporaryPath), { recursive: true });
    const hash = createHash("sha256");
    let byteSize = 0;
    const handle = await open(temporaryPath, "wx");
    try {
      for await (const chunk of request.bytes) {
        hash.update(chunk);
        byteSize += chunk.byteLength;
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
    const digest = ContentHashValue.parse(hash.digest("hex"));

    if (request.expectedHash !== undefined && request.expectedHash !== digest) {
      await rm(temporaryPath, { force: true });
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "Artifact content hash did not match the expected hash.",
        {
          details: { expectedHash: request.expectedHash, actualHash: digest },
        },
      );
    }

    const blobPath = this.#blobPath(digest);
    let createdBlob = false;
    if (await this.#exists(blobPath)) {
      await rm(temporaryPath, { force: true });
    } else {
      await mkdir(dirname(blobPath), { recursive: true });
      await rename(temporaryPath, blobPath);
      createdBlob = true;
    }

    const artifact = Artifact.create({
      id: request.id,
      projectId: request.projectId,
      ...(request.jobId === undefined ? {} : { jobId: request.jobId }),
      kind: request.kind,
      logicalPath: request.logicalPath,
      contentHash: digest,
      byteSize,
      mediaType: request.mediaType,
      createdAt: context.startedAt,
      parentArtifactIds: [...request.parentArtifactIds],
    });

    try {
      const stored = await this.#records.save(
        RECORD_TYPE,
        request.id,
        artifact,
        WriteConditions.mustNotExist(),
        transaction,
      );
      if (createdBlob) {
        transaction.afterRollback(async () => {
          await rm(blobPath, { force: true });
        });
      }
      return stored;
    } catch (error) {
      if (createdBlob) await rm(blobPath, { force: true });
      throw error;
    }
  }

  async get(
    id: ArtifactId,
    _context: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<Artifact> | null> {
    return this.#records.get<Artifact>(RECORD_TYPE, id);
  }

  async findByHash(
    hash: ContentHash,
    _context: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<Artifact> | null> {
    for (const entry of this.#allArtifacts()) {
      if (entry.value.contentHash === hash) return entry;
    }
    return null;
  }

  async listByProject(
    projectId: string,
    request: PortPageRequest,
    _context: OperationContext,
    _transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<Artifact>>> {
    const matching = this.#allArtifacts().filter((entry) => entry.value.projectId === projectId);
    const start = parsePaginationCursor(request.cursor);
    const items = matching.slice(start, start + request.limit);
    const next = start + request.limit;
    return Object.freeze({
      items,
      total: matching.length,
      ...(next < matching.length ? { nextCursor: String(next) } : {}),
    });
  }

  async open(id: ArtifactId, context: OperationContext): Promise<AsyncIterable<Uint8Array>> {
    const artifact = await this.#require(id, context);
    return readBlob(this.#blobPath(artifact.value.contentHash));
  }

  async verify(id: ArtifactId, _context: OperationContext): Promise<boolean> {
    const artifact = await this.#records.get<Artifact>(RECORD_TYPE, id);
    if (artifact === null) return false;
    const blobPath = this.#blobPath(artifact.value.contentHash);
    if (!(await this.#exists(blobPath))) return false;
    const digest = createHash("sha256")
      .update(await readFile(blobPath))
      .digest("hex");
    return digest === artifact.value.contentHash;
  }

  async discardUncommitted(
    id: ArtifactId,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<void> {
    this.database.assertTransaction(transaction);
    const artifact = await this.#records.get<Artifact>(RECORD_TYPE, id);
    if (artifact === null) return;
    this.database.connection
      .prepare("DELETE FROM records WHERE record_type = ? AND record_id = ?")
      .run(RECORD_TYPE, id);
    const hash = artifact.value.contentHash;
    transaction.afterCommit(async () => {
      const stillReferenced = this.#allArtifacts().some(
        (entry) => entry.value.contentHash === hash,
      );
      if (!stillReferenced) await rm(this.#blobPath(hash), { force: true });
    });
  }

  #blobPath(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async #require(id: ArtifactId, _context: OperationContext): Promise<Versioned<Artifact>> {
    const artifact = await this.#records.get<Artifact>(RECORD_TYPE, id);
    if (artifact === null) {
      throw new ApplicationError("NOT_FOUND", "Artifact does not exist.", { details: { id } });
    }
    return artifact;
  }

  #allArtifacts(): Versioned<Artifact>[] {
    const rows = this.database.connection
      .prepare("SELECT revision, body FROM records WHERE record_type = ? ORDER BY rowid ASC")
      .all(RECORD_TYPE) as { revision: number; body: string }[];
    return rows.map((row) =>
      Object.freeze({ value: JSON.parse(row.body) as Artifact, revision: String(row.revision) }),
    );
  }
}
