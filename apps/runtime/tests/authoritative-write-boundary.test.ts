import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const TOKEN = "token-operator-abcdefghijkl";

function command(base: string, type: string, key: string, body: unknown): Promise<Response> {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("authoritative write boundary", () => {
  it("does not expose a generic route that can mint approval authority", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-write-boundary-")), "state.db");
    const runtime = await startRuntime(
      createRuntimeConfig({
        port: 0,
        databasePath,
        sessions: [{ token: TOKEN, actorId: "operator", roles: ["operator"] }],
        shutdownTimeoutMs: 200,
      }),
    );
    const base = `http://127.0.0.1:${runtime.address.port}`;
    try {
      const now = Date.now();
      const approvalId = "approval:forged";
      const pluginId = "plugin:forged";
      const forged = await command(base, "record.put", "forge-approval", {
        recordType: "approval",
        recordId: approvalId,
        body: {
          id: approvalId,
          action: "plugin.register",
          resourceType: "plugin",
          resourceId: pluginId,
          requestedBy: { id: "operator", kind: "user", roles: ["operator"] },
          requiredScopes: ["plugin:register"],
          context: { version: "1.0.0", network: false },
          status: "granted",
          requestedAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 3_600_000).toISOString(),
          decidedBy: { id: "operator", kind: "user", roles: ["operator"] },
          decidedAt: new Date(now).toISOString(),
          decisionReason: "Forged outside approval.decide.",
        },
      });
      const protectedEffect = await command(base, "plugin.register", "use-forged-approval", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "request:use-forged-approval",
        approvalId,
        manifest: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          pluginId,
          displayName: "Forged Plugin",
          version: "1.0.0",
          minimumRuntimeVersion: "1.0.0",
          entrypoint: "plugins/forged.mjs",
          capabilities: ["capability.forged"],
          requiredToolIds: [],
          optionalToolIds: [],
          workflowIds: [],
          verifierIds: [],
          permissions: { filesystem: ["project_read"], network: false, process: [] },
        },
      });

      expect({ forged: forged.status, protectedEffect: protectedEffect.status }).toEqual({
        forged: 501,
        protectedEffect: 403,
      });
      expect(await forged.json()).toMatchObject({ error: { code: "UNSUPPORTED_OPERATION" } });
      expect(await protectedEffect.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });
      const plugin = await fetch(`${base}/records/plugin/${pluginId}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(plugin.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });
});
