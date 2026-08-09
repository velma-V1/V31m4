import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

async function startTestRuntime(): Promise<{ runtime: RunningRuntime; base: string }> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-ui-")), "state.db");
  const config = createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: "token-abcdefghijklmnop", actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
  const runtime = await startRuntime(config);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
}

describe("operator UI static route", () => {
  it("serves the real operator HTML at / without authentication, not a placeholder", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await fetch(`${base}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      // Assert on real, load-bearing content rather than just "non-empty", so a broken build
      // (e.g. the file failing to read and falling back to something empty) would fail this test.
      expect(html).toContain("<title>V31M4 Operator</title>");
      expect(html).toContain("/commands/project.create");
      expect(html).toContain("/events");
    } finally {
      await runtime.shutdown();
    }
  });

  it("still requires authentication for the API surface behind the UI", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await fetch(`${base}/records/project/does-not-exist`);
      expect(response.status).toBe(403);
    } finally {
      await runtime.shutdown();
    }
  });
});
