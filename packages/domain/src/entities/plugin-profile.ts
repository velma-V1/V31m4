import { assertDomain } from "../domain-errors.js";
import {
  CapabilityId,
  PluginId,
  ToolId,
  type CapabilityId as CapabilityIdType,
  type PluginId as PluginIdType,
  type ToolId as ToolIdType,
} from "../value-objects/ids.js";

export type PluginStatus = "registered" | "active" | "inactive" | "failed";

export interface PluginProfile {
  readonly pluginId: PluginIdType;
  readonly version: string;
  readonly status: PluginStatus;
  readonly capabilities: readonly CapabilityIdType[];
  readonly requiredToolIds: readonly ToolIdType[];
  readonly optionalToolIds: readonly ToolIdType[];
}

const STATUSES = new Set<PluginStatus>(["registered", "active", "inactive", "failed"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function unique<T extends string>(values: readonly T[], field: string): readonly T[] {
  assertDomain(
    new Set(values).size === values.length,
    "INVALID_PLUGIN_PROFILE",
    `${field} values must be unique.`,
  );
  return Object.freeze([...values]);
}

export const PluginProfile = Object.freeze({
  create(input: {
    readonly pluginId: string;
    readonly version: string;
    readonly status: PluginStatus;
    readonly capabilities: readonly string[];
    readonly requiredToolIds?: readonly string[];
    readonly optionalToolIds?: readonly string[];
  }): PluginProfile {
    assertDomain(STATUSES.has(input.status), "INVALID_PLUGIN_PROFILE", "Plugin status is invalid.");
    assertDomain(
      VERSION_PATTERN.test(input.version),
      "INVALID_PLUGIN_PROFILE",
      "Plugin version must be semantic version format.",
    );
    const required = unique((input.requiredToolIds ?? []).map((id) => ToolId.parse(id)), "requiredToolIds");
    const optional = unique((input.optionalToolIds ?? []).map((id) => ToolId.parse(id)), "optionalToolIds");
    assertDomain(
      required.every((id) => !optional.includes(id)),
      "INVALID_PLUGIN_PROFILE",
      "A tool cannot be both required and optional.",
    );
    const capabilities = unique(
      input.capabilities.map((id) => CapabilityId.parse(id)),
      "capabilities",
    );
    assertDomain(
      capabilities.length > 0,
      "INVALID_PLUGIN_PROFILE",
      "A plugin must expose at least one capability.",
    );
    return Object.freeze({
      pluginId: PluginId.parse(input.pluginId),
      version: input.version,
      status: input.status,
      capabilities: capabilities as readonly CapabilityIdType[],
      requiredToolIds: required as readonly ToolIdType[],
      optionalToolIds: optional as readonly ToolIdType[],
    });
  },

  setStatus(profile: PluginProfile, status: PluginStatus): PluginProfile {
    assertDomain(STATUSES.has(status), "INVALID_PLUGIN_PROFILE", "Plugin status is invalid.");
    assertDomain(
      !(profile.status === "failed" && status === "active"),
      "INVALID_STATE_TRANSITION",
      "Failed plugins must be re-registered before activation.",
    );
    return Object.freeze({ ...profile, status });
  },
});
