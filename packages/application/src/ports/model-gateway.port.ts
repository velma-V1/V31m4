import type {
  ArtifactId,
  JobId,
  ModelId,
  ModelProfile,
  ResourceBudget,
  SolverConfiguration,
  TaskId,
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

/**
 * Provider-neutral reasoning policy for a structured agent invocation.
 *
 * The runtime states intent — `disabled`, `enabled`, or `auto` — and the adapter translates it
 * into whatever its provider actually implements. No V31M4 invariant may depend on one vendor's
 * reasoning semantics, and whatever a runtime produces while reasoning is ephemeral: it is never
 * requested back, never returned across this port, and never persisted.
 */
export type AgentReasoningPolicy = "disabled" | "enabled" | "auto";

/**
 * The explicit budget one agent invocation runs under. Both limits fail closed: a context that
 * exceeds either is refused, never truncated, because a silently shortened context changes the
 * task the model was actually given.
 */
export interface AgentContextBudget {
  readonly maxPromptBytes: number;
  readonly maxPromptTokens: number;
}

/**
 * One structured agent turn, as proposed by a model.
 *
 * Bounded actionable output and nothing else. There is no chain-of-thought field, and `finish`
 * declares the bounded task ready for independent verification rather than claiming success — a
 * model never certifies its own work.
 *
 * This is an untrusted proposal. The runtime revalidates it and decides whether anything happens.
 */
export type AgentTurnProposal =
  | Readonly<{
      kind: "tool_call";
      operation: string;
      parameters: ApplicationJsonObject;
    }>
  | Readonly<{ kind: "finish"; summary: string }>
  | Readonly<{ kind: "defer"; reason: string }>;

export interface AgentTurnInvocationRequest {
  readonly invocationId: string;
  readonly jobId: JobId;
  /** The one bounded task this turn belongs to. */
  readonly taskId: TaskId;
  readonly modelId: ModelId;
  readonly promptArtifactId: ArtifactId;
  /** The agent-turn output contract the runtime will parse the answer against. */
  readonly outputContractVersion: string;
  /** The role manifest. An adapter may offer the model nothing outside this set. */
  readonly allowedOperations: readonly string[];
  readonly reasoningPolicy: AgentReasoningPolicy;
  readonly contextBudget: AgentContextBudget;
  readonly resourceBudget: ResourceBudget;
  readonly metadata: ApplicationJsonObject;
}

export interface AgentTurnInvocationResult {
  readonly invocationId: string;
  readonly modelId: ModelId;
  readonly outputContractVersion: string;
  readonly turn: AgentTurnProposal;
  readonly usage: ModelInvocationUsage;
  readonly metadata: ApplicationJsonObject;
}

/**
 * A model gateway that additionally speaks the structured agent-turn contract.
 *
 * Deliberately a separate capability rather than a new required member on `ModelGatewayPort`:
 * every existing gateway, reference implementation, and mock stays valid and keeps its legacy
 * `invoke`, and a gateway bound to an adapter that does not negotiate protocol 1.1 simply does not
 * offer this. Callers narrow with `supportsAgentTurns` and fail closed when it is absent, instead
 * of discovering at runtime that an optional method was never implemented.
 */
export interface AgentModelGatewayPort extends ModelGatewayPort {
  invokeAgentTurn(
    request: AgentTurnInvocationRequest,
    context: OperationContext,
  ): Promise<AgentTurnInvocationResult>;
}

export function supportsAgentTurns(gateway: ModelGatewayPort): gateway is AgentModelGatewayPort {
  return typeof (gateway as Partial<AgentModelGatewayPort>).invokeAgentTurn === "function";
}
