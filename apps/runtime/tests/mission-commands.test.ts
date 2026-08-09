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
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-mission-cmd-")), "state.db");
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

async function createTestProject(base: string, idempotencyKey: string): Promise<string> {
  const response = await command(base, "project.create", idempotencyKey, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${idempotencyKey}`,
    name: "Mission Test Project",
    rootPath: "mission-test-project",
  });
  const body = (await response.json()) as { result: { project: { id: string } } };
  return body.result.project.id;
}

function validMissionPayload(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: "req-mission-1",
    projectId,
    title: "Demo Mission",
    objective: "Prove the vertical slice works end to end.",
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
    ...overrides,
  };
}

describe("mission.submit command", () => {
  it("submits a real mission against a real project and is readable back", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const projectId = await createTestProject(base, "idem-project-1");
      const response = await command(
        base,
        "mission.submit",
        "idem-mission-1",
        validMissionPayload(projectId),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { mission: { id: string; projectId: string; title: string; revision: number } };
      };
      expect(body.result.mission.projectId).toBe(projectId);
      expect(body.result.mission.title).toBe("Demo Mission");
      expect(body.result.mission.revision).toBe(1);

      const readBack = await fetch(`${base}/records/mission/${body.result.mission.id}`, {
        headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      });
      expect(readBack.status).toBe(200);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects a mission for a project that does not exist", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const response = await command(
        base,
        "mission.submit",
        "idem-mission-2",
        validMissionPayload("project-does-not-exist"),
      );
      expect(response.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects a mission whose mandatory acceptance criterion has no evidence requirement", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const projectId = await createTestProject(base, "idem-project-3");
      const response = await command(
        base,
        "mission.submit",
        "idem-mission-3",
        validMissionPayload(projectId, { evidenceRequirements: [] }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_APPLICATION_INPUT");
    } finally {
      await runtime.shutdown();
    }
  });

  it("is idempotent: a repeated actor+key+payload does not create a duplicate mission", async () => {
    const { runtime, base } = await startTestRuntime();
    try {
      const projectId = await createTestProject(base, "idem-project-4");
      const payload = validMissionPayload(projectId);
      const first = await command(base, "mission.submit", "idem-mission-4", payload);
      const firstBody = (await first.json()) as { result: { mission: { id: string } } };
      const second = await command(base, "mission.submit", "idem-mission-4", payload);
      const secondBody = (await second.json()) as { result: { mission: { id: string } } };
      expect(secondBody.result.mission.id).toBe(firstBody.result.mission.id);
    } finally {
      await runtime.shutdown();
    }
  });
});
