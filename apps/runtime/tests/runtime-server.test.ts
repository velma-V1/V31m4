import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
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

function command(
  base: string,
  headers: Record<string, string>,
  body: unknown,
  type = "project.create",
): Promise<Response> {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: auth(headers),
    body: JSON.stringify(body),
  });
}

function project(name: string, requestId = `request:${name.toLowerCase().replaceAll(" ", "-")}`) {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId,
    name,
    rootPath: name.toLowerCase().replaceAll(" ", "-"),
  };
}

describe("runtime HTTP surface", () => {
  it("denies unauthenticated commands and unknown routes", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const noAuth = await fetch(`${base}/commands/project.create`, {
        method: "POST",
        headers: { "idempotency-key": "c1", "content-type": "application/json" },
        body: "{}",
      });
      expect(noAuth.status).toBe(403);

      const unknown = await command(base, { "idempotency-key": "c2" }, {}, "does.not.exist");
      expect(unknown.status).toBe(501);
    } finally {
      await runtime.shutdown();
    }
  });

  it("executes a typed command idempotently and serves its authoritative record", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const payload = project("Demo");
      const first = await command(base, { "idempotency-key": "cmd-1" }, payload);
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        result: { project: { id: string; name: string } };
      };
      expect(firstBody.result.project.name).toBe("Demo");

      // Identical retry returns the stored result and does not append a second event.
      const retry = await command(base, { "idempotency-key": "cmd-1" }, payload);
      expect(await retry.json()).toEqual(firstBody);
      expect(
        (await readJson<{ latestSequence: number }>(await fetch(`${base}/health`))).latestSequence,
      ).toBe(1);

      const read = await fetch(`${base}/records/project/${firstBody.result.project.id}`, {
        headers: auth(),
      });
      expect(read.status).toBe(200);
      const record = (await read.json()) as { record: { revision: string; value: unknown } };
      expect(record.record).toMatchObject({ revision: "1", value: { name: "Demo" } });
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects reuse of an idempotency key with a conflicting payload", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      expect(
        (await command(base, { "idempotency-key": "same-key" }, project("First"))).status,
      ).toBe(200);
      const conflict = await command(base, { "idempotency-key": "same-key" }, project("Second"));
      expect(conflict.status).toBe(409);
      expect((await readJson<{ error: { code: string } }>(conflict)).error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  });

  it("replays committed events over the SSE stream in order", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      await command(base, { "idempotency-key": "c1" }, project("Project A"));
      await command(base, { "idempotency-key": "c2" }, project("Project B"));

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

  it("rejects partially numeric and unsafe SSE replay cursors", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      for (const cursor of ["1junk", "01", "9007199254740992"]) {
        const response = await fetch(`${base}/events?afterSequence=${cursor}`, { headers: auth() });
        expect(response.status, cursor).toBe(400);
        expect(await response.json(), cursor).toMatchObject({
          error: { code: "INVALID_APPLICATION_INPUT" },
        });
      }
    } finally {
      await runtime.shutdown();
    }
  });

  it("releases the subscription when an SSE client disconnects", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      await command(base, { "idempotency-key": "c1" }, project("Project A"));
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
      await command(
        `http://127.0.0.1:${first.address.port}`,
        { "idempotency-key": "c1" },
        project("Project One"),
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
