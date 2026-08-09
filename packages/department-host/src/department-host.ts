import {
  ApplicationError,
  type ApplicationJsonValue,
  type ClockPort,
  isApplicationError,
  type OperationContext,
  type PluginRegistryPort,
  type PortHealth,
  type UnitOfWorkPort,
  WriteConditions,
} from "@v31m4/application";
import { PluginId } from "@v31m4/domain";
import {
  type DepartmentManifest,
  HOST_API_VERSION,
  parseDepartmentManifest,
  toPluginManifest,
} from "./department-manifest.js";
import type {
  DepartmentAuditSink,
  DepartmentConnector,
  DepartmentGrant,
  DepartmentInstance,
  WorkspaceAllocator,
} from "./department-runtime.js";
import { assertTransition, type DepartmentLifecycleState } from "./lifecycle.js";

export interface DepartmentHostOptions {
  readonly registry: PluginRegistryPort;
  readonly unitOfWork: UnitOfWorkPort;
  readonly connector: DepartmentConnector;
  readonly workspaces: WorkspaceAllocator;
  readonly clock: ClockPort;
  readonly audit?: DepartmentAuditSink;
  readonly hostApiVersion?: string;
}

export interface DepartmentStatus {
  readonly departmentId: string;
  readonly version: string;
  readonly state: DepartmentLifecycleState;
}

interface DepartmentEntry {
  readonly manifest: DepartmentManifest;
  readonly grant: DepartmentGrant;
  readonly workspacePath: string;
  release(): Promise<void>;
  state: DepartmentLifecycleState;
  instance: DepartmentInstance | undefined;
}

function subsetOf(requested: readonly string[], available: readonly string[]): string | null {
  const set = new Set(available);
  for (const item of requested) if (!set.has(item)) return item;
  return null;
}

/**
 * Generic removable-department host. It owns the department lifecycle (install → enable → start →
 * invoke/health → stop → disable → remove) on top of the existing core infrastructure: durable
 * registration and coarse status live in the injected `PluginRegistryPort`, isolation is delegated to
 * a `DepartmentConnector`, and isolated storage is allocated through a `WorkspaceAllocator` with
 * rollback. The host fails closed on invalid manifests, incompatible host API versions, ungranted
 * permissions, and missing dependencies, and core operates unchanged with zero departments installed.
 */
export class DepartmentHost {
  readonly #entries = new Map<string, DepartmentEntry>();
  readonly #hostApiVersion: string;

  constructor(private readonly options: DepartmentHostOptions) {
    this.#hostApiVersion = options.hostApiVersion ?? HOST_API_VERSION;
  }

