import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(import.meta.dirname, "../src");
const MAX_SOURCE_LINES = 500;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

describe("runtime architecture guardrails", () => {
  it("keeps runtime source files reviewable and free of explicit any", () => {
    for (const path of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(path, "utf8");
      expect(source.split(/\r?\n/u).length, path).toBeLessThanOrEqual(MAX_SOURCE_LINES);
      expect(source, path).not.toMatch(/(?::|\bas|<)\s*any\b/u);
    }
  });
});
