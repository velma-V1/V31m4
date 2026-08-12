import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const TOKEN = "token-abcdefghijklmnop";

async function startHardeningRuntime(maxRequestBytes?: number): Promise<{
  runtime: RunningRuntime;
  base: string;
}> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-harden-")), "state.db");
  const config = createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
    ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
  });
  const runtime = await startRuntime(config);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra };
}

function command(base: string, extra: Record<string, string>, body: string): Promise<Response> {
  return fetch(`${base}/commands/project.create`, {
    method: "POST",
    headers: headers(extra),
    body,
  });
}

function project(name: string, requestId = `request:${name.toLowerCase().replaceAll(" ", "-")}`) {
  return JSON.stringify({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId,
    name,
    rootPath: name.toLowerCase().replaceAll(" ", "-"),
  });
}

async function latestSequence(base: string): Promise<number> {
  const health = await fetch(`${base}/health`);
  return ((await health.json()) as { latestSequence: number }).latestSequence;
}

describe("runtime hostile input", () => {
  it("rejects an oversized body without dropping the connection", async () => {
    const { runtime, base } = await startHardeningRuntime(32);
    try {
      const response = await command(
        base,
        { "idempotency-key": "c1" },
        project(`Project ${"x".repeat(256)}`),
      );
      expect(response.status).toBe(429);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "RESOURCE_EXHAUSTED",
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects non-JSON, non-finite numbers, and prototype-pollution payloads", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      const notJson = await command(base, { "idempotency-key": "c1" }, "definitely not json");
      expect(notJson.status).toBe(400);

      const infinite = await command(
        base,
        { "idempotency-key": "c2" },
        '{"schemaVersion":"1.0.0","requestId":"request:infinite","name":"Project","rootPath":"project","n":1e999}',
      );
      expect(infinite.status).toBe(400);

      const pollution = await command(
        base,
        { "idempotency-key": "c3" },
        '{"schemaVersion":"1.0.0","requestId":"request:pollution","name":"Project","rootPath":"project","__proto__":{"polluted":true}}',
      );
      expect(pollution.status).toBe(400);
      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects missing and malformed idempotency keys and unrecognized credentials", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      const missing = await fetch(`${base}/commands/project.create`, {
        method: "POST",
        headers: headers(),
        body: project("Project"),
      });
      expect(missing.status).toBe(400);

      const malformed = await command(
        base,
        { "idempotency-key": "not a canonical key" },
        project("Project"),
      );
      expect(malformed.status).toBe(400);

      const wrongToken = await fetch(`${base}/commands/project.create`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token-x", "idempotency-key": "c1" },
        body: "{}",
      });
      expect(wrongToken.status).toBe(403);
    } finally {
      await runtime.shutdown();
    }
  });
});

describe("runtime concurrency and recovery invariants", () => {
  it("collapses concurrent identical commands to a single durable effect", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      const body = project("Concurrent Project");
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => command(base, { "idempotency-key": "same-key" }, body)),
      );
      for (const response of responses) expect(response.status).toBe(200);
      const results = await Promise.all(
        responses.map((response) => response.json() as Promise<{ result: unknown }>),
      );
      const [first] = results;
      for (const result of results) expect(result).toEqual(first);
      // Exactly one event was committed despite six concurrent submissions.
      expect(await latestSequence(base)).toBe(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("resolves concurrent conflicting idempotency payloads to one commit", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      const responses = await Promise.all(
        [1, 2, 3].map((value) =>
          command(
            base,
            { "idempotency-key": "conflicting-key" },
            project(`Conflicting Project ${value}`, `request:conflict:${value}`),
          ),
        ),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(2);
      expect(await latestSequence(base)).toBe(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects malformed typed input with no partial record or stranded event", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      const rejected = await command(
        base,
        { "idempotency-key": "rejected" },
        JSON.stringify({ ...JSON.parse(project("Rejected Project")), unexpected: true }),
      );
      expect(rejected.status).toBe(400);
      expect(await latestSequence(base)).toBe(0);
      const count = runtime.composition.database.connection
        .prepare("SELECT COUNT(*) AS count FROM records WHERE record_type = 'project'")
        .get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  });
});
