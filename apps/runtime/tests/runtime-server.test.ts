import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const TOKEN = "token-abcdefghijklmnop";

interface TestRuntime {
  readonly runtime: RunningRuntime;
  readonly base: string;
}

async function startTestRuntime(): Promise<TestRuntime> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-server-")), "state.db");
  const config = createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
  const runtime = await startRuntime(config);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra };
}

function put(
  base: string,
  headers: Record<string, string>,
  body: unknown,
  type = "record.put",
): Promise<Response> {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: auth(headers),
    body: JSON.stringify(body),
  });
}

describe("runtime HTTP surface", () => {
  it("denies unauthenticated commands and unknown routes", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const noAuth = await fetch(`${base}/commands/record.put`, {
        method: "POST",
        headers: { "idempotency-key": "c1", "content-type": "application/json" },
        body: "{}",
      });
      expect(noAuth.status).toBe(403);

      const unknown = await put(base, { "idempotency-key": "c2" }, {}, "does.not.exist");
      expect(unknown.status).toBe(501);
    } finally {
      await runtime.shutdown();
    }
  });

  it("writes a record idempotently and serves it back", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const first = await put(
        base,
        { "idempotency-key": "cmd-1" },
        { recordType: "project", recordId: "project-1", body: { name: "demo" } },
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { result: { revision: string; sequence: number } };
      expect(firstBody.result.revision).toBe("1");
      expect(firstBody.result.sequence).toBe(1);

      // Identical retry returns the stored result and does not append a second event.
      const retry = await put(
        base,
        { "idempotency-key": "cmd-1" },
        { recordType: "project", recordId: "project-1", body: { name: "demo" } },
      );
      expect(await retry.json()).toEqual(firstBody);

      const read = await fetch(`${base}/records/project/project-1`, { headers: auth() });
      expect(read.status).toBe(200);
      const record = (await read.json()) as { record: { revision: string; value: unknown } };
      expect(record.record).toMatchObject({ revision: "1", value: { name: "demo" } });
    } finally {
      await runtime.shutdown();
    }
  });

  it("returns a version conflict on a stale expected revision", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      await put(
        base,
        { "idempotency-key": "c1" },
        { recordType: "project", recordId: "project-9", body: { v: 1 } },
      );
      const updated = await put(
        base,
        { "idempotency-key": "c2" },
        { recordType: "project", recordId: "project-9", body: { v: 2 }, expectedRevision: "1" },
      );
      expect((await readJson<{ result: { revision: string } }>(updated)).result.revision).toBe("2");

      const stale = await put(
        base,
        { "idempotency-key": "c3" },
        { recordType: "project", recordId: "project-9", body: { v: 3 }, expectedRevision: "1" },
      );
      expect(stale.status).toBe(409);
      expect((await readJson<{ error: { code: string } }>(stale)).error.code).toBe(
        "VERSION_CONFLICT",
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("replays committed events over the SSE stream in order", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      await put(
        base,
        { "idempotency-key": "c1" },
        { recordType: "project", recordId: "project-a", body: {} },
      );
      await put(
        base,
        { "idempotency-key": "c2" },
        { recordType: "project", recordId: "project-b", body: {} },
      );

      const controller = new AbortController();
      const response = await fetch(`${base}/events?afterSequence=0`, {
        headers: auth(),
        signal: controller.signal,
      });
      const stream = response.body;
      if (stream === null) throw new Error("event stream had no body");
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const sequences: number[] = [];
      let buffer = "";
      while (sequences.length < 2) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const match of buffer.matchAll(/^id: (\d+)$/gmu)) {
          sequences.push(Number.parseInt(match[1] as string, 10));
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
      controller.abort();
      expect(sequences.slice(0, 2)).toEqual([1, 2]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("establishes an authenticated SSE response while the durable log is idle", async () => {
    const { runtime, base } = await startTestRuntime();
    const controller = new AbortController();
    try {
      const outcome = await Promise.race([
        fetch(`${base}/events?afterSequence=0`, {
          headers: auth(),
          signal: controller.signal,
        }).then((response) => ({ kind: "response" as const, response })),
        new Promise<{ readonly kind: "timeout" }>((resolve) => {
          setTimeout(() => resolve({ kind: "timeout" }), 1_000);
        }),
      ]);

      expect(outcome.kind).toBe("response");
      if (outcome.kind !== "response") return;
      expect(outcome.response.status).toBe(200);
      expect(outcome.response.headers.get("content-type")).toContain("text/event-stream");
    } finally {
      controller.abort();
      await runtime.shutdown();
    }
  });

  it("releases the subscription when an SSE client disconnects", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      await put(
        base,
        { "idempotency-key": "c1" },
        { recordType: "project", recordId: "project-a", body: {} },
      );
      const controller = new AbortController();
      const response = await fetch(`${base}/events?afterSequence=0`, {
        headers: auth(),
        signal: controller.signal,
      });
      const stream = response.body;
      if (stream === null) throw new Error("event stream had no body");
      const reader = stream.getReader();
      await reader.read(); // ensure the subscription is active
      const active = await readJson<{ subscriptions: number }>(await fetch(`${base}/health`));
      expect(active.subscriptions).toBe(1);
      controller.abort();
      // The disconnect must drive the coordinator's active subscription count back to zero.
      let subscriptions = 1;
      for (let attempt = 0; attempt < 50 && subscriptions !== 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        subscriptions = (await readJson<{ subscriptions: number }>(await fetch(`${base}/health`)))
          .subscriptions;
      }
      expect(subscriptions).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  });

  it("recovers the durable log across a restart and reports health", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-recover-")), "state.db");
    const config = createRuntimeConfig({
      port: 0,
      databasePath,
      sessions: [{ token: TOKEN, actorId: "operator", roles: ["operator"] }],
      shutdownTimeoutMs: 200,
    });
    const first = await startRuntime(config);
    try {
      await put(
        `http://127.0.0.1:${first.address.port}`,
        { "idempotency-key": "c1" },
        { recordType: "project", recordId: "project-1", body: {} },
      );
    } finally {
      await first.shutdown();
    }

    const second = await startRuntime(config);
    try {
      expect(second.startup.latestSequence).toBe(1);
      const health = await fetch(`http://127.0.0.1:${second.address.port}/health`);
      expect(health.status).toBe(200);
      expect((await readJson<{ latestSequence: number }>(health)).latestSequence).toBe(1);
    } finally {
      await second.shutdown();
    }
  });
});
