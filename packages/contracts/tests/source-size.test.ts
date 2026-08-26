import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The repository-wide source-size architecture gate.
 *
 * The frozen architecture states the rule plainly: a production source file above 500 lines fails
 * architecture verification. This test used to scan one package's `src`, which meant the rule was
 * only enforced where someone had remembered to enforce it — an oversized file in any other
 * package was an architecture failure nothing failed on. It now walks every first-party production
 * source root the repository actually has.
 *
 * The roots are discovered from the real directory layout rather than hard-coded, so a new package
 * is covered the moment it exists and a renamed one cannot silently drop out of scope. Only
 * genuinely generated, vendored, or build output is excluded; test trees are excluded because the
 * rule is about production source, and nothing is excluded to make this pass.
 */
const MAX_LINES = 500;

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The workspace areas that hold first-party code. Repository tooling under `scripts/` is not
 * production source and is deliberately out of scope. */
const WORKSPACE_AREAS = ["packages", "apps", "plugins", "adapters"] as const;

/** Vendored dependencies and build output — the only legitimate reasons to skip a directory. */
const NON_SOURCE_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".next",
]);

/** Trees that are not production source: tests, fixtures, and static assets. */
const NON_PRODUCTION_DIRECTORIES: ReadonlySet<string> = new Set([
  "tests",
  "test",
  "__tests__",
  "public",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

function directoriesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_SOURCE_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Every production source root the repository actually has.
 *
 * A workspace member keeps its production code in `src` when it has one; `adapters/local-supervised`
 * does not, and its adapters sit directly in the member directory. Requiring a `src` that does not
 * exist would have left that member unscanned, so the member itself is the root in that case.
 */
function discoverSourceRoots(root: string): string[] {
  const roots: string[] = [];
  for (const area of WORKSPACE_AREAS) {
    const areaPath = join(root, area);
    if (!statSync(areaPath, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const member of directoriesIn(areaPath)) {
      const memberPath = join(areaPath, member);
      const sourcePath = join(memberPath, "src");
      roots.push(
        statSync(sourcePath, { throwIfNoEntry: false })?.isDirectory() ? sourcePath : memberPath,
      );
    }
  }
  return roots;
}

function sourceFilesIn(root: string): string[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return NON_SOURCE_DIRECTORIES.has(entry.name) || NON_PRODUCTION_DIRECTORIES.has(entry.name)
        ? []
        : sourceFilesIn(path);
    }
    return entry.isFile() && SOURCE_EXTENSIONS.some((suffix) => path.endsWith(suffix))
      ? [path]
      : [];
  });
}

function oversizedIn(roots: readonly string[]): { path: string; lines: number }[] {
  return roots
    .flatMap((root) => sourceFilesIn(root))
    .map((path) => ({
      path: relative(repositoryRoot, path).split(sep).join("/"),
      lines: readFileSync(path, "utf8").split(/\r?\n/u).length,
    }))
    .filter(({ lines }) => lines > MAX_LINES)
    .sort((left, right) => left.path.localeCompare(right.path));
}

describe("repository-wide source-file size", () => {
  it("scans the production source roots the repository actually has", () => {
    const roots = discoverSourceRoots(repositoryRoot).map((path) =>
      relative(repositoryRoot, path).split(sep).join("/"),
    );
    // A gate that discovers nothing passes trivially, so the discovery itself is asserted.
    expect(roots).toContain("packages/domain/src");
    expect(roots).toContain("packages/application/src");
    expect(roots).toContain("packages/infrastructure/src");
    expect(roots).toContain("packages/contracts/src");
    expect(roots).toContain("apps/runtime/src");
    expect(roots).toContain("plugins/game-production/src");
    // The one member with no `src`: its production code is the member directory itself.
    expect(roots).toContain("adapters/local-supervised");
    expect(roots.length).toBeGreaterThanOrEqual(8);

    const scanned = discoverSourceRoots(repositoryRoot).flatMap((root) => sourceFilesIn(root));
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((path) => path.includes(`${sep}node_modules${sep}`))).toBe(false);
    expect(scanned.some((path) => path.includes(`${sep}tests${sep}`))).toBe(false);
  });

  it("keeps every production source file at or below the architecture limit", () => {
    expect(oversizedIn(discoverSourceRoots(repositoryRoot))).toEqual([]);
  });

  it("fails deterministically on an oversized file anywhere under a source root", () => {
    const fixture = mkdtempSync(join(tmpdir(), "v31m4-source-size-"));
    const nested = join(fixture, "deeply", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(fixture, "at-the-limit.ts"), "//\n".repeat(MAX_LINES - 1), "utf8");
    writeFileSync(join(nested, "over-the-limit.ts"), "//\n".repeat(MAX_LINES), "utf8");
    // Build output and vendored code are the only things a scan may skip.
    mkdirSync(join(fixture, "dist"));
    writeFileSync(join(fixture, "dist", "generated.js"), "//\n".repeat(MAX_LINES * 2), "utf8");
    mkdirSync(join(fixture, "node_modules"));
    writeFileSync(join(fixture, "node_modules", "vendor.js"), "//\n".repeat(MAX_LINES * 2), "utf8");

    const flagged = sourceFilesIn(fixture)
      .map((path) => ({
        path: relative(fixture, path).split(sep).join("/"),
        lines: readFileSync(path, "utf8").split(/\r?\n/u).length,
      }))
      .filter(({ lines }) => lines > MAX_LINES);

    expect(flagged).toEqual([{ path: "deeply/nested/over-the-limit.ts", lines: MAX_LINES + 1 }]);
  });
});
