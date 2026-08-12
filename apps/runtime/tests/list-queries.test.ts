import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

function testConfig(databasePath: string): RuntimeConfig {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
}

async function boot(databasePath: string): Promise<{ runtime: RunningRuntime; base: string }> {
  const runtime = await startRuntime(testConfig(databasePath));
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

function query(base: string, type: string, body: unknown, token = OPERATOR_TOKEN) {
  return fetch(`${base}/queries/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function resultOf<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: T }).result;
}

async function createProject(base: string, key: string): Promise<string> {
  const result = await resultOf<{ project: { id: string } }>(
    await command(base, "project.create", `${key}-project`, {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: `req-${key}-project`,
      name: `${key} Project`,
      rootPath: `${key}-project`,
    }),
  );
  return result.project.id;
}

async function submitMission(base: string, key: string, projectId: string): Promise<string> {
  const result = await resultOf<{ mission: { id: string } }>(
    await command(base, "mission.submit", `${key}-mission`, {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: `req-${key}-mission`,
      projectId,
      title: `${key} Mission`,
      objective: `Prove persisted query behavior for ${key}.`,
      requiredOutputs: [{ id: `${key}-output`, kind: "code", description: "A working feature." }],
      requirements: [
        {
          id: `${key}-requirement`,
          statement: "Must return authoritative state.",
          priority: "required",
          source: "user",
        },
      ],
      constraints: [],
      acceptanceCriteria: [
        {
          id: `${key}-criterion`,
          statement: "Output artifact exists.",
          verificationMethod: "Reference verifier checks artifact presence.",
          mandatory: true,
        },
      ],
      forbiddenChanges: [],
      evidenceRequirements: [
        { criterionId: `${key}-criterion`, requiredEvidenceKinds: ["unit_test"] },
      ],
      resourceBudget: {
        maxWallClockMs: 60_000,
        maxModelInvocations: 10,
        maxToolInvocations: 10,
        maxRepairRounds: 1,
        maxConcurrentWorkers: 1,
      },
    }),
  );
  return result.mission.id;
}

async function startAndExecuteJob(
  base: string,
  key: string,
  missionId: string,
): Promise<{ jobId: string; candidateId: string; evidenceIds: readonly string[] }> {
  const started = await resultOf<{ job: { id: string } }>(
    await command(base, "job.start", `${key}-job-start`, {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: `req-${key}-job-start`,
      missionId,
      workflowId: "default-workflow",
    }),
  );
  const executed = await resultOf<{
    candidate: { id: string };
    verification: { evidenceIds: readonly string[] };
  }>(await command(base, "job.execute", `${key}-job-execute`, { jobId: started.job.id }));
  return {
    jobId: started.job.id,
    candidateId: executed.candidate.id,
    evidenceIds: executed.verification.evidenceIds,
  };
}

function metadata(requestId: string) {
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, requestId } as const;
}

describe("persisted list query surface", () => {
  it("fails closed, validates input, and returns empty collections for valid empty boundaries", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-list-empty-")), "state.db");
    const { runtime, base } = await boot(databasePath);
    try {
      const unauthorized = await fetch(`${base}/queries/mission.list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...metadata("req-unauthorized"),
          projectId: "project:missing",
          pagination: { limit: 10 },
        }),
      });
      expect(unauthorized.status).toBe(403);
      expect(((await unauthorized.json()) as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );

      const invalid = await query(base, "mission.list", {
        ...metadata("req-invalid"),
        pagination: { limit: 10 },
      });
      expect(invalid.status).toBe(400);
      expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
        "INVALID_APPLICATION_INPUT",
      );

      const projectId = await createProject(base, "empty");
      const missions = await resultOf<{
        missions: readonly unknown[];
        pagination: { total: number; nextCursor?: string };
      }>(
        await query(base, "mission.list", {
          ...metadata("req-empty-missions"),
          projectId,
          pagination: { limit: 10 },
        }),
      );
      expect(missions).toMatchObject({ missions: [], pagination: { total: 0 } });

      const jobs = await resultOf<{ jobs: readonly unknown[]; pagination: { total: number } }>(
        await query(base, "job.list", {
          ...metadata("req-empty-jobs"),
          projectId,
          pagination: { limit: 10 },
        }),
      );
      expect(jobs).toMatchObject({ jobs: [], pagination: { total: 0 } });

      const evidence = await resultOf<{
        evidence: readonly unknown[];
        pagination: { total: number };
      }>(
        await query(base, "evidence.list", {
          ...metadata("req-empty-evidence"),
          projectId,
          pagination: { limit: 10 },
        }),
      );
      expect(evidence).toMatchObject({ evidence: [], pagination: { total: 0 } });

      const missionId = await submitMission(base, "empty", projectId);
      const candidates = await resultOf<{
        candidates: readonly unknown[];
        pagination: { total: number };
      }>(
        await query(base, "candidate.list", {
          ...metadata("req-empty-candidates"),
          projectId,
          missionId,
          pagination: { limit: 10 },
        }),
      );
      expect(candidates).toMatchObject({ candidates: [], pagination: { total: 0 } });

      const malformedCursor = await query(base, "mission.list", {
        ...metadata("req-malformed-cursor"),
        projectId,
        pagination: { limit: 10, cursor: "1junk" },
      });
      expect(malformedCursor.status).toBe(400);
    } finally {
      await runtime.shutdown();
    }
  });

  it("keeps project relationships isolated and returns the same persisted state after restart", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-list-restart-")), "state.db");
    let running: RunningRuntime | undefined;
    try {
      let started = await boot(databasePath);
      running = started.runtime;

      // Persist the unrelated project first. A repository that paginates before applying its
      // relationship predicate will return an empty first page or leak this project's total.
      const projectB = await createProject(started.base, "bravo");
      const missionB = await submitMission(started.base, "bravo", projectB);
      const executionB = await startAndExecuteJob(started.base, "bravo", missionB);

      const projectA = await createProject(started.base, "alpha");
      const missionA1 = await submitMission(started.base, "alpha-one", projectA);
      const missionA2 = await submitMission(started.base, "alpha-two", projectA);
      const executionA = await startAndExecuteJob(started.base, "alpha", missionA1);

      const missionPage1 = await resultOf<{
        missions: readonly { id: string; projectId: string }[];
        pagination: { total: number; nextCursor?: string };
      }>(
        await query(started.base, "mission.list", {
          ...metadata("req-missions-page-1"),
          projectId: projectA,
          pagination: { limit: 1 },
        }),
      );
      expect(missionPage1.missions.map((mission) => mission.id)).toEqual([missionA1]);
      expect(missionPage1.missions[0]?.projectId).toBe(projectA);
      expect(missionPage1.pagination).toEqual({ total: 2, nextCursor: "1" });

      const missionPage2 = await resultOf<{
        missions: readonly { id: string }[];
        pagination: { total: number; nextCursor?: string };
      }>(
        await query(started.base, "mission.list", {
          ...metadata("req-missions-page-2"),
          projectId: projectA,
          pagination: { limit: 1, cursor: "1" },
        }),
      );
      expect(missionPage2.missions.map((mission) => mission.id)).toEqual([missionA2]);
      expect(missionPage2.pagination).toEqual({ total: 2 });

      const missionOffsetPage = await resultOf<{ missions: readonly { id: string }[] }>(
        await query(started.base, "mission.list", {
          ...metadata("req-missions-offset"),
          projectId: projectA,
          pagination: { limit: 1, offset: 1 },
        }),
      );
      expect(missionOffsetPage.missions.map((mission) => mission.id)).toEqual([missionA2]);

      const jobsByProject = await resultOf<{
        jobs: readonly { id: string; projectId: string; missionId: string }[];
        pagination: { total: number };
      }>(
        await query(started.base, "job.list", {
          ...metadata("req-jobs-project"),
          projectId: projectA,
          pagination: { limit: 1 },
        }),
      );
      expect(jobsByProject.jobs).toEqual([
        expect.objectContaining({
          id: executionA.jobId,
          projectId: projectA,
          missionId: missionA1,
        }),
      ]);
      expect(jobsByProject.pagination.total).toBe(1);

      const jobsByMission = await resultOf<{ jobs: readonly { id: string }[] }>(
        await query(started.base, "job.list", {
          ...metadata("req-jobs-mission"),
          missionId: missionA1,
          pagination: { limit: 10 },
        }),
      );
      expect(jobsByMission.jobs.map((job) => job.id)).toEqual([executionA.jobId]);

      const candidates = await resultOf<{
        candidates: readonly { id: string; missionId: string }[];
        pagination: { total: number };
      }>(
        await query(started.base, "candidate.list", {
          ...metadata("req-candidates"),
          projectId: projectA,
          missionId: missionA1,
          pagination: { limit: 1 },
        }),
      );
      expect(candidates.candidates).toEqual([
        expect.objectContaining({ id: executionA.candidateId, missionId: missionA1 }),
      ]);
      expect(candidates.pagination.total).toBe(1);

      const evidence = await resultOf<{
        evidence: readonly { id: string; projectId: string; subjectId: string }[];
        pagination: { total: number };
      }>(
        await query(started.base, "evidence.list", {
          ...metadata("req-evidence"),
          projectId: projectA,
          pagination: { limit: 1 },
        }),
      );
      expect(evidence.evidence.map((entry) => entry.id)).toEqual(executionA.evidenceIds);
      expect(evidence.evidence[0]).toMatchObject({
        projectId: projectA,
        subjectId: executionA.candidateId,
      });
      expect(evidence.pagination.total).toBe(executionA.evidenceIds.length);

      for (const [type, payload] of [
        [
          "job.list",
          {
            ...metadata("req-cross-job"),
            projectId: projectA,
            missionId: missionB,
            pagination: { limit: 10 },
          },
        ],
        [
          "candidate.list",
          {
            ...metadata("req-cross-candidate"),
            projectId: projectA,
            missionId: missionB,
            pagination: { limit: 10 },
          },
        ],
        [
          "evidence.list",
          {
            ...metadata("req-cross-evidence"),
            projectId: projectA,
            jobId: executionB.jobId,
            pagination: { limit: 10 },
          },
        ],
      ] as const) {
        const crossed = await query(started.base, type, payload);
        expect(crossed.status).toBe(404);
        expect(((await crossed.json()) as { error: { code: string } }).error.code).toBe(
          "NOT_FOUND",
        );
      }

      await running.shutdown();
      running = undefined;
      started = await boot(databasePath);
      running = started.runtime;

      const recoveredMissions = await resultOf<{ missions: readonly { id: string }[] }>(
        await query(started.base, "mission.list", {
          ...metadata("req-recovered-missions"),
          projectId: projectA,
          pagination: { limit: 10 },
        }),
      );
      expect(recoveredMissions.missions.map((mission) => mission.id)).toEqual([
        missionA1,
        missionA2,
      ]);

      const recoveredJobs = await resultOf<{ jobs: readonly { id: string }[] }>(
        await query(started.base, "job.list", {
          ...metadata("req-recovered-jobs"),
          projectId: projectA,
          pagination: { limit: 10 },
        }),
      );
      expect(recoveredJobs.jobs.map((job) => job.id)).toEqual([executionA.jobId]);

      const recoveredCandidates = await resultOf<{ candidates: readonly { id: string }[] }>(
        await query(started.base, "candidate.list", {
          ...metadata("req-recovered-candidates"),
          projectId: projectA,
          missionId: missionA1,
          pagination: { limit: 10 },
        }),
      );
      expect(recoveredCandidates.candidates.map((candidate) => candidate.id)).toEqual([
        executionA.candidateId,
      ]);

      const recoveredEvidence = await resultOf<{ evidence: readonly { id: string }[] }>(
        await query(started.base, "evidence.list", {
          ...metadata("req-recovered-evidence"),
          projectId: projectA,
          pagination: { limit: 10 },
        }),
      );
      expect(recoveredEvidence.evidence.map((entry) => entry.id)).toEqual(executionA.evidenceIds);

      for (const [recordType, recordId] of [
        ["mission", missionA1],
        ["job", executionA.jobId],
        ["candidate", executionA.candidateId],
        ["evidence", executionA.evidenceIds[0] as string],
      ]) {
        const readBack = await fetch(`${started.base}/records/${recordType}/${recordId}`, {
          headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
        });
        expect(readBack.status).toBe(200);
        const body = (await readBack.json()) as { record: { recordId: string } };
        expect(body.record.recordId).toBe(recordId);
      }

      expect(executionB.candidateId).not.toBe(executionA.candidateId);
    } finally {
      await running?.shutdown();
    }
  }, 30_000);
});
