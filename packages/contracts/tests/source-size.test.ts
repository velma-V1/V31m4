import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAX_LINES = 500;
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("contracts source-file size", () => {
  it("keeps every source file at or below the architecture limit", () => {
    const oversized = sourceFiles(sourceRoot)
      .map((path) => ({
        path: relative(packageRoot, path),
        lines: readFileSync(path, "utf8").split("\n").length,
      }))
      .filter(({ lines }) => lines > MAX_LINES);
    expect(oversized).toEqual([]);
  });
});
