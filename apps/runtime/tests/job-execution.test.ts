import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import type { CompositionOverrides } from "../src/composition-root.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";
import { AFTER_FIRST_PAGE_MODEL_ID, PagedModelGateway } from "./paged-model-gateway-fixture.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

interface TestRuntime {
  readonly runtime: RunningRuntime;
  readonly base: string;
  readonly databasePath: string;
}

function testConfig(databasePath: string): RuntimeConfig {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
}

async function startTestRuntime(overrides?: CompositionOverrides): Promise<TestRuntime> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-job-exec-")), "state.db");
  const runtime = await startRuntime(testConfig(databasePath), overrides);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}`, databasePath };
}

function command(base: string, type: string, idempotencyKey: string, body: unknown) {
  return fetch(`${base}/commands/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPERATOR_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function record(base: string, type: string, id: string) {
  return fetch(`${base}/records/${type}/${id}`, {
    headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
  });
}

async function createProjectMissionJob(
  base: string,
  keyPrefix: string,
): Promise<{ projectId: string; missionId: string; jobId: string }> {
  const projectResponse = await command(base, "project.create", `${keyPrefix}-project`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-project`,
    name: "Execution Test Project",
    rootPath: `${keyPrefix}-project`,
  });
  const projectId = ((await projectResponse.json()) as { result: { project: { id: string } } })
    .result.project.id;

  const missionResponse = await command(base, "mission.submit", `${keyPrefix}-mission`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-mission`,
    projectId,
    title: "Execution Test Mission",
    objective: "Prove the full vertical slice reaches a delivered result.",
    requiredOutputs: [{ id: "output-1", kind: "code", description: "A working feature." }],
    requirements: [
      { id: "requirement-1", statement: "Must compile.", priority: "required", source: "user" },
    ],
    constraints: [],
    acceptanceCriteria: [
      {
        id: "criterion-1",
        statement: "Output artifact exists.",
        verificationMethod: "Reference verifier checks artifact presence.",
        mandatory: true,
      },
    ],
    forbiddenChanges: [],
    evidenceRequirements: [{ criterionId: "criterion-1", requiredEvidenceKinds: ["unit_test"] }],
    resourceBudget: {
      maxWallClockMs: 60_000,
      maxModelInvocations: 10,
      maxToolInvocations: 10,
      maxRepairRounds: 1,
      maxConcurrentWorkers: 1,
    },
  });
  const missionId = ((await missionResponse.json()) as { result: { mission: { id: string } } })
    .result.mission.id;

  const jobResponse = await command(base, "job.start", `${keyPrefix}-job`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-job`,
    missionId,
    workflowId: "default-workflow",
  });
  const jobId = ((await jobResponse.json()) as { result: { job: { id: string } } }).result.job.id;

  return { projectId, missionId, jobId };
}

describe("job.execute command (full vertical slice)", () => {
  it("routes to an eligible model after provider page one and records its provenance", async () => {
    const { runtime, base } = await startTestRuntime({
      modelGatewayDecorator: (gateway) => new PagedModelGateway(gateway),
    });
    try {
      const { jobId } = await createProjectMissionJob(base, "paged-model");
      const response = await command(base, "job.execute", "paged-model-execute", { jobId });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { candidate: { configuration: { modelId: string } } };
      };
      expect(body.result.candidate.configuration.modelId).toBe(AFTER_FIRST_PAGE_MODEL_ID);
    } finally {
      await runtime.shutdown();
    }
  });

  it("runs solver -> verify -> select-champion -> deliver through the real use cases and completes the job", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId, jobId } = await createProjectMissionJob(base, "happy");

      const response = await command(base, "job.execute", "idem-exec-1", { jobId });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          job: { id: string; status: string; progress: number };
          candidate: { id: string; missionId: string };
          verification: { status: string; mandatoryChecksPassed: number };
          decision: { decision: string; missionId: string };
          receipt: { missionId: string; decision: string } | null;
        };
      };

      expect(body.result.job.status).toBe("completed");
      expect(body.result.job.progress).toBe(1);
      expect(body.result.candidate.missionId).toBe(missionId);
      expect(body.result.verification.status).toBe("passed");
      expect(body.result.decision.decision).toBe("champion");
      expect(body.result.receipt).not.toBeNull();
      expect(body.result.receipt?.missionId).toBe(missionId);

      const jobReadBack = await record(base, "job", jobId);
      const jobRecord = (await jobReadBack.json()) as { record: { value: { status: string } } };
      expect(jobRecord.record.value.status).toBe("completed");
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("rejects job.execute for a job that does not exist", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await command(base, "job.execute", "idem-exec-2", {
        jobId: "job-does-not-exist",
      });
      expect(response.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });

  it("fails closed (409) on a second job.execute against an already-completed job", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { jobId } = await createProjectMissionJob(base, "repeat");
      const first = await command(base, "job.execute", "idem-exec-3a", { jobId });
      expect(first.status).toBe(200);

      const second = await command(base, "job.execute", "idem-exec-3b", { jobId });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("replays the exact result for a repeated key+payload after the job has already completed", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { jobId } = await createProjectMissionJob(base, "replay");
      const payload = { jobId };

      const first = await command(base, "job.execute", "idem-exec-replay", payload);
      expect(first.status).toBe(200);
      const firstBody = await first.json();

      // Same actor+key+payload after the job is already completed: true idempotent replay must
      // return the original recorded result, not fail closed on the job's terminal status.
      const second = await command(base, "job.execute", "idem-exec-replay", payload);
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody).toEqual(firstBody);
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("collapses concurrent job.execute calls for the same job into exactly one execution", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { jobId } = await createProjectMissionJob(base, "race");

      // Two different idempotency keys targeting the same job, fired concurrently: the atomic
      // claim step must let exactly one proceed to the solver/verify/champion/deliver chain and
      // reject the other with CONFLICT before it duplicates any kernel/model/verifier/candidate/
      // evidence/decision/receipt effect - not just at the final completion write.
      const [a, b] = await Promise.all([
        command(base, "job.execute", "idem-exec-race-a", { jobId }),
        command(base, "job.execute", "idem-exec-race-b", { jobId }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const winner = a.status === 200 ? a : b;
      const loser = a.status === 200 ? b : a;
      const winnerBody = (await winner.json()) as { result: { candidate: { id: string } } };
      expect(winnerBody.result.candidate.id).toBeTruthy();
      const loserBody = (await loser.json()) as { error: { code: string } };
      expect(loserBody.error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("survives a restart: retrying the same key+payload after a restart replays the completed result", async () => {
    const first = await startTestRuntime();
    const { jobId } = await createProjectMissionJob(first.base, "exec-restart");
    const payload = { jobId };

    const before = await command(first.base, "job.execute", "idem-exec-restart", payload);
    expect(before.status).toBe(200);
    const beforeBody = await before.json();

    await first.runtime.shutdown();

    const second: RunningRuntime = await startRuntime(testConfig(first.databasePath));
    const secondBase = `http://127.0.0.1:${second.address.port}`;
    try {
      const after = await command(secondBase, "job.execute", "idem-exec-restart", payload);
      expect(after.status).toBe(200);
      const afterBody = await after.json();
      expect(afterBody).toEqual(beforeBody);
    } finally {
      await second.shutdown();
    }
  }, 15_000);

  it("fails closed on a retry against a job left claimed by an interrupted execution", async () => {
    const { runtime, base, databasePath } = await startTestRuntime();
    try {
      const { jobId } = await createProjectMissionJob(base, "crashed");

      // Simulate a process crash between the atomic claim transaction (which durably commits
      // currentStage: "executing" before any external effect runs) and the completing transaction
      // (which never ran, and is the only place the claim is cleared): write exactly that
      // persisted state directly. This is exactly what a real crash leaves on disk - a committed
      // claim with no completion record - not a synthetic shortcut.
      const raw = new DatabaseSync(databasePath);
      try {
        const row = raw
          .prepare("SELECT body FROM records WHERE record_type = 'job' AND record_id = ?")
          .get(jobId) as { body: string };
        const job = JSON.parse(row.body) as { currentStage: string };
        job.currentStage = "executing";
        raw
          .prepare("UPDATE records SET body = ? WHERE record_type = 'job' AND record_id = ?")
          .run(JSON.stringify(job), jobId);
      } finally {
        raw.close();
      }

      const retry = await command(base, "job.execute", "idem-exec-crash-retry", { jobId });
      expect(retry.status).toBe(409);
      const body = (await retry.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  });
});
