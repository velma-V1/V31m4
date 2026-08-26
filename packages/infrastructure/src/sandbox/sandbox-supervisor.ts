import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  type OperationContext,
  type SandboxExecutionResult,
  type SandboxHandle,
  type SandboxIsolationPolicy,
  type SandboxPort,
  type SandboxStatus,
  type SemanticExecutionCapabilityVerifier,
  type WorkspaceCurrencyPrecondition,
  type WorkspaceHandle,
} from "@v31m4/application";
import { type JobId, type ResourceBudget, SandboxId, type TaskId } from "@v31m4/domain";
import type { WorkspaceExecutionInterlockPort } from "./workspace-execution-interlock.js";
import {
  assertExistingDirectory,
  assertSameCanonicalRoot,
  assertWorkspaceIdentityUnchanged,
  assertWorkspaceStillCurrent,
  compareAndApply,
} from "./workspace-guards.js";

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
  /**
   * The only sanctioned way for a backend to write into the assigned workspace. It re-verifies
   * the plan's declared fingerprint and writes atomically, so a future patch backend cannot
   * accidentally apply a stale change by writing directly.
   */
  readonly applyWorkspaceChange: WorkspaceCompareAndApply;
}

/**
 * Compare-and-apply over the assigned workspace. There is no "just write" entry point: the
 * expected fingerprint is re-checked inside the same call that performs the write, under the
 * execution lease the supervisor holds, so check and apply cannot drift apart.
 */
export type WorkspaceCompareAndApply = (
  precondition: WorkspaceCurrencyPrecondition,
  nextContent: string | Uint8Array,
) => Promise<void>;

