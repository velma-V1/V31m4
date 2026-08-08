import {
  ApplicationError,
  type OperationContext,
  type PortHealth,
  type PortPage,
  type PortPageRequest,
  type ToolGatewayPort,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from "@v31m4/application";
import type { ToolId, ToolProfile } from "@v31m4/domain";
import { type AdapterBinding, invokeAdapter, selectInvoker } from "./adapter-invoker.js";
import { remainingTimeout } from "./supervised-model-gateway.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Provider-neutral tool gateway over supervised adapters. Tool writes run through the
 * adapter's isolated workspace; the gateway performs only provider-neutral translation,
 * fallback selection, and dependency-failure classification.
 */
export class SupervisedToolGateway implements ToolGatewayPort {
  readonly #profiles: readonly ToolProfile[];
  readonly #bindings: ReadonlyMap<string, AdapterBinding>;

  constructor(
    profiles: readonly ToolProfile[],
    bindings: ReadonlyMap<string, AdapterBinding>,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.#profiles = Object.freeze([...profiles]);
    this.#bindings = bindings;
  }

  async list(request: PortPageRequest): Promise<PortPage<ToolProfile>> {
    const start = request.cursor === undefined ? 0 : Number.parseInt(request.cursor, 10);
    const items = this.#profiles.slice(start, start + request.limit);
    const next = start + request.limit;
    return Object.freeze({
      items,
      total: this.#profiles.length,
      ...(next < this.#profiles.length ? { nextCursor: String(next) } : {}),
    });
  }

  async get(toolId: ToolId): Promise<ToolProfile | null> {
    return this.#profiles.find((profile) => profile.toolId === toolId) ?? null;
  }

  async invoke(
    request: ToolInvocationRequest,
    context: OperationContext,
  ): Promise<ToolInvocationResult> {
    const binding = this.#bindings.get(request.toolId);
    if (binding === undefined) {
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "No adapter is bound to this tool.", {
        details: { toolId: request.toolId },
        retryable: true,
      });
    }
    const invoker = selectInvoker(binding, request.toolId);
    return invokeAdapter<ToolInvocationResult>(invoker, "tool.invoke", request, {
      timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
    });
  }

  async cancel(invocationId: string, context: OperationContext): Promise<void> {
    for (const binding of this.#bindings.values()) {
      if (binding.primary.available()) {
        await binding.primary.invoke(
          "tool.cancel",
          { invocationId },
          {
            timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
          },
        );
      }
    }
  }

  async health(toolId: ToolId): Promise<PortHealth> {
    const binding = this.#bindings.get(toolId);
    const available =
      binding !== undefined &&
      (binding.primary.available() || binding.fallback?.available() === true);
    return Object.freeze({
      status: available ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      details: { toolId },
    });
  }
}
