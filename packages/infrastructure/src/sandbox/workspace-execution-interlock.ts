import {
  ApplicationError,
  type OperationContext,
  type WorkspaceHandle,
  type WorkspaceManagerPort,
  type WorkspacePurpose,
  type WorkspaceSnapshot,
} from "@v31m4/application";
import type { ProjectId } from "@v31m4/domain";

/**
 * Coordination between workspace lifecycle changes and in-flight sandbox effects.
 *
 * This is a **decorator**, not a second authority: it implements `WorkspaceManagerPort` and
 * delegates every operation to the real manager. Composition installs it as *the* workspace
 * manager, so there is exactly one object everyone holds and exactly one place where sealing,
 * discarding, and executing are ordered against each other.
 *
 * The interlock is deliberately synchronous where it matters. JavaScript runs the body of
 * `beginExecution` up to its first `await` without interleaving, so registering the lease before
 * any asynchronous work makes "no seal can start after this point" a real guarantee rather than
 * a hopeful one. `seal`/`discard` register their own marker the same way, which closes the
 * mirror-image race where a seal is already in flight when an execution begins.
 */
export interface WorkspaceExecutionLease {
  readonly workspaceId: string;
  readonly sandboxId: string;
  release(): void;
}

export interface WorkspaceExecutionInterlockPort extends WorkspaceManagerPort {
  /**
   * Takes an execution lease and returns the **current authoritative** workspace record. Callers
   * must not trust any handle they captured earlier; this is the read that decides.
   */
  beginExecution(
    workspaceId: string,
    sandboxId: string,
    context: OperationContext,
  ): Promise<{ readonly workspace: WorkspaceHandle; readonly lease: WorkspaceExecutionLease }>;
}

export class WorkspaceExecutionInterlock implements WorkspaceExecutionInterlockPort {
  readonly #inner: WorkspaceManagerPort;
  /** workspaceId -> sandboxIds currently dispatching an effect against it. */
  readonly #executing = new Map<string, Set<string>>();
  /** workspaceIds whose lifecycle is currently being changed. */
  readonly #mutating = new Set<string>();

  constructor(inner: WorkspaceManagerPort) {
    this.#inner = inner;
  }

  async beginExecution(
    workspaceId: string,
    sandboxId: string,
    context: OperationContext,
  ): Promise<{ readonly workspace: WorkspaceHandle; readonly lease: WorkspaceExecutionLease }> {
    if (this.#mutating.has(workspaceId)) {
      throw new ApplicationError(
        "CONFLICT",
        "The workspace lifecycle is being changed; no effect may enter dispatch against it.",
        { details: { workspaceId, sandboxId } },
      );
    }
    // Register synchronously, before the first await: from here on a seal or discard is refused.
    const holders = this.#executing.get(workspaceId) ?? new Set<string>();
    holders.add(sandboxId);
    this.#executing.set(workspaceId, holders);
    const lease: WorkspaceExecutionLease = Object.freeze({
      workspaceId,
      sandboxId,
      release: () => this.#release(workspaceId, sandboxId),
    });

    try {
      const workspace = await this.#inner.get(workspaceId, context);
      if (workspace === null) {
        throw new ApplicationError(
          "NOT_FOUND",
          "The assigned workspace no longer exists; the effect is refused before dispatch.",
          { details: { workspaceId, sandboxId } },
        );
      }
      if (workspace.status !== "active") {
        throw new ApplicationError(
          "CONFLICT",
          "The assigned workspace is no longer active; the effect is refused before dispatch.",
          { details: { workspaceId, sandboxId, status: workspace.status } },
        );
      }
      return { workspace, lease };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  #release(workspaceId: string, sandboxId: string): void {
    const holders = this.#executing.get(workspaceId);
    if (holders === undefined) return;
    holders.delete(sandboxId);
    if (holders.size === 0) this.#executing.delete(workspaceId);
  }

  #assertNoInFlightEffect(workspaceId: string, operation: string): void {
    const holders = this.#executing.get(workspaceId);
    if (holders !== undefined && holders.size > 0) {
      throw new ApplicationError(
        "CONFLICT",
        `A sandbox effect is in flight against this workspace; ${operation} would invalidate it mid-dispatch.`,
        { details: { workspaceId, sandboxIds: [...holders] } },
      );
    }
  }

  async #mutate<T>(workspaceId: string, operation: string, run: () => Promise<T>): Promise<T> {
    this.#assertNoInFlightEffect(workspaceId, operation);
    // Registered synchronously for the same reason `beginExecution` registers early.
    this.#mutating.add(workspaceId);
    try {
      return await run();
    } finally {
      this.#mutating.delete(workspaceId);
    }
  }

  create(
    projectId: ProjectId,
    purpose: WorkspacePurpose,
    context: OperationContext,
  ): Promise<WorkspaceHandle> {
    return this.#inner.create(projectId, purpose, context);
  }

  get(workspaceId: string, context: OperationContext): Promise<WorkspaceHandle | null> {
    return this.#inner.get(workspaceId, context);
  }

  snapshot(workspaceId: string, context: OperationContext): Promise<WorkspaceSnapshot> {
    return this.#inner.snapshot(workspaceId, context);
  }

  seal(workspaceId: string, context: OperationContext): Promise<WorkspaceHandle> {
    return this.#mutate(workspaceId, "sealing", () => this.#inner.seal(workspaceId, context));
  }

  discard(workspaceId: string, context: OperationContext): Promise<void> {
    return this.#mutate(workspaceId, "discarding", () => this.#inner.discard(workspaceId, context));
  }
}