export interface SandboxBackend {
  readonly id: string;
  /**
   * Backends that can apply workspace writes must declare it. The supervisor refuses to dispatch
   * a `workspace_write` effect to a backend that has not, so a write path can never appear by
   * accident — only by an explicit opt-in that comes with the compare-and-apply primitive.
   */
  readonly supportsWorkspaceWrite?: boolean;
  prepare(spec: SandboxExecutionSpec, context: OperationContext): Promise<void>;
  /**
   * Backends receive an issued authorization, never a bare operation name plus free-form JSON.
   * The command a process backend runs comes from `plan.command`, which the runtime derived —
   * so a caller cannot name one operation and execute another.
   */
  execute(
    spec: SandboxExecutionSpec,
    plan: AuthorizedSemanticExecutionPlan,
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
  /**
   * The one workspace authority, wrapped so lifecycle changes and in-flight effects are ordered
   * against each other. Execution re-reads through this rather than trusting any captured handle.
   */
  readonly workspaces: WorkspaceExecutionInterlockPort;
  /**
   * The closed set of semantic operations this sandbox may run. The catalog itself is owned
   * by the runtime; injecting the set keeps the boundary fail-closed without creating a
   * second copy of the operation registry inside infrastructure.
   */
  readonly allowedOperations: readonly string[];
  /**
   * The verify/consume half of the semantic authorization boundary this sandbox is paired with.
   * Only capabilities minted by that exact boundary are accepted, and each is spent once.
   */
  readonly capabilities: SemanticExecutionCapabilityVerifier;
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
  /** The authoritative record as it stood at prepare time, for identity comparison only. */
  readonly preparedWorkspace: WorkspaceHandle;
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
      applyWorkspaceChange: (
        precondition: WorkspaceCurrencyPrecondition,
        nextContent: string | Uint8Array,
      ) => compareAndApply(workspaceRoot, precondition, nextContent),
    });
    await this.#options.backend.prepare(spec, context);
    const handle = freezeHandle(spec, this.#options.backend.id, "ready");
    this.#sandboxes.set(sandboxId, { handle, spec, preparedWorkspace: authoritative });
    return handle;
  }

  async execute(
    sandbox: SandboxHandle,
    plan: AuthorizedSemanticExecutionPlan,
    context: OperationContext,
  ): Promise<SandboxExecutionResult> {
    // Identity, not shape: only a capability this sandbox's paired boundary minted is accepted.
    const verified = this.#options.capabilities.verify(plan);
    const entry = this.#require(sandbox.id);
    if (entry.handle.status === "stopped") {
      throw new ApplicationError("PERMISSION_DENIED", "The sandbox has been stopped.", {
        details: { sandboxId: sandbox.id },
      });
    }
    // The authorization is bound to one sandbox, task, job, and workspace. A plan issued for
    // anything else cannot be replayed here.
    if (
      verified.sandboxId !== entry.spec.sandboxId ||
      verified.workspaceId !== entry.spec.workspaceId ||
      verified.taskId !== entry.spec.taskId ||
      verified.jobId !== entry.spec.jobId
    ) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "The authorization was not issued for this sandbox, task, job, and workspace.",
        { details: { sandboxId: sandbox.id, operationId: verified.operationId } },
      );
    }
    if (!this.#allowed.has(verified.operationId)) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "The sandbox may only run operations in its approved semantic operation set.",
        { details: { sandboxId: sandbox.id, operation: verified.operationId } },
      );
    }
    if (
      verified.effectClass === "workspace_write" &&
      this.#options.backend.supportsWorkspaceWrite !== true
    ) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "This backend does not declare workspace-write support, so it may not receive a write effect.",
        { details: { sandboxId: sandbox.id, backend: this.#options.backend.id } },
      );
    }
    // Spend the capability before any effect can start, so an interrupted attempt cannot be
    // retried on the same authority.
    this.#options.capabilities.consume(verified);

    // Take the execution lease and re-read the *authoritative* workspace. Neither the caller's
    // handle nor the prepare-time record is execution authority: a workspace sealed, discarded,
    // or replaced since then must stop the effect before dispatch, and the lease keeps a seal
    // from landing between this check and the backend call.
    const { workspace: authoritative, lease } = await this.#options.workspaces.beginExecution(
      entry.spec.workspaceId,
      entry.spec.sandboxId,
      context,
    );
    try {
      assertWorkspaceIdentityUnchanged(
        authoritative,
        entry.preparedWorkspace,
        entry.spec.sandboxId,
      );
      // The path the workspace resolves to must also still be the one the sandbox prepared.
      const currentRoot = await this.#options.resolveWorkspaceRoot(authoritative.id);
      await assertSameCanonicalRoot(entry.spec.workspaceRoot, currentRoot, entry.spec.sandboxId);
      // Re-verify the workspace facts this execution depends on. Authorization-time validation
      // leaves a window in which the workspace moves on and a stale effect still runs.
      await assertWorkspaceStillCurrent(entry.spec.workspaceRoot, verified);
    } catch (error) {
      // Refused before dispatch: nothing ran, so the sandbox itself is not degraded.
      lease.release();
      throw error;
    }

    try {
      this.#setStatus(entry, "running");
      const result = await this.#options.backend.execute(entry.spec, verified, context);
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
            operationId: verified.operationId,
            executionPlanId: verified.executionPlanId,
          }),
        });
      }
      this.#setStatus(entry, "degraded");
      throw error;
    } finally {
      lease.release();
    }
  }

  async inspect(id: SandboxId, _context: OperationContext): Promise<SandboxHandle | null> {
    return this.#sandboxes.get(id)?.handle ?? null;
  }

  async cancel(id: SandboxId, context: OperationContext): Promise<void> {
    const entry = this.#require(id);
    try {
      await this.#options.backend.cancel(entry.spec, context);
    } catch (error) {
      // Cleanup failed, so the sandbox's real state is unknown. Keep it degraded and
      // reconcilable instead of reporting a clean cancellation.
      this.#setStatus(entry, "degraded");
      throw error;
    }
    this.#setStatus(entry, "ready");
  }

  /**
   * Destroys a sandbox and only then forgets it. Deleting authoritative lifecycle state before
   * destruction succeeds would strand a live container with nothing left to reconcile against,
   * so a failed destroy leaves the sandbox degraded and still inspectable.
   */
  async destroy(id: SandboxId, context: OperationContext): Promise<void> {
    const entry = this.#sandboxes.get(id);
    if (entry === undefined) return;
    try {
      await this.#options.backend.destroy(entry.spec, context);
    } catch (error) {
      this.#setStatus(entry, "degraded");
      throw error;
    }
    this.#sandboxes.delete(id);
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
