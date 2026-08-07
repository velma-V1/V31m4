import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactId, ContentHash, ProjectId, SafePath } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { ContentAddressedArtifactStore, SqliteRuntimeDatabase } from "../src/index.js";
import { context } from "./fixtures.js";

async function* bytes(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "v31m4-artifacts-"));
  const db = new SqliteRuntimeDatabase(join(root, "state.db"));
  return { db, store: new ContentAddressedArtifactStore(db, join(root, "artifacts")) };
}

describe("content-addressed artifacts", () => {
  it("writes atomically, verifies the hash, opens bytes, and deduplicates content", async () => {
    const { db, store } = fixture();
    const first = await db.unitOfWork.execute(context, (transaction) =>
      store.write(
        {
          id: ArtifactId.parse("artifact-1"),
          projectId: ProjectId.parse("project-1"),
          kind: "source",
          logicalPath: SafePath.parse("src/one.ts"),
          mediaType: "text/plain",
          parentArtifactIds: [],
          bytes: bytes("same"),
        },
        context,
        transaction,
      ),
    );
    const second = await db.unitOfWork.execute(context, (transaction) =>
      store.write(
        {
          id: ArtifactId.parse("artifact-2"),
          projectId: ProjectId.parse("project-1"),
          kind: "source",
          logicalPath: SafePath.parse("src/two.ts"),
          mediaType: "text/plain",
          parentArtifactIds: [],
          bytes: bytes("same"),
        },
        context,
        transaction,
      ),
    );
    expect(second.value.contentHash).toBe(first.value.contentHash);
    expect(await store.verify(first.value.id, context)).toBe(true);
    const chunks: Uint8Array[] = [];
    for await (const chunk of await store.open(first.value.id, context)) chunks.push(chunk);
    expect(new TextDecoder().decode(chunks[0])).toBe("same");
    db.close();
  });

  it("rejects an expected-hash mismatch without persisting metadata", async () => {
    const { db, store } = fixture();
    await expect(
      db.unitOfWork.execute(context, (transaction) =>
        store.write(
          {
            id: ArtifactId.parse("artifact-bad"),
            projectId: ProjectId.parse("project-1"),
            kind: "source",
            logicalPath: SafePath.parse("src/bad.ts"),
            mediaType: "text/plain",
            expectedHash: ContentHash.parse("a".repeat(64)),
            parentArtifactIds: [],
            bytes: bytes("different"),
          },
          context,
          transaction,
        ),
      ),
    ).rejects.toThrow("hash");
    expect(await store.get(ArtifactId.parse("artifact-bad"), context)).toBeNull();
    db.close();
  });
});
