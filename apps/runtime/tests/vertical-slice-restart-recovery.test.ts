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
        candidate: { id: string; missionId: string };
        verification: { status: string; evidenceIds: readonly string[] };
        decision: { id: string };
        receipt: { id: string } | null;
      };
    };
    const { candidate, verification, decision, receipt } = executeBody.result;
    expect(verification.status).toBe("passed");
    expect(receipt).not.toBeNull();
    expect(candidate.missionId).toBe(missionId);

    // Evidence is a concrete, independently durable record - not just a field embedded in the
    // job.execute response - so its persistence must be proven the same way project/mission/job/
    // candidate/decision/receipt already are: read back by its own id, not inferred from the
    // command response that produced it.
    const evidenceId = verification.evidenceIds[0];
    expect(typeof evidenceId).toBe("string");
    expect((evidenceId ?? "").length).toBeGreaterThan(0);
    if (evidenceId === undefined) throw new Error("unreachable: asserted above");

    const evidenceBefore = await record(firstBase, "evidence", evidenceId);
    expect(evidenceBefore.status).toBe(200);
    const evidenceBeforeValue = (
      evidenceBefore.body as {
        record: {
          value: {
            id: string;
            projectId: string;
            subjectType: string;
            subjectId: string;
            kind: string;
            status: string;
            artifactIds: readonly string[];
            createdAt: string;
          };
        };
      }
    ).record.value;
    expect(evidenceBeforeValue.id).toBe(evidenceId);
    expect(evidenceBeforeValue.projectId).toBe(projectId);
    // EvidenceRecord's current architecture links evidence to its project and the candidate it
    // verified (subjectType/subjectId), not to a missionId field of its own; mission linkage is
    // proven transitively through that candidate, whose own missionId is asserted above.
    expect(evidenceBeforeValue.subjectType).toBe("candidate");
    expect(evidenceBeforeValue.subjectId).toBe(candidate.id);
    expect(evidenceBeforeValue.status).toBe("passed");
    expect(evidenceBeforeValue.kind.length).toBeGreaterThan(0);
    expect(evidenceBeforeValue.artifactIds.length).toBeGreaterThan(0);
    expect(evidenceBeforeValue.createdAt.length).toBeGreaterThan(0);

    // The evidence contract requires at least one referenced artifact; prove that reference
    // actually resolves to a durable artifact record, not a dangling id.
    const artifactId = evidenceBeforeValue.artifactIds[0];
    if (artifactId === undefined) throw new Error("unreachable: asserted length above");
    const artifactBefore = await record(firstBase, "artifact", artifactId);
    expect(artifactBefore.status).toBe(200);
    const artifactBeforeValue = (
      artifactBefore.body as { record: { value: { id: string; contentHash: string } } }
    ).record.value;
    expect(artifactBeforeValue.id).toBe(artifactId);

    // A definitely-nonexistent evidence id must fail closed, not fabricate a record.
    const missingEvidenceBefore = await record(firstBase, "evidence", "evidence-does-not-exist");
    expect(missingEvidenceBefore.status).toBe(404);

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

      // Same evidenceId, against the brand-new instance's fresh in-memory state: read back
      // independently of the job.execute response that originally produced it, and confirm every
      // critical field survived the restart unchanged.
      const evidenceAfter = await record(secondBase, "evidence", evidenceId);
      expect(evidenceAfter.status).toBe(200);
      const evidenceAfterValue = (
        evidenceAfter.body as {
          record: {
            value: {
              id: string;
              projectId: string;
              subjectType: string;
              subjectId: string;
              status: string;
              artifactIds: readonly string[];
              createdAt: string;
            };
          };
        }
      ).record.value;
      expect(evidenceAfterValue.id).toBe(evidenceBeforeValue.id);
      expect(evidenceAfterValue.projectId).toBe(evidenceBeforeValue.projectId);
      expect(evidenceAfterValue.subjectType).toBe(evidenceBeforeValue.subjectType);
      expect(evidenceAfterValue.subjectId).toBe(evidenceBeforeValue.subjectId);
      expect(evidenceAfterValue.status).toBe(evidenceBeforeValue.status);
      expect(evidenceAfterValue.artifactIds).toEqual(evidenceBeforeValue.artifactIds);
      expect(evidenceAfterValue.createdAt).toBe(evidenceBeforeValue.createdAt);

      // The artifact the evidence references must still resolve after restart, by the same id and
      // with the same content hash - proving the linkage survives, not just the evidence row.
      const artifactAfter = await record(secondBase, "artifact", artifactId);
      expect(artifactAfter.status).toBe(200);
      const artifactAfterValue = (
        artifactAfter.body as { record: { value: { id: string; contentHash: string } } }
      ).record.value;
      expect(artifactAfterValue.id).toBe(artifactBeforeValue.id);
      expect(artifactAfterValue.contentHash).toBe(artifactBeforeValue.contentHash);

      // Restart must not fabricate a record for an id that never existed, either.
      const missingEvidenceAfter = await record(secondBase, "evidence", "evidence-does-not-exist");
      expect(missingEvidenceAfter.status).toBe(404);
    } finally {
      await second.shutdown();
    }
  }, 20_000);
});
