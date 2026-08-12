import { ApplicationError, type CancellationSignal } from "@v31m4/application";
import type { JsonRpcClient } from "../rpc/json-rpc-client.js";
import { RpcRemoteError } from "../rpc/json-rpc-client.js";

export interface InvokeOptions {
  readonly timeoutMs: number;
  readonly signal?: CancellationSignal;
}

/**
 * Transport-agnostic handle to one supervised adapter. Production wiring backs this with
 * a JSON-RPC client over a supervised child process (Layer 8); gateways depend only on
 * this interface so provider transport never leaks into provider-neutral translation.
 */
export interface AdapterInvoker {
  readonly id: string;
  available(): boolean;
  invoke(method: string, params: unknown, options: InvokeOptions): Promise<unknown>;
}

/** Adapter binding: a primary invoker with an optional deterministic fallback. */
export interface AdapterBinding {
  readonly primary: AdapterInvoker;
  readonly fallback?: AdapterInvoker;
}

/** Chooses the primary invoker, or the fallback when the primary is unavailable. */
export function selectInvoker(binding: AdapterBinding, resourceId: string): AdapterInvoker {
  if (binding.primary.available()) return binding.primary;
  if (binding.fallback?.available() === true) return binding.fallback;
  throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "No available adapter for this resource.", {
    details: { resourceId },
    retryable: true,
  });
}

/** Runs an adapter call and classifies any transport/provider failure as a dependency failure. */
export async function invokeAdapter<Result>(
  invoker: AdapterInvoker,
  method: string,
  params: unknown,
  options: InvokeOptions,
): Promise<Result> {
  try {
    return (await invoker.invoke(method, params, options)) as Result;
  } catch (error) {
    throw new ApplicationError("DEPENDENCY_FAILURE", "The supervised adapter call failed.", {
      cause: error,
      details: { adapterId: invoker.id, method },
      retryable: error instanceof RpcRemoteError ? error.retryable : true,
    });
  }
}

/** Production invoker backed by a Layer 8 JSON-RPC client bound to a supervised adapter. */
export class JsonRpcAdapterInvoker implements AdapterInvoker {
  constructor(
    readonly id: string,
    private readonly client: JsonRpcClient,
    private readonly isAvailable: () => boolean,
  ) {}

  available(): boolean {
    return this.isAvailable();
  }

  invoke(method: string, params: unknown, options: InvokeOptions): Promise<unknown> {
    return this.client.call(method, params, options.timeoutMs, options.signal);
  }
}
