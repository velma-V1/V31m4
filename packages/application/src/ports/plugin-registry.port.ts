import type { CapabilityId, PluginId, PluginProfile, PluginStatus } from "@v31m4/domain";
import type { SafePath, ToolId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortHealth, PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface PluginManifest {
  readonly pluginId: PluginId;
  readonly displayName: string;
  readonly version: string;
  readonly minimumRuntimeVersion: string;
  readonly entrypoint: SafePath;
  readonly capabilities: readonly CapabilityId[];
  readonly requiredToolIds: readonly ToolId[];
  readonly optionalToolIds: readonly ToolId[];
  readonly workflowIds: readonly string[];
  readonly verifierIds: readonly string[];
  readonly permissions: Readonly<{
    filesystem: readonly string[];
    network: boolean;
    process: readonly string[];
  }>;
}

export interface PluginRegistryPort {
  register(manifest: PluginManifest, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<PluginProfile>>;
  get(pluginId: PluginId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<PluginProfile> | null>;
  list(request: PortPageRequest, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<PluginProfile>>>;
  setStatus(pluginId: PluginId, status: PluginStatus, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<PluginProfile>>;
  findByCapability(capabilityId: CapabilityId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<readonly PluginProfile[]>;
  health(pluginId: PluginId, context: OperationContext): Promise<PortHealth>;
}
