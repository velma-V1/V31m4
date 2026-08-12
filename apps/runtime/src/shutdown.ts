import type { Server } from "node:http";
import type { RuntimeComposition } from "./composition-root.js";

export interface ShutdownOptions {
  readonly timeoutMs: number;
}

/**
 * Checkpoint-safe shutdown. New connections are refused and in-flight requests are given a bounded
 * grace period before remaining sockets are force-closed; event subscriptions are released; then the
 * WAL is checkpointed into the main database before the connection closes, so no committed write is
 * left stranded in the write-ahead log for the next startup to reconcile.
 */
export async function gracefulShutdown(
  server: Server,
  composition: RuntimeComposition,
  options: ShutdownOptions,
): Promise<void> {
  composition.coordinator.closeAll();
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, options.timeoutMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      finish();
    });
  });
  try {
    composition.database.connection.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // A checkpoint failure must not prevent an orderly close; the WAL is replayed on next open.
  }
  await composition.close();
}
