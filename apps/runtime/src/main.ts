import { fileURLToPath } from "node:url";
import { startRuntime } from "./bootstrap.js";
import { loadRuntimeConfig } from "./runtime-config.js";

/** Process entrypoint: load configuration from the environment, start the runtime, and install signal-driven shutdown. */
export async function main(): Promise<void> {
  const config = loadRuntimeConfig(process.env);
  const runtime = await startRuntime(config);
  process.stderr.write(
    `v31m4 runtime listening on http://${runtime.address.host}:${runtime.address.port} ` +
      `(durable log head: ${runtime.startup.latestSequence})\n`,
  );
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void runtime.shutdown().finally(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
