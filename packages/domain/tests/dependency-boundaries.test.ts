import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");
const sourceRoot = join(packageRoot, "src");
const IMPORT_RE =
  /^\s*(?:import|export)\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\}|\w+)\s+from\s+["']([^"']+)["']/gmu;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("domain dependency boundary", () => {
  it("imports only domain-local modules — no runtime, provider, or external package", () => {
    const violations: string[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.startsWith(".")) {
          violations.push(`${relative(packageRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
