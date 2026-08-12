import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AdapterInvoker, InvokeOptions } from "../gateways/adapter-invoker.js";
import {
  ProcessSupervisor,
  type SupervisedProcessOptions,
} from "../processes/process-supervisor.js";
import { JsonRpcClient, RpcCancelledError, RpcTimeoutError } from "../rpc/json-rpc-client.js";

export interface SupervisedAdapterProcessOptions {
  readonly id: string;
  readonly process: SupervisedProcessOptions;
  readonly maxFrameBytes?: number;
}

/** Lazy, restartable JSON-RPC adapter binding owned by the existing process supervisor. */
export class SupervisedAdapterProcess implements AdapterInvoker {
  readonly id: string;
  readonly #supervisor: ProcessSupervisor;
  readonly #maxFrameBytes: number | undefined;
  #client: JsonRpcClient | undefined;
  #starting: Promise<JsonRpcClient> | undefined;
  #closed = false;

  constructor(options: SupervisedAdapterProcessOptions) {
    this.id = options.id;
    this.#supervisor = new ProcessSupervisor(options.process);
    this.#maxFrameBytes = options.maxFrameBytes;
  }

  get running(): boolean {
    return this.#supervisor.process !== undefined;
  }

  available(): boolean {
    return !this.#closed;
  }

  async invoke(method: string, params: unknown, options: InvokeOptions): Promise<unknown> {
    if (this.#closed) throw new Error("Adapter process is stopped");
    const client = await this.#ensureClient();
    try {
      return await client.call(method, params, options.timeoutMs, options.signal);
    } catch (error) {
      if (error instanceof RpcTimeoutError || error instanceof RpcCancelledError) {
        this.#client = undefined;
        await this.#supervisor.stop("SIGKILL");
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#client = undefined;
    await this.#supervisor.stop();
  }

  async #ensureClient(): Promise<JsonRpcClient> {
    if (this.#client !== undefined && this.#supervisor.process !== undefined) return this.#client;
    if (this.#starting !== undefined) return this.#starting;
    this.#starting = this.#startClient();
    try {
      return await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async #startClient(): Promise<JsonRpcClient> {
    const child = await this.#supervisor.start();
    const client = new JsonRpcClient(child, this.#maxFrameBytes);
    this.#client = client;
    child.once("exit", () => this.#releaseClient(child));
    return client;
  }

  #releaseClient(child: ChildProcessWithoutNullStreams): void {
    if (this.#supervisor.process === child) return;
    this.#client = undefined;
  }
}
