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
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-job-cmd-")), "state.db");
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

async function createProjectAndMission(
  base: string,
  keyPrefix: string,
): Promise<{ projectId: string; missionId: string }> {
  const projectResponse = await command(base, "project.create", `${keyPrefix}-project`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-project`,
    name: "Job Test Project",
    rootPath: `${keyPrefix}-project`,
  });
  const projectBody = (await projectResponse.json()) as { result: { project: { id: string } } };
  const projectId = projectBody.result.project.id;

  const missionResponse = await command(base, "mission.submit", `${keyPrefix}-mission`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-mission`,
    projectId,
    title: "Job Test Mission",
    objective: "Prove job.start works end to end.",
    requiredOutputs: [{ id: "output-1", kind: "code", description: "A working feature." }],
    requirements: [
      { id: "requirement-1", statement: "Must compile.", priority: "required", source: "user" },
    ],
    constraints: [],
    acceptanceCriteria: [
      {
        id: "criterion-1",
        statement: "Tests pass.",
        verificationMethod: "Run the test suite.",
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
  const missionBody = (await missionResponse.json()) as { result: { mission: { id: string } } };
  return { projectId, missionId: missionBody.result.mission.id };
}

describe("job.start command", () => {
  it("starts a real job against a real mission through the reference production kernel", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId } = await createProjectAndMission(base, "happy");
      const response = await command(base, "job.start", "idem-job-1", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-1",
        missionId,
        workflowId: "default-workflow",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { job: { id: string; missionId: string; status: string } };
      };
      expect(body.result.job.missionId).toBe(missionId);
      expect(body.result.job.status).toBe("running");

      const readBack = await fetch(`${base}/records/job/${body.result.job.id}`, {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      });
      expect(readBack.status).toBe(200);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects a job for a mission that does not exist", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await command(base, "job.start", "idem-job-2", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-2",
        missionId: "mission-does-not-exist",
        workflowId: "default-workflow",
      });
      expect(response.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });

  it("is idempotent via the deterministic-jobId + conflict-recovery path, not a duplicate job", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId } = await createProjectAndMission(base, "idem");
      const payload = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-3",
        missionId,
        workflowId: "default-workflow",
      };
      const first = await command(base, "job.start", "idem-job-3", payload);
      const firstBody = (await first.json()) as { result: { job: { id: string } } };

      const second = await command(base, "job.start", "idem-job-3", payload);
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { result: { job: { id: string } } };
      expect(secondBody.result.job.id).toBe(firstBody.result.job.id);

      // A different idempotency key against the same mission must produce a different job.
      const third = await command(base, "job.start", "idem-job-3-different", payload);
      const thirdBody = (await third.json()) as { result: { job: { id: string } } };
      expect(thirdBody.result.job.id).not.toBe(firstBody.result.job.id);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects a malformed job.start payload with INVALID_APPLICATION_INPUT", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await command(base, "job.start", "idem-job-4", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-4",
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_APPLICATION_INPUT");
    } finally {
      await runtime.shutdown();
    }
  });
});
