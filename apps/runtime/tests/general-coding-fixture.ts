import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { expect } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import type { CompositionOverrides } from "../src/composition-root.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

export const GENERAL_TOKEN = "token-general-production-abcdefghijklmnop";
export const generalRuntimes: RunningRuntime[] = [];
const servers: Server[] = [];

export async function cleanupGeneralFixtures(): Promise<void> {
  await Promise.all(generalRuntimes.splice(0).map((runtime) => runtime.shutdown()));
  const remainingServers = servers.splice(0);
  for (const server of remainingServers) server.closeAllConnections();
  await Promise.all(
    remainingServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
}

export async function fakeOllama(content: string | readonly string[]): Promise<string> {
  const responses = typeof content === "string" ? [content] : [...content];
  const server = createServer((request, reply) => {
    if (request.url === "/api/tags") {
      reply.writeHead(200, { "content-type": "application/json", connection: "close" });
      reply.end(JSON.stringify({ models: [{ name: "devstral-small-2:24b" }] }));
      return;
    }
    const response = responses.length > 1 ? responses.shift() : responses[0];
    if (response === undefined) throw new Error("Ollama fixture exhausted its responses.");
    reply.writeHead(200, { "content-type": "application/json", connection: "close" });
    reply.end(
      JSON.stringify({
        model: "devstral-small-2:24b",
        response,
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

export async function bootGeneralRuntime(
  dataRoot: string,
  endpoint: string,
  overrides?: CompositionOverrides,
): Promise<string> {
  const runtime = await startRuntime(
    createRuntimeConfig({
      port: 0,
      databasePath: join(dataRoot, "state.db"),
      sessions: [{ token: GENERAL_TOKEN, actorId: "operator", roles: ["operator"] }],
      shutdownTimeoutMs: 500,
      executionProfile: "supervised_local",
      supervisedLocal: { ollamaEndpoint: endpoint, model: "devstral-small-2:24b" },
    }),
    overrides,
  );
  generalRuntimes.push(runtime);
  return `http://127.0.0.1:${runtime.address.port}`;
}

export function generalCommand(base: string, type: string, key: string, body: unknown) {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GENERAL_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

export async function createGeneralMission(
  base: string,
  dataRoot: string,
  maxRepairRounds = 1,
  expectedGreeting = "hello world",
  revealExpected = true,
) {
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
      `assert.equal(greeting, ${JSON.stringify(expectedGreeting)});`,
    ].join("\n"),
  );
  writeFileSync(join(source, "README.md"), "unrelated content must remain unchanged\n");
  writeFileSync(join(source, "package.json"), '{"name":"general-fixture","type":"module"}\n');
  const projectResponse = await generalCommand(base, "project.create", "general-project", {
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
        maxRepairRounds,
      },
    }),
  );
  const missionResponse = await generalCommand(base, "mission.submit", "general-mission", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "general-mission-request",
    projectId,
    title: "Repair greeting",
    objective: revealExpected
      ? `Make greeting equal ${expectedGreeting} without changing unrelated files.`
      : "Make greeting satisfy the independent acceptance check without changing unrelated files.",
    requiredOutputs: [{ id: "greeting", kind: "code", description: "Updated greeting module." }],
    requirements: [
      {
        id: "greeting",
        statement: `Greeting is ${expectedGreeting}.`,
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
      maxToolInvocations: 3,
      maxRepairRounds,
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
  return { source, projectId, missionId };
}

export async function startGeneralJob(base: string, missionId: string, key: string) {
  const response = await generalCommand(base, "job.start", key, {
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
