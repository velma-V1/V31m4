export class RpcProtocolError extends Error {}

export interface RpcFrameOptions {
  readonly maxBytes?: number;
}

export class JsonRpcFramer {
  readonly #maxBytes: number;
  #buffer = Buffer.alloc(0);

  constructor(options: RpcFrameOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 1024 * 1024;
  }

  push(chunk: Buffer): readonly unknown[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > this.#maxBytes) throw new RpcProtocolError("RPC frame exceeds limit");
    const messages: unknown[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf(10);
      if (newline < 0) break;
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line.length === 0) continue;
      try {
        messages.push(JSON.parse(line.toString("utf8")) as unknown);
      } catch {
        throw new RpcProtocolError("Malformed JSON-RPC frame");
      }
    }
    return messages;
  }
}
