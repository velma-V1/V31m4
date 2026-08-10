import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";

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

async function startTestRuntime(): Promise<TestRuntime> {
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-job-cmd-")), "state.db");
  const runtime = await startRuntime(testConfig(databasePath));
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

  it("rejects reusing an idempotency key with a different payload as CONFLICT, not the first job", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId: missionA } = await createProjectAndMission(base, "conflict-a");
      const { missionId: missionB } = await createProjectAndMission(base, "conflict-b");

      const first = await command(base, "job.start", "idem-job-conflict", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-conflict-a",
        missionId: missionA,
        workflowId: "default-workflow",
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        result: { job: { id: string; missionId: string } };
      };
      expect(firstBody.result.job.missionId).toBe(missionA);

      // Same idempotency key, different missionId: must be rejected as a genuine conflict, never
      // silently answered with the first call's job (the bug this repair fixes).
      const second = await command(base, "job.start", "idem-job-conflict", {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-conflict-b",
        missionId: missionB,
        workflowId: "default-workflow",
      });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as { error: { code: string } };
      expect(secondBody.error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects reusing an idempotency key across a different command type as CONFLICT", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId } = await createProjectAndMission(base, "cross-type");
      const sharedKey = "idem-cross-command-type";

      const projectResponse = await command(base, "project.create", sharedKey, {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-cross-type-project",
        name: "Cross Type Project",
        rootPath: "cross-type-project",
      });
      expect(projectResponse.status).toBe(200);

      // The same actor+key was already recorded against project.create; reusing it for job.start
      // must be rejected, proving idempotency identity spans command type, not just payload shape.
      const jobResponse = await command(base, "job.start", sharedKey, {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-cross-type-job",
        missionId,
        workflowId: "default-workflow",
      });
      expect(jobResponse.status).toBe(409);
      const jobBody = (await jobResponse.json()) as { error: { code: string } };
      expect(jobBody.error.code).toBe("CONFLICT");
    } finally {
      await runtime.shutdown();
    }
  });

  it("collapses concurrent identical retries (same key, same payload) into exactly one job", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const { missionId } = await createProjectAndMission(base, "concurrent");
      const payload = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "req-job-concurrent",
        missionId,
        workflowId: "default-workflow",
      };
      const [first, second] = await Promise.all([
        command(base, "job.start", "idem-job-concurrent", payload),
        command(base, "job.start", "idem-job-concurrent", payload),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = (await first.json()) as { result: { job: { id: string } } };
      const secondBody = (await second.json()) as { result: { job: { id: string } } };
      expect(secondBody.result.job.id).toBe(firstBody.result.job.id);
    } finally {
      await runtime.shutdown();
    }
  });

  it("survives a restart: retrying the same key after a restart returns the original job, not a duplicate", async () => {
    const first = await startTestRuntime();
    const { missionId } = await createProjectAndMission(first.base, "restart");
    const payload = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: "req-job-restart",
      missionId,
      workflowId: "default-workflow",
    };
    const before = await command(first.base, "job.start", "idem-job-restart", payload);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { result: { job: { id: string } } };

    await first.runtime.shutdown();

    const second: RunningRuntime = await startRuntime(testConfig(first.databasePath));
    const secondBase = `http://127.0.0.1:${second.address.port}`;
    try {
      const after = await command(secondBase, "job.start", "idem-job-restart", payload);
      expect(after.status).toBe(200);
      const afterBody = (await after.json()) as { result: { job: { id: string } } };
      expect(afterBody.result.job.id).toBe(beforeBody.result.job.id);
    } finally {
      await second.shutdown();
    }
  });
});
