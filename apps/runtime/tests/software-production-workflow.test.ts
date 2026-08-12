import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChangeManifest } from "../../../adapters/local-supervised/software-production-workflow.mjs";

describe("software production kernel effect", () => {
  it("rolls back earlier writes when a later manifest operation fails", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "v31m4-manifest-rollback-"));
    await mkdir(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src/greeting.mjs"), 'export const greeting = "broken";\n');

    await expect(
      applyChangeManifest(workspace, [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "hello world";\n',
        },
        {
          path: "src/missing.mjs",
          operation: "update",
          content: "export const missing = true;\n",
        },
      ]),
    ).rejects.toThrow();

    expect(readFileSync(join(workspace, "src/greeting.mjs"), "utf8")).toBe(
      'export const greeting = "broken";\n',
    );
  });
});
