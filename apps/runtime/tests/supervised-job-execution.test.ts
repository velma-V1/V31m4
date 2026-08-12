import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import type { CompositionOverrides } from "../src/composition-root.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-stage4-abcdefghijklmnop";
const runtimes: RunningRuntime[] = [];
const ollamaServers: Server[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  await Promise.all(
    ollamaServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fakeOllama(content: string) {
  let count = 0;
  const server = createServer((request, reply) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        prompt: string;
      };
      count += 1;
      reply.writeHead(200, { "content-type": "application/json" });
      reply.end(
        JSON.stringify({
          model: body.model,
          response: JSON.stringify({ content }),
          done: true,
          prompt_eval_count: 20,
          eval_count: 18,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  ollamaServers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Ollama fixture did not bind");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    count: () => count,
  };
}

function config(databasePath: string, endpoint: string): RuntimeConfig {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 500,
    executionProfile: "supervised_local",
    supervisedLocal: { ollamaEndpoint: endpoint, model: "devstral-small-2:24b" },
  });
}

async function boot(
  databasePath: string,
  endpoint: string,
  overrides?: CompositionOverrides,
): Promise<{ readonly runtime: RunningRuntime; readonly base: string }> {
  const runtime = await startRuntime(config(databasePath, endpoint), overrides);
  runtimes.push(runtime);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
}

function command(base: string, type: string, key: string, body: unknown) {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPERATOR_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

async function setup(base: string, prefix: string) {
  const project = await command(base, "project.create", `${prefix}-project`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `${prefix}-project-request`,
    name: "Stage 4 Tiny Code",
    rootPath: `${prefix}-project`,
  });
  const projectId = ((await project.json()) as { result: { project: { id: string } } }).result
    .project.id;
  const mission = await command(base, "mission.submit", `${prefix}-mission`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `${prefix}-mission-request`,
    projectId,
    title: "Implement deterministic addition",
    objective:
      "Return a complete JavaScript ES module exporting function add(a, b) that returns the arithmetic sum. Return only the module source.",
    requiredOutputs: [{ id: "module", kind: "code", description: "A solution.mjs module." }],
    requirements: [
      {
        id: "addition",
        statement: "add(a, b) returns the arithmetic sum.",
        priority: "required",
        source: "user",
      },
    ],
    constraints: [],
    acceptanceCriteria: [
      {
        id: "node-test",
        statement: "Independent Node assertions pass.",
        verificationMethod: "Run the isolated verify.mjs command.",
        mandatory: true,
      },
    ],
    forbiddenChanges: [],
    evidenceRequirements: [{ criterionId: "node-test", requiredEvidenceKinds: ["unit_test"] }],
    resourceBudget: {
      maxWallClockMs: 30_000,
      maxModelInvocations: 3,
      maxToolInvocations: 3,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    },
  });
  const missionId = ((await mission.json()) as { result: { mission: { id: string } } }).result
    .mission.id;
  const job = await command(base, "job.start", `${prefix}-job`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `${prefix}-job-request`,
    missionId,
    workflowId: "stage4.tiny-code",
  });
  const jobBody = (await job.json()) as { result?: { job: { id: string } }; error?: unknown };
  expect(job.status, JSON.stringify(jobBody)).toBe(200);
  return { projectId, missionId, jobId: jobBody.result?.job.id as string };
}

async function execute(base: string, jobId: string, key: string) {
  const response = await command(base, "job.execute", key, { jobId });
  return {
    status: response.status,
    body: (await response.json()) as {
      result?: {
        job: { status: string; latestCheckpointId?: string };
        candidate: { id: string; configuration: { modelId: string }; outputArtifactIds: string[] };
        verification: { status: string; evidenceIds: string[] };
        decision: { decision: string; candidateId?: string };
        receipt: { evidenceIds: string[] } | null;
      };
      error?: { code: string; message: string };
    },
  };
}

function countRecord(databasePath: string, type: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    return Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM records WHERE record_type = ?")
          .get(type) as {
          count: number;
        }
      ).count,
    );
  } finally {
    database.close();
  }
}

describe("supervised_local system-build execution", () => {
  it("uses real supervised components and delivers only from independent passing evidence", async () => {
    const ollama = await fakeOllama("export function add(a, b) { return a + b; }\n");
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-stage4-positive-"));
    const databasePath = join(dataRoot, "state.db");
    const { base } = await boot(databasePath, ollama.endpoint);
    const ids = await setup(base, "positive");
    const outcome = await execute(base, ids.jobId, "positive-execute");

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body.result).toMatchObject({
      job: { status: "completed" },
      candidate: { configuration: { modelId: "devstral-small-2:24b" } },
      verification: { status: "passed" },
      decision: { decision: "champion" },
    });
    expect(outcome.body.result?.receipt).not.toBeNull();
    expect(ollama.count()).toBe(1);
    expect(countRecord(databasePath, "checkpoint")).toBe(1);
    expect(countRecord(databasePath, "evidence")).toBe(1);
    const state = JSON.parse(
      readFileSync(
        join(dataRoot, `supervised/kernel-workspaces/${ids.jobId}/kernel-state.json`),
        "utf8",
      ),
    );
    expect(state).toMatchObject({ status: "completed", applyCount: 1 });
    expect(
      existsSync(join(dataRoot, `supervised/kernel-workspaces/${ids.jobId}/solution.mjs`)),
    ).toBe(true);
  });

  it("persists failed verifier evidence and creates no champion delivery", async () => {
    const ollama = await fakeOllama("export function add(a, b) { return a - b; }\n");
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-stage4-negative-"));
    const databasePath = join(dataRoot, "state.db");
    const { base } = await boot(databasePath, ollama.endpoint);
    const ids = await setup(base, "negative");
    const outcome = await execute(base, ids.jobId, "negative-execute");

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body.result).toMatchObject({
      job: { status: "failed" },
      verification: { status: "failed" },
      decision: { decision: "no_verified_solution" },
      receipt: null,
    });
    expect(countRecord(databasePath, "evidence")).toBe(1);
    expect(countRecord(databasePath, "delivery-receipt")).toBe(0);
  });

  it("reconciles an interrupted applied effect after restart without duplicates", async () => {
    const ollama = await fakeOllama("export function add(a, b) { return a + b; }\n");
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-stage4-restart-"));
    const databasePath = join(dataRoot, "state.db");
    const first = await boot(databasePath, ollama.endpoint, { interruptAfterKernelEffect: true });
    const ids = await setup(first.base, "restart");
    const interrupted = await execute(first.base, ids.jobId, "restart-execute");
    expect(interrupted.status).toBe(503);
    await first.runtime.shutdown();
    runtimes.splice(runtimes.indexOf(first.runtime), 1);

    const second = await boot(databasePath, ollama.endpoint);
    const recovered = await execute(second.base, ids.jobId, "restart-execute");
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(recovered.body.result).toMatchObject({
      job: { status: "completed" },
      verification: { status: "passed" },
      decision: { decision: "champion" },
    });
    expect(ollama.count()).toBe(1);
    expect(countRecord(databasePath, "candidate")).toBe(1);
    expect(countRecord(databasePath, "checkpoint")).toBe(1);
    expect(countRecord(databasePath, "evidence")).toBe(1);
    expect(countRecord(databasePath, "champion-decision")).toBe(1);
    expect(countRecord(databasePath, "delivery-receipt")).toBe(1);
    expect(
      JSON.parse(
        readFileSync(
          join(dataRoot, `supervised/kernel-workspaces/${ids.jobId}/kernel-state.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({ applyCount: 1 });
  });
});
