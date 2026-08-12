import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonRpcFramer, RpcProtocolError } from "./json-rpc-framer.js";

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly cleanup: () => void;
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

  call(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error("RPC call cancelled"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.cleanup();
        this.#pending.delete(id);
        reject(new Error("RPC call cancelled"));
      };
      const cleanup = () => signal?.removeEventListener("abort", cancel);
      const timer = setTimeout(() => {
        cleanup();
        this.#pending.delete(id);
        reject(new Error("RPC call timed out"));
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
    if (message["error"] !== undefined) pending.reject(new Error("Adapter RPC error"));
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