  /** Validates, allocates isolation, and durably registers a department. Rolls back on failure. */
  async install(
    rawManifest: DepartmentManifest,
    grant: DepartmentGrant,
    context: OperationContext,
  ): Promise<DepartmentStatus> {
    const manifest = parseDepartmentManifest(rawManifest);
    const id = manifest.departmentId;
    this.#assertCompatible(manifest);
    const existing = this.#entries.get(id);
    if (existing !== undefined && existing.state !== "removed") {
      throw new ApplicationError("ALREADY_EXISTS", "Department is already installed.", {
        details: { departmentId: id },
      });
    }
    const missingPermission = subsetOf(manifest.permissions, grant.permissions);
    if (missingPermission !== null) {
      this.#audit(id, "install", "rejected", `permission not granted: ${missingPermission}`);
      throw new ApplicationError("PERMISSION_DENIED", "Department permission not granted.", {
        details: { departmentId: id, permission: missingPermission },
      });
    }
    const missingTool = subsetOf(manifest.requiredToolIds, grant.availableToolIds);
    const missingModel = subsetOf(manifest.requiredModelIds, grant.availableModelIds);
    if (missingTool !== null || missingModel !== null) {
      this.#audit(id, "install", "rejected", "required dependency unavailable");
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Department dependency unavailable.", {
        details: { departmentId: id, tool: missingTool, model: missingModel },
        retryable: true,
      });
    }
    const workspace = await this.options.workspaces.allocate(id, manifest.workspacePath);
    try {
      await this.options.unitOfWork.execute(context, (transaction) =>
        this.options.registry.register(toPluginManifest(manifest), context, transaction),
      );
    } catch (error) {
      // Install rollback: reclaim the isolated workspace so a failed install leaves nothing behind.
      await workspace.release().catch(() => undefined);
      this.#audit(id, "install", "failed", "registration failed");
      throw error;
    }
    this.#entries.set(id, {
      manifest,
      grant,
      workspacePath: workspace.path,
      release: () => workspace.release(),
      state: "installed",
      instance: undefined,
    });
    this.#audit(id, "install", "completed");
    return this.#status(id);
  }

  async enable(departmentId: string, _context: OperationContext): Promise<DepartmentStatus> {
    const entry = this.#require(departmentId);
    assertTransition(departmentId, entry.state, "enabled");
    entry.state = "enabled";
    this.#audit(departmentId, "enable", "completed");
    return this.#status(departmentId);
  }

  async start(departmentId: string, context: OperationContext): Promise<DepartmentStatus> {
    const entry = this.#require(departmentId);
    assertTransition(departmentId, entry.state, "started");
    let instance: DepartmentInstance;
    try {
      instance = await this.options.connector.connect(entry.manifest, entry.grant, context);
      await instance.start(context);
    } catch (error) {
      // A failed start leaves the department enabled and re-startable; the durable record is untouched.
      this.#audit(departmentId, "start", "failed", "connect/start error");
      throw this.#asDependencyFailure(error, departmentId, "start");
    }
    entry.instance = instance;
    entry.state = "started";
    await this.#setDurableStatus(departmentId, "active", context);
    this.#audit(departmentId, "start", "completed");
    return this.#status(departmentId);
  }

  async invoke(
    departmentId: string,
    capabilityId: string,
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const entry = this.#require(departmentId);
    if (entry.state !== "started" || entry.instance === undefined) {
      throw new ApplicationError("CONFLICT", "Department is not started.", {
        details: { departmentId, state: entry.state },
      });
    }
    if (!entry.manifest.capabilities.includes(capabilityId)) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "Department capability is not declared.",
        {
          details: { departmentId, capabilityId },
        },
      );
    }
    try {
      return await entry.instance.invoke(capabilityId, request, context);
    } catch (error) {
      throw this.#asDependencyFailure(error, departmentId, capabilityId);
    }
  }

  async health(departmentId: string, context: OperationContext): Promise<PortHealth> {
    const entry = this.#require(departmentId);
    if (entry.state === "started" && entry.instance !== undefined) {
      try {
        return await entry.instance.health(context);
      } catch {
        return this.#synthHealth(departmentId, "degraded", "health probe failed");
      }
    }
    if (entry.state === "removed") return this.#synthHealth(departmentId, "unavailable", "removed");
    return this.#synthHealth(departmentId, "degraded", `not running (${entry.state})`);
  }

  async stop(departmentId: string, context: OperationContext): Promise<DepartmentStatus> {
    const entry = this.#require(departmentId);
    assertTransition(departmentId, entry.state, "stopped");
    try {
      await entry.instance?.stop(context);
    } finally {
      entry.instance = undefined;
    }
    entry.state = "stopped";
    await this.#setDurableStatus(departmentId, "inactive", context);
    this.#audit(departmentId, "stop", "completed");
    return this.#status(departmentId);
  }

  async disable(departmentId: string, context: OperationContext): Promise<DepartmentStatus> {
    const entry = this.#require(departmentId);
    assertTransition(departmentId, entry.state, "disabled");
    entry.state = "disabled";
    await this.#setDurableStatus(departmentId, "inactive", context);
    this.#audit(departmentId, "disable", "completed");
    return this.#status(departmentId);
  }

  /** Removes a stopped/disabled department and reclaims its workspace; rolls back if reclaim fails. */
  async remove(departmentId: string, context: OperationContext): Promise<DepartmentStatus> {
    const entry = this.#require(departmentId);
    assertTransition(departmentId, entry.state, "removed");
    try {
      await entry.release();
    } catch (error) {
      // Removal rollback: a failed workspace reclaim leaves the department in its prior state.
      this.#audit(departmentId, "remove", "failed", "workspace reclaim failed");
      throw this.#asDependencyFailure(error, departmentId, "remove");
    }
    entry.state = "removed";
    entry.instance = undefined;
    await this.#setDurableStatus(departmentId, "inactive", context);
    this.#audit(departmentId, "remove", "completed");
    return this.#status(departmentId);
  }

  list(): readonly DepartmentStatus[] {
    return Object.freeze([...this.#entries.keys()].map((id) => this.#status(id)));
  }

  state(departmentId: string): DepartmentLifecycleState | null {
    return this.#entries.get(departmentId)?.state ?? null;
  }

  #require(departmentId: string): DepartmentEntry {
    const entry = this.#entries.get(departmentId);
    if (entry === undefined || entry.state === "removed") {
      throw new ApplicationError("NOT_FOUND", "Department is not installed.", {
        details: { departmentId },
      });
    }
    return entry;
  }

  #status(departmentId: string): DepartmentStatus {
    const entry = this.#entries.get(departmentId);
    if (entry === undefined) {
      throw new ApplicationError("NOT_FOUND", "Department is not installed.", {
        details: { departmentId },
      });
    }
    return Object.freeze({
      departmentId,
      version: entry.manifest.version,
      state: entry.state,
    });
  }

  #assertCompatible(manifest: DepartmentManifest): void {
    const hostMajor = this.#hostApiVersion.split(".")[0];
    const manifestMajor = manifest.hostApiVersion.split(".")[0];
    if (hostMajor !== manifestMajor) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "Department targets an incompatible host API version.",
        {
          details: {
            departmentId: manifest.departmentId,
            hostApiVersion: this.#hostApiVersion,
            required: manifest.hostApiVersion,
          },
        },
      );
    }
  }

  async #setDurableStatus(
    departmentId: string,
    status: "active" | "inactive",
    context: OperationContext,
  ): Promise<void> {
    await this.options.unitOfWork.execute(context, (transaction) =>
      this.options.registry.setStatus(
        PluginId.parse(departmentId),
        status,
        WriteConditions.any(),
        context,
        transaction,
      ),
    );
  }

  #asDependencyFailure(error: unknown, departmentId: string, operation: string): ApplicationError {
    if (isApplicationError(error)) return error;
    return new ApplicationError("DEPENDENCY_FAILURE", "Department operation failed.", {
      cause: error,
      details: { departmentId, operation },
      retryable: true,
    });
  }

  #synthHealth(departmentId: string, status: PortHealth["status"], message: string): PortHealth {
    return Object.freeze({
      status,
      checkedAt: this.options.clock.now(),
      message,
      details: { departmentId },
    });
  }

  #audit(
    departmentId: string,
    action: string,
    outcome: "completed" | "rejected" | "failed",
    detail?: string,
  ): void {
    this.options.audit?.record({
      departmentId,
      action,
      outcome,
      at: this.options.clock.now(),
      ...(detail === undefined ? {} : { detail }),
    });
  }
}
