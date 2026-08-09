import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperationContext } from "@v31m4/application";
import { SqliteRuntimeDatabase } from "@v31m4/infrastructure";

export const context = createOperationContext({
  requestId: "request-1",
  idempotencyKey: "idem-1",
  actor: { id: "user-1", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-08T12:00:00.000Z",
});

export function runtimeDatabase(): SqliteRuntimeDatabase {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-runtime-")), "state.db"));
}
