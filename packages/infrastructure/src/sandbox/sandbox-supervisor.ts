import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type OperationContext,
  type SandboxExecutionResult,
  type SandboxHandle,
  type SandboxIsolationPolicy,
  type SandboxPort,
  type SandboxStatus,
  type WorkspaceHandle,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import { type JobId, type ResourceBudget, SandboxId, type TaskId } from "@v31m4/domain";

/** Everything a backend needs to realize one sandbox. Assembled only by the supervisor. */
export interface SandboxExecutionSpec {
  readonly sandboxId: SandboxId;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly workspaceId: string;
  /** Absolute host directory of the assigned workspace — the only writable host location. */
  readonly workspaceRoot: string;
  readonly budget: ResourceBudget;
  readonly policy: SandboxIsolationPolicy;
}

export interface SandboxBackend {
  readonly id: string;
  prepare(spec: SandboxExecutionSpec, context: OperationContext): Promise<void>;
  execute(
    spec: SandboxExecutionSpec,
    operation: string,
    parameters: ApplicationJsonObject,
    context: OperationContext,
  ): Promise<SandboxExecutionResult>;
  cancel(spec: SandboxExecutionSpec, context: OperationContext): Promise<void>;
  destroy(spec: SandboxExecutionSpec, context: OperationContext): Promise<void>;
}

/**
 * Raised by a backend when an effect may or may not have been applied — a killed container,
 * a lost transport, a crash between effect and confirmation. It is never converted into
 * success or a plain failure; the supervisor surfaces it as internal `unknown` state so the
 * Execution Ledger can reconcile it before any retry.
 */
export class SandboxIndeterminateEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxIndeterminateEffectError";
  }
}

export interface SandboxSupervisorOptions {
  readonly backend: SandboxBackend;
  readonly workspaces: WorkspaceManagerPort;
  /**
   * The closed set of semantic operations this sandbox may run. The catalog itself is owned
   * by the runtime; injecting the set keeps the boundary fail-closed without creating a
   * second copy of the operation registry inside infrastructure.
   */
  readonly allowedOperations: readonly string[];
  /**
   * Resolves the assigned workspace's absolute host directory. Containment against approved
   * roots is the trusted caller's responsibility; the sandbox never derives host paths itself.
   */
  readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  readonly generateSandboxId: () => string;
}

interface SandboxEntry {
  handle: SandboxHandle;
  readonly spec: SandboxExecutionSpec;
}

/**
 * V31M4-owned sandbox lifecycle.
 *
 * `WorkspaceManagerPort` stays the sole workspace/worktree authority: `prepare` re-reads the
 * workspace from that port and refuses anything unknown, no longer active, or inconsistent
 * with the handle it was handed, so a caller cannot forge a workspace into existence through
 * this boundary. Backends are replaceable; none of them is a permanent choice.
 */
export class SandboxSupervisor implements SandboxPort {
  readonly #options: SandboxSupervisorOptions;
  readonly #allowed: ReadonlySet<string>;
  readonly #sandboxes = new Map<string, SandboxEntry>();

  constructor(options: SandboxSupervisorOptions) {
    this.#options = options;
    this.#allowed = new Set(options.allowedOperations);
  }

