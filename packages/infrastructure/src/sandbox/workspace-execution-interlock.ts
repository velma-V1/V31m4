import { randomUUID } from "node:crypto";
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
 * **Policy: effect dispatch is exclusive per workspace.** Every governed operation reaches a
 * sandbox whose workspace mount is writable — `command.run` and `code.patch` obviously, but a
 * read operation still runs a process against that same mount — so no operation may be treated
 * as a harmless concurrent reader. One effect at a time per workspace, and a lifecycle change is
 * exclusive against both effects and other lifecycle changes.
 *
 * The interlock is deliberately synchronous where it matters. JavaScript runs the body of each
 * entry point up to its first `await` without interleaving, so claiming the workspace before any
 * asynchronous work makes the ordering a real guarantee rather than a hopeful one.
 *
 * A lease carries its own unique identity. Keying leases by `sandboxId` would let two executions
 * from one sandbox collapse into a single holder, so the first release would free the workspace
 * while the second effect was still running.
 */
export interface WorkspaceExecutionLease {
  readonly leaseId: string;
  readonly workspaceId: string;
  readonly sandboxId: string;
  /** Idempotent, and tied to this exact lease: releasing it never frees somebody else's claim. */
  release(): void;
}

export interface WorkspaceExecutionInterlockPort extends WorkspaceManagerPort {
  /**
   * Claims the workspace for one effect and returns the **current authoritative** record.
   * Callers must not trust any handle they captured earlier; this is the read that decides.
   */
  beginExecution(
    workspaceId: string,
    sandboxId: string,
    context: OperationContext,
  ): Promise<{ readonly workspace: WorkspaceHandle; readonly lease: WorkspaceExecutionLease }>;
}

interface WorkspaceClaim {
  readonly kind: "execution" | "lifecycle";
  readonly claimId: string;
  readonly sandboxId?: string;
}

export class WorkspaceExecutionInterlock implements WorkspaceExecutionInterlockPort {
  readonly #inner: WorkspaceManagerPort;
  /** At most one claim per workspace, whatever its kind. */
  readonly #claims = new Map<string, WorkspaceClaim>();

  constructor(inner: WorkspaceManagerPort) {
    this.#inner = inner;
  }

  async beginExecution(
    workspaceId: string,
    sandboxId: string,
    context: OperationContext,
  ): Promise<{ readonly workspace: WorkspaceHandle; readonly lease: WorkspaceExecutionLease }> {
    const claimId = this.#claim(workspaceId, {
      kind: "execution",
      claimId: randomUUID(),
      sandboxId,
    });
    const lease: WorkspaceExecutionLease = Object.freeze({
      leaseId: claimId,
      workspaceId,
      sandboxId,
      release: () => this.#release(workspaceId, claimId),
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

  /** Claims a workspace synchronously, or refuses. Returns the claim's unique id. */
  #claim(workspaceId: string, claim: WorkspaceClaim): string {
    const held = this.#claims.get(workspaceId);
    if (held !== undefined) {
      throw new ApplicationError(
        "CONFLICT",
        held.kind === "lifecycle"
          ? "The workspace lifecycle is being changed; nothing else may claim it."
          : "A sandbox effect is already in flight against this workspace.",
        {
          details: {
            workspaceId,
            heldBy: held.kind,
            ...(held.sandboxId === undefined ? {} : { sandboxId: held.sandboxId }),
            requested: claim.kind,
          },
        },
      );
    }
    this.#claims.set(workspaceId, claim);
    return claim.claimId;
  }

  /** Releases only if this exact claim still holds the workspace; safe to call repeatedly. */
  #release(workspaceId: string, claimId: string): void {
    if (this.#claims.get(workspaceId)?.claimId === claimId) {
      this.#claims.delete(workspaceId);
    }
  }

  async #mutate<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
    const claimId = this.#claim(workspaceId, { kind: "lifecycle", claimId: randomUUID() });
    try {
      return await run();
    } finally {
      this.#release(workspaceId, claimId);
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
    return this.#mutate(workspaceId, () => this.#inner.seal(workspaceId, context));
  }

  discard(workspaceId: string, context: OperationContext): Promise<void> {
    return this.#mutate(workspaceId, () => this.#inner.discard(workspaceId, context));
  }
}
