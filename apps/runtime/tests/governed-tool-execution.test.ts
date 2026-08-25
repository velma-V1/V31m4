import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-governed-tool-abcdefghijkl";

describe("governed tool execution", () => {
  it("exposes the provider-neutral general tool catalog through the authoritative runtime", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-tools-")), "state.db");
    const runtime = await startRuntime(
      createRuntimeConfig({
        port: 0,
        databasePath,
        sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
        shutdownTimeoutMs: 200,
      }),
    );

    try {
      const response = await fetch(`http://127.0.0.1:${runtime.address.port}/queries/tool.list`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPERATOR_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          requestId: "request-tool-list",
          pagination: { limit: 10 },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          tools: [],
          pagination: { total: 0 },
        },
      });
    } finally {
      await runtime.shutdown();
    }
  });
});
