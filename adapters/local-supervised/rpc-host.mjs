const MAX_LINE_BYTES = 256 * 1024;

function rpcError(id, code, message, retryable = false) {
  return { jsonrpc: "2.0", id, error: { code, message, retryable } };
}

function write(message) {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded) > MAX_LINE_BYTES) {
    process.stdout.write(
      `${JSON.stringify(rpcError(message.id ?? null, -32001, "Adapter response exceeds limit."))}\n`,
    );
    return;
  }
  process.stdout.write(`${encoded}\n`);
}

function parseRequest(line) {
  const value = JSON.parse(line);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.jsonrpc !== "2.0" ||
    !Number.isSafeInteger(value.id) ||
    value.id < 0 ||
    typeof value.method !== "string" ||
    value.params === null ||
    typeof value.params !== "object" ||
    Array.isArray(value.params)
  ) {
    throw new Error("Invalid JSON-RPC request envelope.");
  }
  return value;
}

export function runRpcHost(handlers) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      write(rpcError(null, -32700, "Adapter request exceeds limit."));
      process.exitCode = 1;
      process.stdin.destroy();
      return;
    }
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let request;
      try {
        request = parseRequest(line);
      } catch {
        write(rpcError(null, -32600, "Invalid JSON-RPC request."));
        continue;
      }
      const handler = handlers[request.method];
      if (typeof handler !== "function") {
        write(rpcError(request.id, -32601, "Adapter method is not supported."));
        continue;
      }
      Promise.resolve(handler(request.params))
        .then((result) => write({ jsonrpc: "2.0", id: request.id, result }))
        .catch((error) => {
          const message =
            error instanceof Error && error.message.length > 0
              ? error.message.slice(0, 240)
              : "Adapter operation failed.";
          write(rpcError(request.id, -32000, message, error?.retryable === true));
        });
    }
  });
}

export function requireCanonicalId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
