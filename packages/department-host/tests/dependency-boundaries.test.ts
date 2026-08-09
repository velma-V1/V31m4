import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");
const sourceRoot = join(packageRoot, "src");
const IMPORT_RE =
  /^\s*(?:import|export)\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\}|\w+)\s+from\s+["']([^"']+)["']/gmu;
const ALLOWED_PACKAGES = new Set(["@v31m4/application", "@v31m4/domain"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function isAllowed(specifier: string): boolean {
  return (
    specifier.startsWith(".") || specifier.startsWith("node:") || ALLOWED_PACKAGES.has(specifier)
  );
}

describe("department-host dependency boundary", () => {
  it("imports only application, domain, Node APIs, and department-host-local modules — never a department", () => {
    const violations: string[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        if (specifier !== undefined && !isAllowed(specifier)) {
          violations.push(`${relative(packageRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
