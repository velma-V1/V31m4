import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CancellationSignal } from "@v31m4/application";
import { JsonRpcFramer, RpcProtocolError } from "./json-rpc-framer.js";

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly cleanup: () => void;
}

export class RpcRemoteError extends Error {
  override readonly name = "RpcRemoteError";

  constructor(
    readonly code: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class RpcTimeoutError extends Error {
  override readonly name = "RpcTimeoutError";
}

export class RpcCancelledError extends Error {
  override readonly name = "RpcCancelledError";
}

export class JsonRpcClient {
  readonly #pending = new Map<number, PendingCall>();
  readonly #framer: JsonRpcFramer;
  #nextId = 1;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    maxFrameBytes?: number,
  ) {
    this.#framer = new JsonRpcFramer(
      maxFrameBytes === undefined ? {} : { maxBytes: maxFrameBytes },
    );
    child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
    child.once("exit", () => this.#rejectAll(new Error("Adapter process exited")));
  }

  call(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: CancellationSignal,
  ): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new RpcCancelledError("RPC call cancelled"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.cleanup();
        this.#pending.delete(id);
        reject(new RpcCancelledError("RPC call cancelled"));
      };
      const cleanup = () => signal?.removeEventListener("abort", cancel);
      const timer = setTimeout(() => {
        cleanup();
        this.#pending.delete(id);
        reject(new RpcTimeoutError("RPC call timed out"));
      }, timeoutMs);
      signal?.addEventListener("abort", cancel, { once: true });
      this.#pending.set(id, { resolve, reject, timer, cleanup });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  #onData(chunk: Buffer): void {
    try {
      for (const message of this.#framer.push(chunk)) this.#onMessage(message);
    } catch (error) {
      this.#rejectAll(
        error instanceof Error ? error : new RpcProtocolError("RPC protocol failure"),
      );
      this.child.kill("SIGKILL");
    }
  }

  #onMessage(value: unknown): void {
    if (!value || typeof value !== "object") throw new RpcProtocolError("Invalid RPC response");
    const message = value as Record<string, unknown>;
    if (message["jsonrpc"] !== "2.0" || typeof message["id"] !== "number") {
      throw new RpcProtocolError("Invalid RPC response envelope");
    }
    const pending = this.#pending.get(message["id"]);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.cleanup();
    this.#pending.delete(message["id"]);
    if (message["error"] !== undefined) pending.reject(parseRemoteError(message["error"]));
    else pending.resolve(message["result"]);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function parseRemoteError(value: unknown): RpcRemoteError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcProtocolError("Invalid RPC error envelope");
  }
  const error = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(error["code"]) ||
    typeof error["message"] !== "string" ||
    error["message"].length === 0 ||
    error["message"].length > 1_024 ||
    typeof error["retryable"] !== "boolean"
  ) {
    throw new RpcProtocolError("Invalid RPC error envelope");
  }
  return new RpcRemoteError(error["code"] as number, error["message"], error["retryable"]);
}
