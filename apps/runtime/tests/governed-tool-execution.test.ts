import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolGatewayPort } from "@v31m4/application";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { ToolProfile } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-governed-tool-abcdefghijkl";
const TEST_TOOL_PROFILE = ToolProfile.create({
  toolId: "tool-general",
  adapterId: "adapter-general-tool",
  displayName: "General Tool",
  status: "available",
  operations: ["filesystem.read"],
  installedVersion: "1.0.0",
  automationMethod: "native_api",
});

function runtimeConfig(databasePath: string) {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
}

function testToolGateway(): ToolGatewayPort {
  return {
    async list() {
      return { items: [TEST_TOOL_PROFILE], total: 1 };
    },
    async get(toolId) {
      return toolId === TEST_TOOL_PROFILE.toolId ? TEST_TOOL_PROFILE : null;
    },
    async invoke() {
      throw new Error("Tool invocation is not part of this catalog test.");
    },
    async cancel() {},
    async health() {
      return {
        status: "healthy",
        checkedAt: "2026-08-25T00:00:00.000Z",
        details: { source: "test" },
      };
    },
  };
}

describe("governed tool execution", () => {
  it("exposes the provider-neutral general tool catalog through the authoritative runtime", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-tools-")), "state.db");
    const runtime = await startRuntime(runtimeConfig(databasePath));

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

  it("lists profiles from an injected provider-neutral tool gateway", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-tool-catalog-")), "state.db");
    const overrides = { toolGateway: testToolGateway() } as unknown as Parameters<
      typeof startRuntime
    >[1];
    const runtime = await startRuntime(runtimeConfig(databasePath), overrides);

    try {
      const response = await fetch(`http://127.0.0.1:${runtime.address.port}/queries/tool.list`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPERATOR_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          requestId: "request-injected-tool-list",
          pagination: { limit: 10 },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          tools: [TEST_TOOL_PROFILE],
          pagination: { total: 1 },
        },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("registers tool.invoke and rejects a nonexistent authoritative job before any effect", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-tool-invoke-")), "state.db");
    const runtime = await startRuntime(runtimeConfig(databasePath));

    try {
      const response = await fetch(
        `http://127.0.0.1:${runtime.address.port}/commands/tool.invoke`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${OPERATOR_TOKEN}`,
            "content-type": "application/json",
            "idempotency-key": "idem-tool-missing-job",
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            requestId: "request-tool-missing-job",
            jobId: "job-does-not-exist",
            toolId: "tool-general",
            operation: "filesystem.read",
            inputArtifactIds: [],
            parameters: { path: "README.md" },
            expectedOutputs: ["file.contents"],
          }),
        },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    } finally {
      await runtime.shutdown();
    }
  });
});
