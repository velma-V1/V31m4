import { createHash, randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type AuthorizedSemanticExecutionPlan,
  type WorkspaceCurrencyPrecondition,
  type WorkspaceHandle,
} from "@v31m4/application";

/**
 * Workspace guards shared by the sandbox supervisor and its hermetic backend.
 *
 * Split out of `sandbox-supervisor.ts` to stay under the mandatory source-size limit.
 */

/**
 * Re-reads the authoritative workspace immediately before dispatch and proves the execution's
 * declared preconditions still hold. A mismatch is `CONFLICT`, and the backend is never reached.
 */
export async function assertWorkspaceStillCurrent(
  workspaceRoot: string,
  plan: AuthorizedSemanticExecutionPlan,
): Promise<void> {
  const precondition = plan.currencyPrecondition;
  if (precondition === null) return;
  if (!precondition.allowedPathScope.includes(precondition.path)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "The execution target is outside its own declared path scope.",
      { details: { path: precondition.path, operationId: plan.operationId } },
    );
  }
  // Every declared path must still resolve inside the assigned workspace.
  for (const path of precondition.allowedPathScope) {
    await containedPath(workspaceRoot, path);
  }
  const observed = await fingerprintWorkspaceFile(workspaceRoot, precondition.path);
  if (observed !== precondition.expectedFingerprint) {
    throw new ApplicationError(
      "CONFLICT",
      "The execution target changed between authorization and dispatch; the stale effect is rejected.",
      {
        details: {
          operationId: plan.operationId,
          path: precondition.path,
          expectedFingerprint: precondition.expectedFingerprint,
          observedFingerprint: observed,
        },
      },
    );
  }
}

/** SHA-256 of a real workspace file, or the empty string when it does not exist. */
export async function fingerprintWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const contained = await containedPath(workspaceRoot, relativePath);
  const bytes = await readFile(contained).catch(() => null);
  return bytes === null ? "" : createHash("sha256").update(bytes).digest("hex");
}

export function readPathScope(parameters: ApplicationJsonObject): readonly string[] {
  const scope = parameters["pathScope"];
  if (!Array.isArray(scope)) return [];
  return scope.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Resolves a workspace-relative path and proves, through the real filesystem, that it stays
 * inside the assigned workspace.
 *
 * A target that does not exist yet still has to be contained, because a write would create it.
 * Resolving only the target is not enough: an escaping symlink *parent* leaves the lexical path
 * looking contained while the real location is elsewhere. So the deepest existing ancestor is
 * canonicalized and the remaining segments are re-appended to it, which catches an escaping
 * link whether it is the target itself, its parent, or any ancestor.
 */
export async function containedPath(workspaceRoot: string, relativePath: string): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const target = resolve(canonicalRoot, relativePath);

  const trailing: string[] = [];
  let probe = target;
  let resolved: string | undefined;
  for (;;) {
    const real = await realpath(probe).catch(() => null);
    if (real !== null) {
      resolved = trailing.length === 0 ? real : join(real, ...trailing.reverse());
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    trailing.push(basename(probe));
    probe = parent;
  }

  if (
    resolved === undefined ||
    (resolved !== canonicalRoot && !resolved.startsWith(canonicalRoot + sep))
  ) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A sandbox path escapes the assigned workspace.",
      { details: { workspaceRoot: canonicalRoot, path: relativePath } },
    );
  }
  return resolved;
}

/** The workspace record backing this sandbox must still be the same one, not merely present. */
export function assertWorkspaceIdentityUnchanged(
  current: WorkspaceHandle,
  prepared: WorkspaceHandle,
  sandboxId: string,
): void {
  if (current.id !== prepared.id) {
    throw new ApplicationError("CONFLICT", "The authoritative workspace identity changed.", {
      details: { expected: prepared.id, observed: current.id },
    });
  }
  if (
    current.projectId !== prepared.projectId ||
    current.purpose !== prepared.purpose ||
    current.rootPath !== prepared.rootPath ||
    current.createdAt !== prepared.createdAt
  ) {
    throw new ApplicationError(
      "CONFLICT",
      "The authoritative workspace was replaced since the sandbox was prepared.",
      { details: { workspaceId: current.id, sandboxId } },
    );
  }
}

