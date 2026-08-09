import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  return fetch(`${base}/commands/record.put`, {
    method: "POST",
    headers: headers(extra),
    body,
  });
}

async function pendingEvents(base: string): Promise<number> {
  const health = await fetch(`${base}/health`);
  return ((await health.json()) as { pendingEvents: number }).pendingEvents;
}

describe("runtime hostile input", () => {
  it("rejects an oversized body without dropping the connection", async () => {
    const { runtime, base } = await startHardeningRuntime(32);
    try {
      const response = await command(
        base,
        { "idempotency-key": "c1" },
        JSON.stringify({ recordType: "project", recordId: "p1", body: { blob: "x".repeat(256) } }),
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
        '{"recordType":"project","recordId":"p1","body":{"n":1e999}}',
      );
      expect(infinite.status).toBe(400);

      const pollution = await command(
        base,
        { "idempotency-key": "c3" },
        '{"recordType":"project","recordId":"p1","body":{"__proto__":{"polluted":true}}}',
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
      const missing = await fetch(`${base}/commands/record.put`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ recordType: "project", recordId: "p1", body: {} }),
      });
      expect(missing.status).toBe(400);

      const malformed = await command(
        base,
        { "idempotency-key": "not a canonical key" },
        JSON.stringify({ recordType: "project", recordId: "p1", body: {} }),
      );
      expect(malformed.status).toBe(400);

      const wrongToken = await fetch(`${base}/commands/record.put`, {
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
      const body = JSON.stringify({ recordType: "project", recordId: "p1", body: { name: "x" } });
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
      expect(await pendingEvents(base)).toBe(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("resolves concurrent conflicting writers to one commit and version conflicts", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      await command(
        base,
        { "idempotency-key": "create" },
        JSON.stringify({ recordType: "project", recordId: "p1", body: { v: 0 } }),
      );
      const responses = await Promise.all(
        [1, 2, 3].map((value) =>
          command(
            base,
            { "idempotency-key": `update-${value}` },
            JSON.stringify({
              recordType: "project",
              recordId: "p1",
              body: { v: value },
              expectedRevision: "1",
            }),
          ),
        ),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(2);
      // create (seq 1) + exactly one successful update (seq 2).
      expect(await pendingEvents(base)).toBe(2);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rolls a rejected command back with no partial record or stranded event", async () => {
    const { runtime, base } = await startHardeningRuntime();
    try {
      await command(
        base,
        { "idempotency-key": "create" },
        JSON.stringify({ recordType: "project", recordId: "p1", body: { v: 1 } }),
      );
      const conflicting = await command(
        base,
        { "idempotency-key": "create-again" },
        JSON.stringify({ recordType: "project", recordId: "p1", body: { v: 2 } }),
      );
      expect(conflicting.status).toBe(409);
      // The failed create appended no event and left the record at its original revision.
      expect(await pendingEvents(base)).toBe(1);
      const read = await fetch(`${base}/records/project/p1`, { headers: headers() });
      expect(((await read.json()) as { record: { revision: string } }).record.revision).toBe("1");
    } finally {
      await runtime.shutdown();
    }
  });
});
