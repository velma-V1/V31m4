import {
  type AgentModelGatewayPort,
  type AgentTurnInvocationRequest,
  type AgentTurnInvocationResult,
  ApplicationError,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type OperationContext,
  type PortHealth,
  type PortPage,
  type PortPageRequest,
} from "@v31m4/application";
import { type ModelId, ModelProfile } from "@v31m4/domain";
import { parsePaginationCursor } from "../pagination-cursor.js";
import { type AdapterBinding, invokeAdapter, selectInvoker } from "./adapter-invoker.js";
import { parseAgentTurnResult } from "./agent-turn-result.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Provider-neutral model gateway over supervised adapters. Each model id binds to a
 * primary adapter and an optional fallback; an invocation is translated to a
 * `model.invoke` adapter call, the result is returned as-is, and any transport failure is
 * classified as a retryable dependency failure. A model with no available adapter is a
 * dependency-unavailable outcome, never a silent success.
 *
 * Adapters that negotiate protocol 1.1 additionally speak the structured agent-turn contract, so
 * this gateway implements `AgentModelGatewayPort`. Legacy `invoke` is untouched: the agent path is
 * a distinct adapter method, and an adapter that does not implement it fails as a dependency
 * rather than silently degrading into the legacy path.
 */
export class SupervisedModelGateway implements AgentModelGatewayPort {
  readonly #profiles = new Map<string, ModelProfile>();
  readonly #bindings: ReadonlyMap<string, AdapterBinding>;
  #discoveryLoaded = false;

  constructor(
    profiles: readonly ModelProfile[],
    bindings: ReadonlyMap<string, AdapterBinding>,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly discoveryBinding?: AdapterBinding,
  ) {
    for (const profile of profiles) this.#profiles.set(profile.modelId, profile);
    this.#bindings = bindings;
  }

  async list(
    request: PortPageRequest,
    context?: OperationContext,
  ): Promise<PortPage<ModelProfile>> {
    await this.#ensureDiscovery(context);
    const start = parsePaginationCursor(request.cursor);
    const profiles = [...this.#profiles.values()].sort((left, right) =>
      left.modelId.localeCompare(right.modelId),
    );
    const items = profiles.slice(start, start + request.limit);
    const next = start + request.limit;
    return Object.freeze({
      items,
      total: profiles.length,
      ...(next < profiles.length ? { nextCursor: String(next) } : {}),
    });
  }

  async get(modelId: ModelId, context?: OperationContext): Promise<ModelProfile | null> {
    await this.#ensureDiscovery(context);
    return this.#profiles.get(modelId) ?? null;
  }

  async invoke(
    request: ModelInvocationRequest,
    context: OperationContext,
  ): Promise<ModelInvocationResult> {
    await this.#ensureDiscovery(context);
    const binding = this.#bindingFor(request.modelId);
    const invoker = selectInvoker(binding, request.modelId);
    const { metadata: _metadata, ...adapterRequest } = request;
    return invokeAdapter<ModelInvocationResult>(invoker, "model.invoke", adapterRequest, {
      timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
      signal: context.signal,
    });
  }

  /**
   * One provider-neutral agent turn.
   *
   * The gateway translates and validates; it decides nothing. Reasoning policy travels as intent
   * and is translated by the adapter, the context budget travels explicitly rather than being
   * compiled into a provider, and the answer is checked against the request that produced it
   * before it is handed back. What comes out is still an untrusted proposal the runtime
   * revalidates.
   */
  async invokeAgentTurn(
    request: AgentTurnInvocationRequest,
    context: OperationContext,
  ): Promise<AgentTurnInvocationResult> {
    await this.#ensureDiscovery(context);
    const binding = this.#bindingFor(request.modelId);
    const invoker = selectInvoker(binding, request.modelId);
    const { metadata: _metadata, ...adapterRequest } = request;
    const raw = await invokeAdapter<unknown>(invoker, "model.invoke_agent", adapterRequest, {
      timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
      signal: context.signal,
    });
    return parseAgentTurnResult(raw, request);
  }

