import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("application dependency boundary", () => {
  it("imports only domain and application-local modules", () => {
    const violations: string[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
        const specifier = match[1];
        if (
          specifier !== undefined &&
          !specifier.startsWith(".") &&
          specifier !== "@v31m4/domain"
        ) {
          violations.push(`${relative(packageRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps every source file below the architecture limit", () => {
    const oversized = sourceFiles(sourceRoot)
      .map((path) => ({
        path: relative(packageRoot, path),
        lines: readFileSync(path, "utf8").split("\n").length,
      }))
      .filter(({ lines }) => lines > 500);
    expect(oversized).toEqual([]);
  });
});
