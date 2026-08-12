import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const TOKEN = "token-general-production-abcdefghijklmnop";
const runtimes: RunningRuntime[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  const remainingServers = servers.splice(0);
  for (const server of remainingServers) server.closeAllConnections();
  await Promise.all(
    remainingServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fakeOllama(content: string): Promise<string> {
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { "content-type": "application/json", connection: "close" });
    reply.end(
      JSON.stringify({
        model: "devstral-small-2:24b",
        response: content,
        done: true,
        prompt_eval_count: 30,
        eval_count: 20,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Ollama fixture failed");
  return `http://127.0.0.1:${address.port}`;
}

async function boot(dataRoot: string, endpoint: string) {
  const runtime = await startRuntime(
    createRuntimeConfig({
      port: 0,
      databasePath: join(dataRoot, "state.db"),
      sessions: [{ token: TOKEN, actorId: "operator", roles: ["operator"] }],
      shutdownTimeoutMs: 500,
      executionProfile: "supervised_local",
      supervisedLocal: { ollamaEndpoint: endpoint, model: "devstral-small-2:24b" },
    }),
  );
  runtimes.push(runtime);
  return `http://127.0.0.1:${runtime.address.port}`;
}

function command(base: string, type: string, key: string, body: unknown) {
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

async function createMission(base: string, dataRoot: string) {
  const source = join(dataRoot, "projects/general-project");
  await Promise.all([
    mkdir(join(source, "src"), { recursive: true }),
    mkdir(join(source, "test"), { recursive: true }),
    mkdir(join(source, ".v31m4"), { recursive: true }),
  ]);
  writeFileSync(join(source, "src/greeting.mjs"), 'export const greeting = "broken";\n');
  writeFileSync(
    join(source, "src/format.mjs"),
    "export const formatGreeting = (value) => value.trim();\n",
  );
  writeFileSync(
    join(source, "test/greeting.test.mjs"),
    [
      'import { strict as assert } from "node:assert";',
      'import { greeting } from "../src/greeting.mjs";',
      'assert.equal(greeting, "hello world");',
    ].join("\n"),
  );
  writeFileSync(join(source, "README.md"), "unrelated content must remain unchanged\n");
  writeFileSync(join(source, "package.json"), '{"name":"general-fixture","type":"module"}\n');
  const projectResponse = await command(base, "project.create", "general-project", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "general-project-request",
    name: "General Project",
    rootPath: "general-project",
  });
  const projectId = ((await projectResponse.json()) as { result: { project: { id: string } } })
    .result.project.id;
  writeFileSync(
    join(source, ".v31m4/build-packet.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      projectId,
      objective: "Repair the greeting implementation.",
      requiredOutputs: [{ path: "src/greeting.mjs", mediaType: "text/javascript" }],
      forbiddenChanges: ["README.md"],
      allowedPaths: ["src"],
      allowedOperations: ["read", "update"],
      commands: [
        {
          id: "node-test",
          executable: "node",
          args: ["test/greeting.test.mjs"],
          cwd: ".",
          timeoutMs: 10_000,
        },
      ],
      mandatoryCommandIds: ["node-test"],
      resourceBudget: {
        maxFiles: 20,
        maxFileBytes: 16_384,
        maxTotalBytes: 131_072,
        maxRepairRounds: 1,
      },
    }),
  );
  const missionResponse = await command(base, "mission.submit", "general-mission", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "general-mission-request",
    projectId,
    title: "Repair greeting",
    objective: "Make greeting equal hello world without changing unrelated files.",
    requiredOutputs: [{ id: "greeting", kind: "code", description: "Updated greeting module." }],
    requirements: [
      {
        id: "greeting",
        statement: "Greeting is hello world.",
        priority: "required",
        source: "user",
      },
    ],
    constraints: [],
    acceptanceCriteria: [
      {
        id: "node-test",
        statement: "Independent greeting test passes.",
        verificationMethod: "Run the declared Node check.",
        mandatory: true,
      },
    ],
    forbiddenChanges: [],
    evidenceRequirements: [{ criterionId: "node-test", requiredEvidenceKinds: ["unit_test"] }],
    resourceBudget: {
      maxWallClockMs: 30_000,
      maxModelInvocations: 2,
      maxToolInvocations: 2,
      maxRepairRounds: 1,
      maxConcurrentWorkers: 1,
    },
  });
  const missionBody = (await missionResponse.json()) as {
    result?: { mission: { id: string } };
    error?: unknown;
  };
  expect(missionResponse.status, JSON.stringify(missionBody)).toBe(200);
  const missionId = missionBody.result?.mission.id;
  if (missionId === undefined) throw new Error("Mission response omitted its result.");
  return { source, missionId };
}

async function startGeneralJob(base: string, missionId: string, key: string) {
  const response = await command(base, "job.start", key, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `${key}-request`,
    missionId,
    workflowId: "software.production.v1",
  });
  const body = (await response.json()) as {
    result?: { job: { id: string } };
    error?: { code: string; message: string };
  };
  expect(response.status, JSON.stringify(body)).toBe(200);
  const jobId = body.result?.job.id;
  if (jobId === undefined) throw new Error("Job response omitted its result.");
  return jobId;
}

describe("general supervised coding production", () => {
  it("executes a real multi-file mission while preserving unrelated source", async () => {
    const manifest = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "hello world";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-production-"));
    const endpoint = await fakeOllama(manifest);
    const base = await boot(dataRoot, endpoint);
    const setup = await createMission(base, dataRoot);
    const jobId = await startGeneralJob(base, setup.missionId, "general-job");
    const result = await command(base, "job.execute", "general-execute", {
      jobId,
    });
    const body = (await result.json()) as {
      result?: { job: { status: string }; verification: { status: string }; receipt: unknown };
      error?: { code: string; message: string };
    };
    expect(result.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "completed" },
      verification: { status: "passed" },
    });
    expect(body.result?.receipt).not.toBeNull();
    const workspace = join(dataRoot, `supervised/kernel-workspaces/${jobId}`);
    expect(readFileSync(join(workspace, "src/greeting.mjs"), "utf8")).toContain("hello world");
    expect(readFileSync(join(workspace, "README.md"), "utf8")).toBe(
      "unrelated content must remain unchanged\n",
    );
    expect(readFileSync(join(workspace, "src/format.mjs"), "utf8")).toContain("formatGreeting");
    expect(readFileSync(join(setup.source, "src/greeting.mjs"), "utf8")).toContain("broken");
    const retry = await command(base, "job.execute", "general-execute", { jobId });
    expect(retry.status).toBe(200);

    const firstRuntime = runtimes.shift();
    await firstRuntime?.shutdown();
    const restartedBase = await boot(dataRoot, endpoint);
    const recovered = await fetch(`${restartedBase}/records/job/${jobId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ record: { value: { status: "completed" } } });
  });

  it("rejects an out-of-scope model change before any protected workspace effect", async () => {
    const manifest = JSON.stringify({
      changes: [{ path: "README.md", operation: "update", content: "model escaped scope\n" }],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-scope-"));
    const base = await boot(dataRoot, await fakeOllama(manifest));
    const setup = await createMission(base, dataRoot);
    const jobId = await startGeneralJob(base, setup.missionId, "scope-job");
    const response = await command(base, "job.execute", "scope-execute", { jobId });
    expect(response.status).toBe(502);
    expect(
      readFileSync(join(dataRoot, `supervised/kernel-workspaces/${jobId}/README.md`), "utf8"),
    ).toBe("unrelated content must remain unchanged\n");
  });

  it("persists failed independent verification and creates no delivery", async () => {
    const manifest = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "still broken";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-verifier-"));
    const base = await boot(dataRoot, await fakeOllama(manifest));
    const setup = await createMission(base, dataRoot);
    const jobId = await startGeneralJob(base, setup.missionId, "failed-job");
    const response = await command(base, "job.execute", "failed-execute", { jobId });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "failed" },
      verification: { status: "failed" },
      decision: { decision: "no_verified_solution" },
      receipt: null,
    });
  });

  it.runIf(process.env["V31M4_RUN_REAL_GENERAL_PROOF"] === "1")(
    "completes the general workflow with an installed local Ollama model",
    async () => {
      const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-real-"));
      const base = await boot(
        dataRoot,
        process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434",
      );
      const setup = await createMission(base, dataRoot);
      const jobId = await startGeneralJob(base, setup.missionId, "real-general-job");
      const response = await command(base, "job.execute", "real-general-execute", { jobId });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.result).toMatchObject({
        job: { status: "completed" },
        candidate: { configuration: { modelId: "devstral-small-2:24b" } },
        verification: { status: "passed" },
        decision: { decision: "champion" },
      });
    },
    180_000,
  );
});
