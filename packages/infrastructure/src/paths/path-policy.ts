import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { ApplicationError } from "@v31m4/application";
import { SafePath } from "@v31m4/domain";

export type ApprovedRootKind = "project" | "artifact" | "backup";

export interface ApprovedRoots {
  readonly project: string;
  readonly artifact: string;
  readonly backup: string;
}

/**
 * Runtime real-path containment policy.
 *
 * The domain `SafePath` validates the project-relative *form* of a path (no traversal,
 * no absolute/UNC/drive prefixes, no device names, no control characters). `PathPolicy`
 * adds the runtime guarantee: a relative path is resolved against one approved absolute
 * root, canonicalized through the real filesystem (resolving symlinks/junctions), and
 * verified to remain inside that root. A symlink or reparse point that escapes the root,
 * or any resolved location outside the approved project/artifact/backup boundaries, is
 * rejected fail-closed.
 */
export class PathPolicy {
  #roots: ApprovedRoots;

  private constructor(roots: ApprovedRoots) {
    this.#roots = roots;
  }

  /** Canonicalizes each approved root (which must already exist) and builds the policy. */
  static async create(roots: ApprovedRoots): Promise<PathPolicy> {
    const canonical: ApprovedRoots = {
      project: await canonicalizeExisting(roots.project, "project"),
      artifact: await canonicalizeExisting(roots.artifact, "artifact"),
      backup: await canonicalizeExisting(roots.backup, "backup"),
    };
    return new PathPolicy(canonical);
  }

  root(kind: ApprovedRootKind): string {
    return this.#roots[kind];
  }

  /**
   * Resolves a project-relative safe path against an approved root and returns the
   * canonical absolute real path, or throws `PERMISSION_DENIED` if it escapes the root.
   */
  async resolve(kind: ApprovedRootKind, relativePath: string): Promise<string> {
    const relative = SafePath.parse(relativePath);
    const root = this.#roots[kind];
    const target = join(root, relative);
    const canonical = await canonicalizePartial(target);
    this.#assertWithin(kind, root, canonical);
    return canonical;
  }

  /** Verifies that an already-absolute path canonicalizes to a location inside the root. */
  async assertContained(kind: ApprovedRootKind, absolutePath: string): Promise<string> {
    if (!isAbsolute(absolutePath)) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "An approved-root check requires an absolute path.",
        {
          details: { path: absolutePath },
        },
      );
    }
    const canonical = await canonicalizePartial(absolutePath);
    this.#assertWithin(kind, this.#roots[kind], canonical);
    return canonical;
  }

  #assertWithin(kind: ApprovedRootKind, root: string, canonical: string): void {
    if (canonical !== root && !canonical.startsWith(root + sep)) {
      throw new ApplicationError("PERMISSION_DENIED", "Path escapes its approved root.", {
        details: { kind, root, resolved: canonical },
      });
    }
  }
}

/** Canonicalizes a path that must already exist as a real directory or file. */
async function canonicalizeExisting(path: string, kind: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    throw new ApplicationError("DEPENDENCY_UNAVAILABLE", `Approved ${kind} root does not exist.`, {
      details: { path: absolute },
    });
  }
}

/**
 * Canonicalizes the deepest existing ancestor of `target` and re-appends the remaining
 * (not-yet-created) segments, so a write target inside a symlinked tree is resolved to
 * its real location without requiring the leaf to exist.
 */
async function canonicalizePartial(target: string): Promise<string> {
  const absolute = resolve(target);
  const trailing: string[] = [];
  let current = absolute;
  for (;;) {
    if (await exists(current)) {
      const real = await realpath(current);
      return trailing.length === 0 ? real : join(real, ...trailing.reverse());
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      // Reached the filesystem root without finding an existing ancestor.
      return absolute;
    }
    trailing.push(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    current = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
