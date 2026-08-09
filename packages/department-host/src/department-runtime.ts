import type { ApplicationJsonValue, OperationContext, PortHealth } from "@v31m4/application";
import type { DepartmentManifest } from "./department-manifest.js";

/**
 * The permissions and dependency availability the host grants a department at install time. The host
 * fails closed if a manifest requests a permission, tool, or model not present in its grant.
 */
export interface DepartmentGrant {
  readonly permissions: readonly string[];
  readonly availableToolIds: readonly string[];
  readonly availableModelIds: readonly string[];
}

/** A live, started department behind an isolation boundary (a supervised process or in-process module). */
export interface DepartmentInstance {
  start(context: OperationContext): Promise<void>;
  invoke(
    capabilityId: string,
    request: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue>;
  health(context: OperationContext): Promise<PortHealth>;
  stop(context: OperationContext): Promise<void>;
}

/**
 * Creates a department's live instance. Production connectors spawn a supervised child process
 * (Layer 8 `ProcessSupervisor` + `JsonRpcClient`) or load an in-process first-party module; the host
 * depends only on this interface so the isolation mechanism is a swappable boundary.
 */
export interface DepartmentConnector {
  connect(
    manifest: DepartmentManifest,
    grant: DepartmentGrant,
    context: OperationContext,
  ): Promise<DepartmentInstance>;
}

/** An isolated storage area allocated for one department, reclaimable on install rollback or removal. */
export interface DepartmentWorkspace {
  readonly path: string;
  release(): Promise<void>;
}

export interface WorkspaceAllocator {
  allocate(departmentId: string, relativePath: string): Promise<DepartmentWorkspace>;
}

export interface DepartmentAuditEntry {
  readonly departmentId: string;
  readonly action: string;
  readonly outcome: "completed" | "rejected" | "failed";
  readonly at: string;
  readonly detail?: string;
}

/** Evidence sink for lifecycle transitions. Production wires this to the audit store. */
export interface DepartmentAuditSink {
  record(entry: DepartmentAuditEntry): void;
}