  async prepare(
    taskId: TaskId,
    jobId: JobId,
    workspace: WorkspaceHandle,
    budget: ResourceBudget,
    policy: SandboxIsolationPolicy,
    context: OperationContext,
  ): Promise<SandboxHandle> {
    const authoritative = await this.#options.workspaces.get(workspace.id, context);
    if (authoritative === null) {
      throw new ApplicationError(
        "NOT_FOUND",
        "A sandbox can only be prepared for a workspace the workspace manager owns.",
        { details: { workspaceId: workspace.id } },
      );
    }
    if (authoritative.status !== "active") {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "A sandbox cannot be prepared for a sealed or discarded workspace.",
        { details: { workspaceId: workspace.id, status: authoritative.status } },
      );
    }
    if (
      authoritative.projectId !== workspace.projectId ||
      authoritative.rootPath !== workspace.rootPath ||
      authoritative.purpose !== workspace.purpose
    ) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "The supplied workspace handle does not match the authoritative workspace record.",
        { details: { workspaceId: workspace.id } },
      );
    }

    const workspaceRoot = await this.#options.resolveWorkspaceRoot(authoritative.id);
    await assertExistingDirectory(workspaceRoot);

    const sandboxId = SandboxId.parse(this.#options.generateSandboxId());
    const spec: SandboxExecutionSpec = Object.freeze({
      sandboxId,
      taskId,
      jobId,
      workspaceId: authoritative.id,
      workspaceRoot,
      budget,
      policy,
    });
    await this.#options.backend.prepare(spec, context);
    const handle = freezeHandle(spec, this.#options.backend.id, "ready");
    this.#sandboxes.set(sandboxId, { handle, spec });
    return handle;
  }

  async execute(
    sandbox: SandboxHandle,
    operation: string,
    parameters: ApplicationJsonObject,
    context: OperationContext,
  ): Promise<SandboxExecutionResult> {
    const entry = this.#require(sandbox.id);
    if (entry.handle.status === "stopped") {
      throw new ApplicationError("PERMISSION_DENIED", "The sandbox has been stopped.", {
        details: { sandboxId: sandbox.id },
      });
    }
    if (!this.#allowed.has(operation)) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "The sandbox may only run operations in its approved semantic operation set.",
        { details: { sandboxId: sandbox.id, operation } },
      );
    }
    this.#setStatus(entry, "running");
    try {
      const result = await this.#options.backend.execute(
        entry.spec,
        operation,
        parameters,
        context,
      );
      this.#setStatus(entry, "ready");
      return result;
    } catch (error) {
      if (error instanceof SandboxIndeterminateEffectError) {
        this.#setStatus(entry, "degraded");
        return Object.freeze({
          status: "unknown" as const,
          outputArtifactIds: Object.freeze([]),
          logArtifactIds: Object.freeze([]),
          metadata: Object.freeze({
            reason: "sandbox_effect_indeterminate",
            detail: error.message,
            operation,
          }),
        });
      }
      this.#setStatus(entry, "degraded");
      throw error;
    }
  }

  async inspect(id: SandboxId, _context: OperationContext): Promise<SandboxHandle | null> {
    return this.#sandboxes.get(id)?.handle ?? null;
  }

  async cancel(id: SandboxId, context: OperationContext): Promise<void> {
    const entry = this.#require(id);
    await this.#options.backend.cancel(entry.spec, context);
    this.#setStatus(entry, "ready");
  }

  async destroy(id: SandboxId, context: OperationContext): Promise<void> {
    const entry = this.#sandboxes.get(id);
    if (entry === undefined) return;
    this.#sandboxes.delete(id);
    await this.#options.backend.destroy(entry.spec, context);
  }

  #require(id: string): SandboxEntry {
    const entry = this.#sandboxes.get(id);
    if (entry === undefined) {
      throw new ApplicationError("NOT_FOUND", "The sandbox does not exist.", {
        details: { sandboxId: id },
      });
    }
    return entry;
  }

  #setStatus(entry: SandboxEntry, status: SandboxStatus): void {
    entry.handle = freezeHandle(entry.spec, this.#options.backend.id, status);
  }
}

function freezeHandle(
  spec: SandboxExecutionSpec,
  backendId: string,
  status: SandboxStatus,
): SandboxHandle {
  return Object.freeze({
    id: spec.sandboxId,
    jobId: spec.jobId,
    taskId: spec.taskId,
    workspaceId: spec.workspaceId,
    backendId,
    status,
  });
}

async function assertExistingDirectory(path: string): Promise<void> {
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

/**
 * Hermetic reference backend.
 *
 * It performs real work — real path containment against the assigned workspace and real
 * SHA-256 fingerprints of real file bytes — so tests exercise the actual boundary rather than
 * a stub. It deliberately performs **no** effects: an effectful request returns an honest
 * `failed` result naming the reason instead of fabricating success. It is the default for
 * hermetic verification and is not a security boundary; real isolation comes from a backend
 * such as the direct-Docker challenger, chosen only after a target-host bake-off.
 */
export class ReferenceSandboxBackend implements SandboxBackend {
  readonly id = "reference";

  async prepare(spec: SandboxExecutionSpec): Promise<void> {
    await assertExistingDirectory(spec.workspaceRoot);
  }

  async execute(
    spec: SandboxExecutionSpec,
    operation: string,
    parameters: ApplicationJsonObject,
  ): Promise<SandboxExecutionResult> {
    if (describesAnEffect(parameters)) {
      return Object.freeze({
        status: "failed" as const,
        outputArtifactIds: Object.freeze([]),
        logArtifactIds: Object.freeze([]),
        metadata: Object.freeze({
          reason: "reference_backend_performs_no_effects",
          operation,
        }),
      });
    }
    const fingerprints: Record<string, string> = {};
    for (const path of readPathScope(parameters)) {
      const contained = await containedPath(spec.workspaceRoot, path);
      const bytes = await readFile(contained).catch(() => null);
      fingerprints[path] = bytes === null ? "" : createHash("sha256").update(bytes).digest("hex");
    }
    return Object.freeze({
      status: "completed" as const,
      outputArtifactIds: Object.freeze([]),
      logArtifactIds: Object.freeze([]),
      metadata: Object.freeze({ operation, fingerprints: Object.freeze(fingerprints) }),
    });
  }

  async cancel(): Promise<void> {}
  async destroy(): Promise<void> {}
}

function describesAnEffect(parameters: ApplicationJsonObject): boolean {
  return parameters["patch"] !== undefined || parameters["executable"] !== undefined;
}

function readPathScope(parameters: ApplicationJsonObject): readonly string[] {
  const scope = parameters["pathScope"];
  if (!Array.isArray(scope)) return [];
  return scope.filter((entry): entry is string => typeof entry === "string");
}

/** Resolves a workspace-relative path and proves, through the real filesystem, that it stays inside. */
async function containedPath(workspaceRoot: string, relativePath: string): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const target = resolve(canonicalRoot, relativePath);
  const canonicalTarget = await realpath(target).catch(() => target);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + sep)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "A sandbox path escapes the assigned workspace.",
      { details: { workspaceRoot: canonicalRoot, path: relativePath } },
    );
  }
  return target;
}