  async cancel(invocationId: string, context: OperationContext): Promise<void> {
    const bindings = [...this.#bindings.values()];
    if (this.discoveryBinding !== undefined) bindings.push(this.discoveryBinding);
    const invoked = new Set<string>();
    for (const binding of bindings) {
      if (binding.primary.available()) {
        if (invoked.has(binding.primary.id)) continue;
        invoked.add(binding.primary.id);
        await binding.primary.invoke(
          "adapter.cancel",
          { invocationId },
          {
            timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
          },
        );
      }
    }
  }

  async health(modelId: ModelId, context?: OperationContext): Promise<PortHealth> {
    await this.#ensureDiscovery(context);
    const binding =
      this.#bindings.get(modelId) ??
      (this.#profiles.has(modelId) ? this.discoveryBinding : undefined);
    const available = binding !== undefined && selectableAvailable(binding);
    return Object.freeze({
      status: available ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      details: { modelId },
    });
  }

  #bindingFor(modelId: ModelId): AdapterBinding {
    const binding =
      this.#bindings.get(modelId) ??
      (this.#profiles.has(modelId) ? this.discoveryBinding : undefined);
    if (binding === undefined) {
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "No adapter is bound to this model.", {
        details: { modelId },
        retryable: true,
      });
    }
    return binding;
  }

  async #ensureDiscovery(context: OperationContext | undefined): Promise<void> {
    if (this.#discoveryLoaded || this.discoveryBinding === undefined) return;
    const invoker = selectInvoker(this.discoveryBinding, "model-discovery");
    const response = await invokeAdapter<unknown>(
      invoker,
      "model.list",
      {},
      {
        timeoutMs:
          context === undefined
            ? this.defaultTimeoutMs
            : remainingTimeout(context, this.defaultTimeoutMs),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
      },
    );
    const discovered = parseDiscoveredProfiles(response, invoker.id);
    for (const profile of discovered) this.#profiles.set(profile.modelId, profile);
    this.#discoveryLoaded = true;
  }
}

function parseDiscoveredProfiles(value: unknown, adapterId: string): readonly ModelProfile[] {
  if (
    !isExactRecord(value, ["models"]) ||
    !Array.isArray(value["models"]) ||
    value["models"].length > 500
  ) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Model discovery returned an invalid response.",
    );
  }
  const profiles = value["models"].map((candidate) => parseDiscoveredProfile(candidate, adapterId));
  if (new Set(profiles.map((profile) => profile.modelId)).size !== profiles.length) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Model discovery returned duplicate model IDs.",
    );
  }
  return Object.freeze(profiles);
}

function parseDiscoveredProfile(value: unknown, adapterId: string): ModelProfile {
  const keys = [
    "modelId",
    "adapterId",
    "displayName",
    "status",
    "local",
    "measuredCapabilities",
    "supportedModalities",
  ];
  if (
    !isExactRecord(value, keys, ["contextLimit"]) ||
    typeof value["modelId"] !== "string" ||
    value["adapterId"] !== adapterId ||
    typeof value["displayName"] !== "string" ||
    !isAvailability(value["status"]) ||
    typeof value["local"] !== "boolean" ||
    (value["contextLimit"] !== undefined && typeof value["contextLimit"] !== "number") ||
    !Array.isArray(value["measuredCapabilities"]) ||
    value["measuredCapabilities"].length !== 0 ||
    !Array.isArray(value["supportedModalities"]) ||
    !value["supportedModalities"].every((modality) => typeof modality === "string")
  ) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Model discovery returned an invalid profile.",
    );
  }
  try {
    return ModelProfile.create({
      modelId: value["modelId"],
      adapterId: value["adapterId"],
      displayName: value["displayName"],
      status: value["status"],
      local: value["local"],
      ...(value["contextLimit"] === undefined ? {} : { contextLimit: value["contextLimit"] }),
      measuredCapabilities: [],
      supportedModalities: value["supportedModalities"],
    });
  } catch (error) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Model discovery returned an invalid profile.",
      {
        cause: error,
      },
    );
  }
}

function isExactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const permitted = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => keys.includes(key)) && keys.every((key) => permitted.has(key));
}

function isAvailability(value: unknown): value is ModelProfile["status"] {
  return value === "available" || value === "degraded" || value === "unavailable";
}

export function remainingTimeout(
  context: OperationContext,
  fallbackMs: number,
  nowMs = Date.now(),
): number {
  if (context.deadlineAt === undefined) return fallbackMs;
  const remaining = Date.parse(context.deadlineAt) - nowMs;
  return Math.max(1, Math.min(fallbackMs, remaining));
}

function selectableAvailable(binding: AdapterBinding): boolean {
  return binding.primary.available() || binding.fallback?.available() === true;
}