/** The workspace must still resolve to the very directory the sandbox was prepared against. */
export async function assertSameCanonicalRoot(
  preparedRoot: string,
  currentRoot: string,
  sandboxId: string,
): Promise<void> {
  const [prepared, current] = await Promise.all([
    realpath(preparedRoot).catch(() => null),
    realpath(currentRoot).catch(() => null),
  ]);
  if (prepared === null || current === null || prepared !== current) {
    throw new ApplicationError(
      "CONFLICT",
      "The authoritative workspace root changed since the sandbox was prepared.",
      { details: { sandboxId, preparedRoot, currentRoot } },
    );
  }
}

/**
 * The sanctioned workspace write.
 *
 * The expected fingerprint is re-checked and the replacement is written inside the same call,
 * under the supervisor's exclusive execution claim, so no backend can perform "check now, write
 * later".
 *
 * The replacement file is created with an unpredictable name via exclusive creation (`wx`), in
 * the already-validated canonical parent, and written through its own descriptor. A predictable
 * temporary name is a write primitive in its own right: an attacker who can pre-create that path
 * as a symlink turns the "safe" temp write into a host-side write anywhere the runtime can
 * reach. Exclusive creation refuses an existing path — symlink or not — rather than following it.
 */
export async function compareAndApply(
  workspaceRoot: string,
  precondition: WorkspaceCurrencyPrecondition,
  nextContent: string | Uint8Array,
): Promise<void> {
  if (!precondition.allowedPathScope.includes(precondition.path)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A workspace write target is outside its own declared path scope.",
      { details: { path: precondition.path } },
    );
  }
  const contained = await containedPath(workspaceRoot, precondition.path);
  // The directory the replacement is created in must itself be inside the workspace.
  const parent = await containedDirectory(workspaceRoot, dirname(contained));
  await assertCurrent(workspaceRoot, precondition, "before");

  const { handle, path: temporary } = await createExclusiveTemporary(parent);
  try {
    await handle.writeFile(nextContent);
    // Re-verify immediately before the replacement lands: nothing may have moved the target
    // while the new content was being written.
    await assertCurrent(workspaceRoot, precondition, "before replacement");
    await handle.close();
    await rename(temporary, contained);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function assertCurrent(
  workspaceRoot: string,
  precondition: WorkspaceCurrencyPrecondition,
  stage: string,
): Promise<void> {
  const observed = await fingerprintWorkspaceFile(workspaceRoot, precondition.path);
  if (observed !== precondition.expectedFingerprint) {
    throw new ApplicationError(
      "CONFLICT",
      `The workspace write target changed ${stage}; the stale change is rejected rather than applied.`,
      {
        details: {
          path: precondition.path,
          stage,
          expectedFingerprint: precondition.expectedFingerprint,
          observedFingerprint: observed,
        },
      },
    );
  }
}

const TEMPORARY_ATTEMPTS = 8;

/**
 * Creates a new regular file with an unguessable name and bounded permissions. `wx` is
 * `O_CREAT|O_EXCL`, which fails outright on an existing path instead of following it, so a
 * pre-placed symlink cannot capture the write.
 */
async function createExclusiveTemporary(
  directory: string,
): Promise<{ readonly handle: FileHandle; readonly path: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TEMPORARY_ATTEMPTS; attempt += 1) {
    const path = join(directory, `.v31m4-apply-${randomBytes(16).toString("hex")}`);
    try {
      return { handle: await open(path, "wx", 0o600), path };
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") break;
    }
  }
  throw new ApplicationError(
    "DEPENDENCY_FAILURE",
    "A workspace replacement file could not be created safely.",
    { cause: lastError, details: { directory } },
  );
}

/** Resolves a directory and proves it is the workspace root or lies inside it. */
async function containedDirectory(workspaceRoot: string, directory: string): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const canonical = await realpath(directory).catch(() => null);
  if (
    canonical === null ||
    (canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + sep))
  ) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A workspace write directory escapes the assigned workspace.",
      { details: { workspaceRoot: canonicalRoot, directory } },
    );
  }
  return canonical;
}

/** The assigned workspace must be a real, absolute directory before anything runs. */
export async function assertExistingDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new ApplicationError("PERMISSION_DENIED", "A workspace root must be an absolute path.", {
      details: { path },
    });
  }
  const entry = await stat(path).catch(() => null);
  if (entry === null || !entry.isDirectory()) {
    throw new ApplicationError("NOT_FOUND", "The assigned workspace directory does not exist.", {
      details: { path },
    });
  }
}
