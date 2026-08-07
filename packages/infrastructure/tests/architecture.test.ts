import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("Layer 7 architecture", () => {
  it("keeps infrastructure source inward-facing and below 500 lines", () => {
    for (const path of files(join(import.meta.dirname, "../src"))) {
      const source = readFileSync(path, "utf8");
      expect(source.split(/\r?\n/u).length, path).toBeLessThanOrEqual(500);
      expect(source, path).not.toMatch(
        /from\s+["'](?:@v31m4\/contracts|\.\.\/\.\.\/\.\.\/(?:apps|adapters|plugins))/u,
      );
    }
  });
});
