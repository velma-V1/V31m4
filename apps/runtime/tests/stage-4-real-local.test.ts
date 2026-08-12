import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const enabled = process.env["V31M4_STAGE4_REAL"] === "1";
const realTest = enabled ? it : it.skip;
const token = "token-stage4-real-abcdefghijklmnop";

function command(base: string, type: string, key: string, body: unknown) {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

async function boot(databasePath: string, interruptAfterKernelEffect = false) {
  const endpoint = process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434";
  const model = process.env["V31M4_OLLAMA_MODEL"] ?? "devstral-small-2:24b";
  const runtime = await startRuntime(
    createRuntimeConfig({
      port: 0,
      databasePath,
      sessions: [{ token, actorId: "operator", roles: ["operator"] }],
      shutdownTimeoutMs: 1_000,
      executionProfile: "supervised_local",
      supervisedLocal: { ollamaEndpoint: endpoint, model },
    }),
    interruptAfterKernelEffect ? { interruptAfterKernelEffect: true } : undefined,
  );
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}`, model };
}

async function createRealJob(base: string) {
  const projectResponse = await command(base, "project.create", "stage4-real-project", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "stage4-real-project-request",
    name: "Stage 4 Real Local Proof",
    rootPath: "stage4-real-local-proof",
  });
  const projectId = ((await projectResponse.json()) as { result: { project: { id: string } } })
    .result.project.id;
  const missionResponse = await command(base, "mission.submit", "stage4-real-mission", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "stage4-real-mission-request",
    projectId,
    title: "Implement a deterministic addition module",
    objective:
      "Produce a complete JavaScript ES module containing exactly one exported function named add with parameters a and b. It must return the arithmetic expression a + b. Return only executable module source, with no Markdown fences, explanation, tests, imports, or additional exports.",
    requiredOutputs: [
      { id: "solution-module", kind: "code", description: "An executable solution.mjs module." },
    ],
    requirements: [
      {
        id: "addition-correctness",
        statement: "add(a, b) returns the arithmetic sum for positive and negative inputs.",
        priority: "required",
        source: "user",
      },
    ],
    constraints: [
      {
        id: "bounded-change",
        statement: "Only the isolated Stage 4 fixture may be changed.",
        category: "security",
      },
    ],
    acceptanceCriteria: [
      {
        id: "independent-node-check",
        statement: "The independent Node assertion command exits successfully.",
        verificationMethod: "Execute isolated verify.mjs in a separate verifier process.",
        mandatory: true,
      },
    ],
    forbiddenChanges: [
      {
        id: "no-runtime-source-change",
        statement: "The produced work may not modify V31M4 source.",
      },
    ],
    evidenceRequirements: [
      { criterionId: "independent-node-check", requiredEvidenceKinds: ["unit_test"] },
    ],
    resourceBudget: {
      maxWallClockMs: 120_000,
      maxModelInvocations: 3,
      maxToolInvocations: 3,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    },
  });
  const missionId = ((await missionResponse.json()) as { result: { mission: { id: string } } })
    .result.mission.id;
  const jobResponse = await command(base, "job.start", "stage4-real-job", {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "stage4-real-job-request",
    missionId,
    workflowId: "stage4.tiny-code",
  });
  const jobBody = (await jobResponse.json()) as {
    result?: { job: { id: string } };
    error?: unknown;
  };
  expect(jobResponse.status, JSON.stringify(jobBody)).toBe(200);
  return jobBody.result?.job.id as string;
}

function recordCount(databasePath: string, type: string): number {
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

realTest(
  "proves actual Ollama inference, real kernel/verifier effects, evidence gating, and restart reconciliation",
  async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-stage4-real-"));
    const databasePath = join(dataRoot, "state.db");
    let first: RunningRuntime | undefined;
    let second: RunningRuntime | undefined;
    try {
      const initial = await boot(databasePath, true);
      first = initial.runtime;
      const jobId = await createRealJob(initial.base);
      const interruptedResponse = await command(
        initial.base,
        "job.execute",
        "stage4-real-execute",
        { jobId },
      );
      const interruptedBody = await interruptedResponse.json();
      expect(interruptedResponse.status, JSON.stringify(interruptedBody)).toBe(503);
      await first.shutdown();
      first = undefined;

      const restarted = await boot(databasePath);
      second = restarted.runtime;
      const recoveredResponse = await command(
        restarted.base,
        "job.execute",
        "stage4-real-execute",
        { jobId },
      );
      const recovered = (await recoveredResponse.json()) as {
        result?: {
          job: { status: string; latestCheckpointId?: string };
          candidate: { configuration: { modelId: string }; outputArtifactIds: string[] };
          verification: { status: string; evidenceIds: string[] };
          decision: { decision: string; candidateId?: string };
          receipt: { evidenceIds: string[] } | null;
        };
        error?: unknown;
      };
      expect(recoveredResponse.status, JSON.stringify(recovered)).toBe(200);
      expect(recovered.result).toMatchObject({
        job: { status: "completed" },
        candidate: { configuration: { modelId: restarted.model } },
        verification: { status: "passed" },
        decision: { decision: "champion" },
      });
      expect(recovered.result?.receipt).not.toBeNull();
      expect(recovered.result?.job.latestCheckpointId).toMatch(/^checkpoint-/u);
      expect(recordCount(databasePath, "candidate")).toBe(1);
      expect(recordCount(databasePath, "checkpoint")).toBe(1);
      expect(recordCount(databasePath, "evidence")).toBe(1);
      expect(recordCount(databasePath, "champion-decision")).toBe(1);
      expect(recordCount(databasePath, "delivery-receipt")).toBe(1);

      const supervisedRoot = join(dataRoot, "supervised");
      const modelOutputs = readdirSync(join(supervisedRoot, "model-outputs")).filter((name) =>
        name.endsWith(".txt"),
      );
      expect(modelOutputs).toHaveLength(1);
      const modelOutput = readFileSync(
        join(supervisedRoot, "model-outputs", modelOutputs[0] as string),
        "utf8",
      );
      expect(modelOutput).toContain("return a + b");
      expect(modelOutput).not.toContain("reference-response");
      const workspace = join(supervisedRoot, "kernel-workspaces", jobId);
      expect(existsSync(join(workspace, "solution.mjs"))).toBe(true);
      expect(JSON.parse(readFileSync(join(workspace, "kernel-state.json"), "utf8"))).toMatchObject({
        status: "completed",
        applyCount: 1,
      });
      const reports = readdirSync(join(supervisedRoot, "verifier-reports"));
      expect(reports).toHaveLength(1);
      expect(
        JSON.parse(
          readFileSync(join(supervisedRoot, "verifier-reports", reports[0] as string), "utf8"),
        ),
      ).toMatchObject({
        verifierId: "stage4-node-verifier",
        verifierVersion: "1.0.0",
        checkId: "stage4.tiny-code.tests",
        exitCode: 0,
      });
    } finally {
      await first?.shutdown();
      await second?.shutdown();
    }
  },
  300_000,
);
