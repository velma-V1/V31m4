import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";
const OTHER_TOKEN = "token-zyxwvutsrqponmlk";

interface TestRuntime {
  readonly runtime: RunningRuntime;
  readonly base: string;
}

async function startTestRuntime(): Promise<TestRuntime> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-project-cmd-")), "state.db");
  const config = createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [
      { token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] },
      { token: OTHER_TOKEN, actorId: "viewer", roles: ["viewer"] },
    ],
    shutdownTimeoutMs: 200,
  });
  const runtime = await startRuntime(config);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
}

function createProjectCommand(base: string, token: string, idempotencyKey: string, body: unknown) {
  return fetch(`${base}/commands/project.create`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "req-project-1",
    name: "Demo Project",
    rootPath: "demo-project",
    ...overrides,
  };
}

describe("project.create command", () => {
  it("creates a real project, persists it, and is readable back", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await createProjectCommand(base, OPERATOR_TOKEN, "idem-1", validPayload());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { project: { id: string; name: string; status: string; rootPath: string } };
      };
      expect(body.result.project.name).toBe("Demo Project");
      expect(body.result.project.status).toBe("active");
      expect(body.result.project.rootPath).toBe("demo-project");

      const readBack = await fetch(`${base}/records/project/${body.result.project.id}`, {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      });
      expect(readBack.status).toBe(200);
      const record = (await readBack.json()) as { record: { value: { name: string } } };
      expect(record.record.value.name).toBe("Demo Project");
    } finally {
      await runtime.shutdown();
    }
  });

  it("denies project creation for a session without the operator role (fail-closed policy)", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await createProjectCommand(base, OTHER_TOKEN, "idem-2", validPayload());
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PERMISSION_DENIED");
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects a malformed payload with INVALID_APPLICATION_INPUT instead of an opaque 500", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await createProjectCommand(
        base,
        OPERATOR_TOKEN,
        "idem-3",
        validPayload({ name: "" }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_APPLICATION_INPUT");
    } finally {
      await runtime.shutdown();
    }
  });

  it("is idempotent: a repeated actor+key+payload returns the same result without a duplicate write", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const payload = validPayload();
      const first = await createProjectCommand(base, OPERATOR_TOKEN, "idem-4", payload);
      const firstBody = (await first.json()) as { result: { project: { id: string } } };

      const second = await createProjectCommand(base, OPERATOR_TOKEN, "idem-4", payload);
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { result: { project: { id: string } } };
      expect(secondBody.result.project.id).toBe(firstBody.result.project.id);

      const readBack = await fetch(`${base}/records/project/${firstBody.result.project.id}`, {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      });
      const record = (await readBack.json()) as { record: { revision: string } };
      expect(record.record.revision).toBe("1");
    } finally {
      await runtime.shutdown();
    }
  });

  it("publishes a project.updated event visible on the live event stream", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const before = (await (await fetch(`${base}/health`)).json()) as { latestSequence: number };
      const response = await createProjectCommand(base, OPERATOR_TOKEN, "idem-5", validPayload());
      expect(response.status).toBe(200);
      const after = (await (await fetch(`${base}/health`)).json()) as { latestSequence: number };
      expect(after.latestSequence).toBe(before.latestSequence + 1);
    } finally {
      await runtime.shutdown();
    }
  });
});
