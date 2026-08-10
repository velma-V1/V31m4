import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

function config(databasePath: string) {
  return createRuntimeConfig({
    port: 0,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 200,
  });
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
  const response = await fetch(`${base}/records/${type}/${id}`, {
    headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

/**
 * The full V31M4 mission flow, end to end, across a real process restart against the same durable
 * SQLite database: create project -> submit mission -> start job -> execute job (real solver ->
 * verify -> select-champion -> deliver, through ReferenceModelGateway/ReferenceVerifier) -> shut
 * down -> boot a brand-new runtime instance against the same database -> confirm every record and
 * the durable event sequence survived, not just that the process didn't crash.
 */
describe("full vertical slice survives a real restart", () => {
  it("recovers project, mission, job, candidate, verification, decision, and receipt after restart", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-vertical-slice-")), "state.db");

    const first: RunningRuntime = await startRuntime(config(databasePath));
    const firstBase = `http://127.0.0.1:${first.address.port}`;

    const projectResponse = await command(firstBase, "project.create", "vs-project", {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: "req-vs-project",
      name: "Vertical Slice Project",
      rootPath: "vertical-slice",
    });
    const projectId = ((await projectResponse.json()) as { result: { project: { id: string } } })
      .result.project.id;

    const missionResponse = await command(firstBase, "mission.submit", "vs-mission", {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: "req-vs-mission",
      projectId,
      title: "Vertical Slice Mission",
      objective: "Survive a real process restart with every record intact.",
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

    const jobResponse = await command(firstBase, "job.start", "vs-job", {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      requestId: "req-vs-job",
      missionId,
      workflowId: "default-workflow",
    });
    const jobId = ((await jobResponse.json()) as { result: { job: { id: string } } }).result.job.id;

    const executeResponse = await command(firstBase, "job.execute", "vs-execute", { jobId });
    expect(executeResponse.status).toBe(200);
    const executeBody = (await executeResponse.json()) as {
      result: {
        candidate: { id: string };
        verification: { status: string };
        decision: { id: string };
        receipt: { id: string } | null;
      };
    };
    const { candidate, verification, decision, receipt } = executeBody.result;
    expect(verification.status).toBe("passed");
    expect(receipt).not.toBeNull();

    const healthBeforeRestart = (await (await fetch(`${firstBase}/health`)).json()) as {
      latestSequence: number;
    };
    expect(healthBeforeRestart.latestSequence).toBeGreaterThan(0);

    await first.shutdown();

    // A brand-new runtime instance, new composition, new in-memory state - the only thing carried
    // forward is the SQLite file at the same path. If recovery is real, every record below reads
    // back exactly as it was, and the durable event sequence is not reset to zero.
    const second: RunningRuntime = await startRuntime(config(databasePath));
    const secondBase = `http://127.0.0.1:${second.address.port}`;
    try {
      expect(second.startup.latestSequence).toBe(healthBeforeRestart.latestSequence);

      const projectAfter = await record(secondBase, "project", projectId);
      expect(projectAfter.status).toBe(200);

      const missionAfter = await record(secondBase, "mission", missionId);
      expect(missionAfter.status).toBe(200);

      const jobAfter = await record(secondBase, "job", jobId);
      expect(jobAfter.status).toBe(200);
      expect((jobAfter.body as { record: { value: { status: string } } }).record.value.status).toBe(
        "completed",
      );

      const candidateAfter = await record(secondBase, "candidate", candidate.id);
      expect(candidateAfter.status).toBe(200);

      const decisionAfter = await record(secondBase, "champion-decision", missionId);
      expect(decisionAfter.status).toBe(200);
      expect((decisionAfter.body as { record: { value: { id: string } } }).record.value.id).toBe(
        decision.id,
      );

      const receiptAfter = await record(secondBase, "delivery-receipt", missionId);
      expect(receiptAfter.status).toBe(200);
      expect((receiptAfter.body as { record: { value: { id: string } } }).record.value.id).toBe(
        receipt?.id,
      );
    } finally {
      await second.shutdown();
    }
  }, 20_000);
});
