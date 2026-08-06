import type { ArtifactId, JobId, ResourceBudget, ToolId, ToolProfile } from "@v31m4/domain";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { PortHealth, PortPage, PortPageRequest } from "../port-types.js";

export interface ToolInvocationRequest {
  readonly invocationId: string;
  readonly jobId: JobId;
  readonly toolId: ToolId;
  readonly operation: string;
  readonly inputArtifactIds: readonly ArtifactId[];
  readonly parameters: ApplicationJsonObject;
  readonly expectedOutputs: readonly string[];
  readonly resourceBudget: ResourceBudget;
}

export interface ToolInvocationResult {
  readonly invocationId: string;
  readonly toolId: ToolId;
  readonly status: "completed" | "cancelled" | "failed";
  readonly outputArtifactIds: readonly ArtifactId[];
  readonly logArtifactIds: readonly ArtifactId[];
  readonly exitCode?: number;
  readonly metadata: ApplicationJsonObject;
}

export interface ToolGatewayPort {
  list(request: PortPageRequest, context: OperationContext): Promise<PortPage<ToolProfile>>;
  get(toolId: ToolId, context: OperationContext): Promise<ToolProfile | null>;
  invoke(request: ToolInvocationRequest, context: OperationContext): Promise<ToolInvocationResult>;
  cancel(invocationId: string, context: OperationContext): Promise<void>;
  health(toolId: ToolId, context: OperationContext): Promise<PortHealth>;
}
