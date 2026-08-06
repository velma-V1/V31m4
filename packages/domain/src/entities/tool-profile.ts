import { assertDomain } from "../domain-errors.js";
import {
  AdapterId,
  ToolId,
  type AdapterId as AdapterIdType,
  type ToolId as ToolIdType,
} from "../value-objects/ids.js";
import type { ProfileAvailability } from "./model-profile.js";

export type ToolAutomationMethod = "native_api" | "python" | "cli" | "structured_file" | "gui";

export interface ToolProfile {
  readonly toolId: ToolIdType;
  readonly adapterId: AdapterIdType;
  readonly displayName: string;
  readonly status: ProfileAvailability;
  readonly operations: readonly string[];
  readonly installedVersion?: string;
  readonly automationMethod: ToolAutomationMethod;
}

const STATUSES = new Set<ProfileAvailability>(["available", "unavailable", "degraded"]);
const METHODS = new Set<ToolAutomationMethod>([
  "native_api",
  "python",
  "cli",
  "structured_file",
  "gui",
]);
const OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export const ToolProfile = Object.freeze({
  create(input: {
    readonly toolId: string;
    readonly adapterId: string;
    readonly displayName: string;
    readonly status: ProfileAvailability;
    readonly operations: readonly string[];
    readonly installedVersion?: string;
    readonly automationMethod: ToolAutomationMethod;
  }): ToolProfile {
    assertDomain(STATUSES.has(input.status), "INVALID_TOOL_PROFILE", "Tool status is invalid.");
    assertDomain(
      METHODS.has(input.automationMethod),
      "INVALID_TOOL_PROFILE",
      "Tool automation method is invalid.",
    );
    assertDomain(
      input.displayName.length > 0 &&
        input.displayName === input.displayName.trim() &&
        input.displayName.length <= 160,
      "INVALID_TOOL_PROFILE",
      "Tool display name must be canonical.",
    );
    assertDomain(
      input.operations.length > 0 &&
        input.operations.every((operation) => OPERATION_PATTERN.test(operation)) &&
        new Set(input.operations).size === input.operations.length,
      "INVALID_TOOL_PROFILE",
      "Tool operations must contain unique canonical operation names.",
    );
    if (input.installedVersion !== undefined) {
      assertDomain(
        input.installedVersion.length > 0 &&
          input.installedVersion === input.installedVersion.trim() &&
          input.installedVersion.length <= 80,
        "INVALID_TOOL_PROFILE",
        "Installed tool version must be canonical.",
      );
    }
    return Object.freeze({
      toolId: ToolId.parse(input.toolId),
      adapterId: AdapterId.parse(input.adapterId),
      displayName: input.displayName,
      status: input.status,
      operations: Object.freeze([...input.operations]),
      ...(input.installedVersion === undefined ? {} : { installedVersion: input.installedVersion }),
      automationMethod: input.automationMethod,
    });
  },
});
