import {
  ApplicationError,
  type ModelGatewayPort,
  type ModelInvocationRequest,
  type ModelInvocationResult,
  type OperationContext,
  type PortHealth,
  type PortPage,
  type PortPageRequest,
} from "@v31m4/application";
import type { ModelId, ModelProfile } from "@v31m4/domain";
import { parsePaginationCursor } from "../pagination-cursor.js";
import { type AdapterBinding, invokeAdapter, selectInvoker } from "./adapter-invoker.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Provider-neutral model gateway over supervised adapters. Each model id binds to a
 * primary adapter and an optional fallback; an invocation is translated to a
 * `model.invoke` adapter call, the result is returned as-is, and any transport failure is
 * classified as a retryable dependency failure. A model with no available adapter is a
 * dependency-unavailable outcome, never a silent success.
 */
export class SupervisedModelGateway implements ModelGatewayPort {
  readonly #profiles: readonly ModelProfile[];
  readonly #bindings: ReadonlyMap<string, AdapterBinding>;

  constructor(
    profiles: readonly ModelProfile[],
    bindings: ReadonlyMap<string, AdapterBinding>,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.#profiles = Object.freeze([...profiles]);
    this.#bindings = bindings;
  }

  async list(request: PortPageRequest): Promise<PortPage<ModelProfile>> {
    const start = parsePaginationCursor(request.cursor);
    const items = this.#profiles.slice(start, start + request.limit);
    const next = start + request.limit;
    return Object.freeze({
      items,
      total: this.#profiles.length,
      ...(next < this.#profiles.length ? { nextCursor: String(next) } : {}),
    });
  }

  async get(modelId: ModelId): Promise<ModelProfile | null> {
    return this.#profiles.find((profile) => profile.modelId === modelId) ?? null;
  }

  async invoke(
    request: ModelInvocationRequest,
    context: OperationContext,
  ): Promise<ModelInvocationResult> {
    const binding = this.#bindings.get(request.modelId);
    if (binding === undefined) {
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "No adapter is bound to this model.", {
        details: { modelId: request.modelId },
        retryable: true,
      });
    }
    const invoker = selectInvoker(binding, request.modelId);
    const { metadata: _metadata, ...adapterRequest } = request;
    return invokeAdapter<ModelInvocationResult>(invoker, "model.invoke", adapterRequest, {
      timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
      signal: context.signal,
    });
  }

  async cancel(invocationId: string, context: OperationContext): Promise<void> {
    for (const binding of this.#bindings.values()) {
      if (binding.primary.available()) {
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

  async health(modelId: ModelId): Promise<PortHealth> {
    const binding = this.#bindings.get(modelId);
    const available = binding !== undefined && selectableAvailable(binding);
    return Object.freeze({
      status: available ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      details: { modelId },
    });
  }
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
