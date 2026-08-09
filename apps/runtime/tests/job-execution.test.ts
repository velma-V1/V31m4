import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

interface TestRuntime {
  readonly runtime: RunningRuntime;
  readonly base: string;
}

async function startTestRuntime(): Promise<TestRuntime> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-job-exec-")), "state.db");
  const config = createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
  const runtime = await startRuntime(config);
  return { runtime, base: `http://127.0.0.1:${runtime.address.port}` };
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
});
