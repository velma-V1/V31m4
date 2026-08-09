import type { Server } from "node:http";
import { createRuntimeServer } from "./api/server.js";
import { buildComposition, type RuntimeComposition } from "./composition-root.js";
import type { RuntimeConfig } from "./runtime-config.js";
import { gracefulShutdown } from "./shutdown.js";

export interface RunningRuntime {
  readonly server: Server;
  readonly composition: RuntimeComposition;
  readonly address: { readonly host: string; readonly port: number };
  readonly startup: { readonly latestSequence: number };
  shutdown(): Promise<void>;
}

/**
 * Boots the runtime: assembles the composition, runs startup recovery over the durable log, binds
 * the HTTP surface, and returns a handle whose {@link RunningRuntime.shutdown} performs a
 * checkpoint-safe teardown.
 */
export async function startRuntime(config: RuntimeConfig): Promise<RunningRuntime> {
  const composition = buildComposition(config);
  const startup = composition.recoverOnStartup();
  const server = createRuntimeServer(composition);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  const bound = server.address();
  const port = typeof bound === "object" && bound !== null ? bound.port : config.port;
  return {
    server,
    composition,
    address: { host: config.host, port },
    startup,
    shutdown: () => gracefulShutdown(server, composition, { timeoutMs: config.shutdownTimeoutMs }),
  };
}
