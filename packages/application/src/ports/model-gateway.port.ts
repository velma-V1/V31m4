import type {
  ArtifactId,
  JobId,
  ModelId,
  ModelProfile,
  ResourceBudget,
  SolverConfiguration,
} from "@v31m4/domain";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { PortHealth, PortPage, PortPageRequest } from "../port-types.js";

export interface ModelInvocationRequest {
  readonly invocationId: string;
  readonly jobId: JobId;
  readonly modelId: ModelId;
  readonly promptArtifactId: ArtifactId;
  readonly configuration: SolverConfiguration;
  readonly resourceBudget: ResourceBudget;
  readonly metadata: ApplicationJsonObject;
}

export interface ModelInvocationUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly wallClockMs: number;
}

export interface ModelInvocationResult {
  readonly invocationId: string;
  readonly modelId: ModelId;
  readonly responseArtifactId: ArtifactId;
  readonly outputArtifactIds: readonly ArtifactId[];
  readonly finishReason: "completed" | "length" | "cancelled" | "failed";
  readonly usage: ModelInvocationUsage;
  readonly metadata: ApplicationJsonObject;
}

export interface ModelGatewayPort {
  list(request: PortPageRequest, context: OperationContext): Promise<PortPage<ModelProfile>>;
  get(modelId: ModelId, context: OperationContext): Promise<ModelProfile | null>;
  invoke(
    request: ModelInvocationRequest,
    context: OperationContext,
  ): Promise<ModelInvocationResult>;
  cancel(invocationId: string, context: OperationContext): Promise<void>;
  health(modelId: ModelId, context: OperationContext): Promise<PortHealth>;
}
