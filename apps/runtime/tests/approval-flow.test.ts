import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-operator-abcdefghijkl";
const VIEWER_TOKEN = "token-viewer-abcdefghijklmn";

function configuration(databasePath: string): RuntimeConfig {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [
      { token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] },
      { token: VIEWER_TOKEN, actorId: "viewer", roles: ["viewer"] },
    ],
    shutdownTimeoutMs: 200,
  });
}

function manifest(pluginId: string) {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    pluginId,
    displayName: `Plugin ${pluginId}`,
    version: "1.0.0",
    minimumRuntimeVersion: "1.0.0",
    entrypoint: `plugins/${pluginId}.mjs`,
    capabilities: ["capability.demo"],
    requiredToolIds: [],
    optionalToolIds: [],
    workflowIds: [],
    verifierIds: [],
    permissions: { filesystem: ["project_read"], network: false, process: [] },
  };
}

function metadata(requestId: string) {
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, requestId };
}

async function command(
  runtime: RunningRuntime,
  type: string,
  key: string,
  body: unknown,
  token = OPERATOR_TOKEN,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${runtime.address.port}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

async function query(
  runtime: RunningRuntime,
  type: string,
  body: unknown,
  token: string | null = OPERATOR_TOKEN,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${runtime.address.port}/queries/${type}`, {
    method: "POST",
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function approvalList(runtime: RunningRuntime, status?: string) {
  const response = await query(runtime, "approval.list", {
    ...metadata(`request:list:${status ?? "all"}`),
    ...(status === undefined ? {} : { status }),
    pagination: { limit: 100 },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result: {
      approvals: Array<{ id: string; status: string }>;
      pagination: { total: number; nextCursor?: string };
    };
  };
}

async function requestPlugin(runtime: RunningRuntime, pluginId: string, key: string) {
  const response = await command(runtime, "plugin.register", key, {
    ...metadata(`request:${key}`),
    manifest: manifest(pluginId),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { outcome: string; approval: { id: string; status: string } };
  };
  expect(body.result).toMatchObject({
    outcome: "approval_required",
    approval: { status: "pending" },
  });
  return body.result.approval.id;
}

async function decide(
  runtime: RunningRuntime,
  approvalId: string,
  decision: "grant" | "deny",
  key: string,
  token = OPERATOR_TOKEN,
): Promise<Response> {
  return command(
    runtime,
    "approval.decide",
    key,
    {
      ...metadata(`request:${key}`),
      approvalId,
      decision,
      reason: decision === "grant" ? "Reviewed and approved." : "Risk was not accepted.",
    },
    token,
  );
}

describe("durable approval flow", () => {
  it("preserves the allow path and proves pending -> granted -> consumed through restart", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-approval-flow-")), "state.db");
    const config = configuration(databasePath);
    let runtime = await startRuntime(config);
    try {
      const project = await command(runtime, "project.create", "allow-project", {
        ...metadata("request:allow-project"),
        name: "Allow Path",
        rootPath: "allow-path",
      });
      expect(project.status).toBe(200);

      const approvalId = await requestPlugin(runtime, "plugin.approval-proof", "plugin-request");
      const absent = await fetch(
        `http://127.0.0.1:${runtime.address.port}/records/plugin/plugin.approval-proof`,
        { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } },
      );
      expect(absent.status).toBe(404);
      expect((await approvalList(runtime, "pending")).result.approvals).toEqual([
        expect.objectContaining({ id: approvalId, status: "pending" }),
      ]);

      const unauthenticated = await query(
        runtime,
        "approval.list",
        {
          ...metadata("request:unauthenticated"),
          pagination: { limit: 10 },
        },
        null,
      );
      expect(unauthenticated.status).toBe(403);
      const unauthorized = await decide(runtime, approvalId, "grant", "viewer-grant", VIEWER_TOKEN);
      expect(unauthorized.status).toBe(403);
      expect((await approvalList(runtime, "pending")).result.approvals).toHaveLength(1);

      await runtime.shutdown();
      runtime = await startRuntime(config);
      expect((await approvalList(runtime, "pending")).result.approvals[0]?.id).toBe(approvalId);

      const granted = await decide(runtime, approvalId, "grant", "operator-grant");
      expect(granted.status).toBe(200);
      expect(await granted.json()).toMatchObject({ result: { approval: { status: "granted" } } });

      await runtime.shutdown();
      runtime = await startRuntime(config);
      expect((await approvalList(runtime, "granted")).result.approvals[0]?.id).toBe(approvalId);

      const registrationPayload = {
        ...metadata("request:register-approved"),
        manifest: manifest("plugin.approval-proof"),
        approvalId,
      };
      const registration = await command(
        runtime,
        "plugin.register",
        "plugin-register-approved",
        registrationPayload,
      );
      expect(registration.status).toBe(200);
      const registeredBody = await registration.json();
      expect(registeredBody).toMatchObject({ result: { outcome: "registered" } });
      expect((await approvalList(runtime, "consumed")).result.approvals[0]?.id).toBe(approvalId);

      const idempotentReplay = await command(
        runtime,
        "plugin.register",
        "plugin-register-approved",
        registrationPayload,
      );
      expect(await idempotentReplay.json()).toEqual(registeredBody);
      const reuse = await command(
        runtime,
        "plugin.register",
        "plugin-reuse-denied",
        registrationPayload,
      );
      expect(reuse.status).toBe(403);
      expect(await reuse.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });

      await runtime.shutdown();
      runtime = await startRuntime(config);
      expect((await approvalList(runtime, "consumed")).result.approvals[0]?.id).toBe(approvalId);
      const auditBodies = runtime.composition.database.connection
        .prepare("SELECT body FROM records WHERE record_type = 'audit' ORDER BY rowid ASC")
        .all() as Array<{ body: string }>;
      expect(
        auditBodies
          .map((row) => JSON.parse(row.body) as { action: string })
          .map((record) => record.action),
      ).toEqual(
        expect.arrayContaining([
          "approval.request",
          "approval.decide",
          "approval.consume",
          "plugin.register",
        ]),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("fails closed for missing, denied, malformed, nonexistent, and unauthorized decisions", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-approval-deny-")), "state.db");
    const config = configuration(databasePath);
    let runtime = await startRuntime(config);
    try {
      const viewerRequest = await command(
        runtime,
        "plugin.register",
        "viewer-request",
        {
          ...metadata("request:viewer"),
          manifest: manifest("plugin.viewer"),
        },
        VIEWER_TOKEN,
      );
      expect(viewerRequest.status).toBe(403);

      const missing = await command(runtime, "plugin.register", "missing-approval", {
        ...metadata("request:missing"),
        manifest: manifest("plugin.missing"),
        approvalId: "approval.does-not-exist",
      });
      expect(missing.status).toBe(403);
      expect(await missing.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });

      const nonexistent = await decide(runtime, "approval.does-not-exist", "grant", "nonexistent");
      expect(nonexistent.status).toBe(404);
      expect(await nonexistent.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
      const malformed = await command(runtime, "approval.decide", "malformed", {
        ...metadata("request:malformed"),
        approvalId: "bad id",
        decision: "grant",
        reason: "Reviewed.",
      });
      expect(malformed.status).toBe(400);

      const approvalId = await requestPlugin(runtime, "plugin.denied", "deny-request");
      const denied = await decide(runtime, approvalId, "deny", "deny-decision");
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ result: { approval: { status: "denied" } } });

      await runtime.shutdown();
      runtime = await startRuntime(config);
      expect((await approvalList(runtime, "denied")).result.approvals[0]?.id).toBe(approvalId);
      const deniedEffect = await command(runtime, "plugin.register", "denied-effect", {
        ...metadata("request:denied-effect"),
        manifest: manifest("plugin.denied"),
        approvalId,
      });
      expect(deniedEffect.status).toBe(403);
      expect(await deniedEffect.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });
    } finally {
      await runtime.shutdown();
    }
  });

  it("rolls approval consumption back when the protected plugin write fails", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-approval-rollback-")), "state.db");
    const runtime = await startRuntime(configuration(databasePath));
    try {
      const firstId = await requestPlugin(runtime, "plugin.duplicate", "first-request");
      expect((await decide(runtime, firstId, "grant", "first-grant")).status).toBe(200);
      expect(
        (
          await command(runtime, "plugin.register", "first-register", {
            ...metadata("request:first-register"),
            manifest: manifest("plugin.duplicate"),
            approvalId: firstId,
          })
        ).status,
      ).toBe(200);

      const secondId = await requestPlugin(runtime, "plugin.duplicate", "second-request");
      expect((await decide(runtime, secondId, "grant", "second-grant")).status).toBe(200);
      const failed = await command(runtime, "plugin.register", "second-register", {
        ...metadata("request:second-register"),
        manifest: manifest("plugin.duplicate"),
        approvalId: secondId,
      });
      expect(failed.status).toBe(409);
      expect(await failed.json()).toMatchObject({ error: { code: "ALREADY_EXISTS" } });

      expect((await approvalList(runtime, "granted")).result.approvals).toEqual([
        expect.objectContaining({ id: secondId, status: "granted" }),
      ]);
      const audits = runtime.composition.database.connection
        .prepare("SELECT body FROM records WHERE record_type = 'audit'")
        .all() as Array<{ body: string }>;
      const secondConsume = audits
        .map((row) => JSON.parse(row.body) as { action: string; resourceId?: string })
        .filter((record) => record.action === "approval.consume" && record.resourceId === secondId);
      expect(secondConsume).toEqual([]);
    } finally {
      await runtime.shutdown();
    }
  });
});
