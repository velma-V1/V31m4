import { ApplicationError, type PluginManifest } from "@v31m4/application";
import { CapabilityId, PluginId, SafePath, ToolId } from "@v31m4/domain";

/** The department-host API version this build implements. Departments declare a compatible target. */
export const HOST_API_VERSION = "1.0.0";

/**
 * A first-party removable department's manifest. It maps onto the core `PluginManifest` for durable
 * registration, but adds the host-level fields (compatible host API version, requested permissions,
 * required model ids, isolated workspace path) the lifecycle host needs.
 */
export interface DepartmentManifest {
  readonly departmentId: string;
  readonly displayName: string;
  readonly version: string;
  readonly hostApiVersion: string;
  readonly capabilities: readonly string[];
  readonly requiredToolIds: readonly string[];
  readonly optionalToolIds: readonly string[];
  readonly requiredModelIds: readonly string[];
  readonly permissions: readonly string[];
  readonly workspacePath: string;
}

const DURABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const PERMISSION = /^[a-z][a-z0-9]*(?:[.:][a-z0-9]+)*$/u;

function invalid(message: string, details: Record<string, unknown>): never {
  throw new ApplicationError("INVALID_APPLICATION_INPUT", message, {
    details: details as Record<string, never>,
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`Department manifest field '${field}' must be a non-empty string.`, { field });
  }
  return value;
}

function requireStringArray(value: unknown, field: string, pattern: RegExp): readonly string[] {
  if (!Array.isArray(value)) {
    invalid(`Department manifest field '${field}' must be an array.`, { field });
  }
  const items = value.map((entry, index) => {
    if (typeof entry !== "string" || !pattern.test(entry)) {
      invalid(`Department manifest '${field}[${index}]' is malformed.`, { field, index });
    }
    return entry;
  });
  if (new Set(items).size !== items.length) {
    invalid(`Department manifest field '${field}' has duplicates.`, { field });
  }
  return Object.freeze(items);
}

/** Validates and freezes a department manifest, or throws `INVALID_APPLICATION_INPUT`. */
export function parseDepartmentManifest(raw: DepartmentManifest): DepartmentManifest {
  const departmentId = requireString(raw.departmentId, "departmentId");
  if (!DURABLE_ID.test(departmentId))
    invalid("departmentId is not a durable id.", { departmentId });
  const version = requireString(raw.version, "version");
  if (!SEMVER.test(version)) invalid("version must be semantic version format.", { version });
  const hostApiVersion = requireString(raw.hostApiVersion, "hostApiVersion");
  if (!SEMVER.test(hostApiVersion)) {
    invalid("hostApiVersion must be semantic version format.", { hostApiVersion });
  }
  const capabilities = requireStringArray(raw.capabilities, "capabilities", DURABLE_ID);
  if (capabilities.length === 0) invalid("A department must expose at least one capability.", {});
  const workspacePath = requireString(raw.workspacePath, "workspacePath");
  SafePath.parse(workspacePath); // reject traversal / unsafe paths, fail closed
  return Object.freeze({
    departmentId,
    displayName: requireString(raw.displayName, "displayName"),
    version,
    hostApiVersion,
    capabilities,
    requiredToolIds: requireStringArray(raw.requiredToolIds ?? [], "requiredToolIds", DURABLE_ID),
    optionalToolIds: requireStringArray(raw.optionalToolIds ?? [], "optionalToolIds", DURABLE_ID),
    requiredModelIds: requireStringArray(
      raw.requiredModelIds ?? [],
      "requiredModelIds",
      DURABLE_ID,
    ),
    permissions: requireStringArray(raw.permissions ?? [], "permissions", PERMISSION),
    workspacePath,
  });
}

/** Projects a department manifest onto the core `PluginManifest` used by the durable plugin registry. */
export function toPluginManifest(manifest: DepartmentManifest): PluginManifest {
  return {
    pluginId: PluginId.parse(manifest.departmentId),
    displayName: manifest.displayName,
    version: manifest.version,
    minimumRuntimeVersion: manifest.hostApiVersion,
    entrypoint: SafePath.parse(manifest.workspacePath),
    capabilities: manifest.capabilities.map((id) => CapabilityId.parse(id)),
    requiredToolIds: manifest.requiredToolIds.map((id) => ToolId.parse(id)),
    optionalToolIds: manifest.optionalToolIds.map((id) => ToolId.parse(id)),
    workflowIds: [],
    verifierIds: [],
    permissions: Object.freeze({
      filesystem: Object.freeze([manifest.workspacePath]),
      network: false,
      process: Object.freeze([]),
    }),
  };
}
