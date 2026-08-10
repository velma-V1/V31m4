import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ArtifactStorePort,
  OperationContext,
  VerificationExecutionResult,
  VerifierPort,
} from "@v31m4/application";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import {
  EvidenceId,
  type EvidenceRecord,
  type ProjectId,
  type SolverCandidate,
  type VerificationPlan,
  type VerificationResult,
  VerificationResultId,
} from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import type { CompositionOverrides } from "../src/composition-root.js";
import { createRuntimeConfig, type RuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

/**
 * TEST-ONLY deterministic verifier: forces every mandatory check to a fixed non-passing status
 * ("failed" or "inconclusive"), regardless of the candidate's real output artifacts, so the
 * negative-verification path can be exercised without making the real `ReferenceVerifier`
 * randomly fail or environment-dependent. Wired in only via `CompositionOverrides.verifierFactory`
 * (see composition-root.ts), which is never populated from `RuntimeConfig`, the environment, or
 * any HTTP-facing input, so this can never activate in normal runtime operation. Must never be
 * represented as, or confused with, real production verification.
 */
class ForcedResultVerifier implements VerifierPort {
  constructor(
    private readonly projectId: ProjectId,
    private readonly status: "failed" | "inconclusive",
  ) {}

  async supports(): Promise<boolean> {
    return true;
  }

  async execute(
    plan: VerificationPlan,
    candidate: SolverCandidate,
    _context: OperationContext,
  ): Promise<VerificationExecutionResult> {
    const evidence: EvidenceRecord[] = plan.checks.map((check) =>
      Object.freeze({
        id: EvidenceId.parse(`evidence-${randomUUID()}`),
        projectId: this.projectId,
        kind: "static_analysis" as const,
        subjectType: "candidate" as const,
        subjectId: candidate.id,
        status: this.status,
        summary: `Test-only forced '${this.status}' result for check '${check.id}'.`,
        artifactIds: Object.freeze([]),
        verifierId: "test-only-forced-result-verifier",
        verifierVersion: "0.0.0",
        createdAt: new Date().toISOString(),
        immutable: true as const,
      }),
    );
    const result: VerificationResult = Object.freeze({
      id: VerificationResultId.parse(`verification-${randomUUID()}`),
      planId: plan.id,
      candidateId: candidate.id,
      status: this.status,
      evidenceIds: Object.freeze(evidence.map((entry) => entry.id)),
      mandatoryChecksPassed: 0,
      mandatoryChecksTotal: plan.checks.length,
      optionalChecksPassed: 0,
      optionalChecksTotal: 0,
    });
    return Object.freeze({ candidateId: candidate.id, result, evidence: Object.freeze(evidence) });
  }

  async cancel(): Promise<void> {}
}

function failingVerifierOverrides(
  status: "failed" | "inconclusive" = "failed",
): CompositionOverrides {
  return {
    verifierFactory: (_artifacts: ArtifactStorePort, projectId: ProjectId) =>
      new ForcedResultVerifier(projectId, status),
  };
}

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
  const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-job-exec-neg-")), "state.db");
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
    name: "Negative Verification Test Project",
    rootPath: `${keyPrefix}-project`,
  });
  const projectId = ((await projectResponse.json()) as { result: { project: { id: string } } })
    .result.project.id;

  const missionResponse = await command(base, "mission.submit", `${keyPrefix}-mission`, {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: `req-${keyPrefix}-mission`,
    projectId,
    title: "Negative Verification Test Mission",
    objective: "Prove the no-verified-solution path when verification never passes.",
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

interface ExecuteBody {
  readonly result: {
    readonly job: { readonly id: string; readonly status: string; readonly progress: number };
    readonly candidate: { readonly id: string };
    readonly verification: {
      readonly status: string;
      readonly mandatoryChecksPassed: number;
      readonly mandatoryChecksTotal: number;
      readonly evidenceIds: readonly string[];
    };
    readonly decision: {
      readonly decision: string;
      readonly missionId: string;
      readonly candidateId?: string;
    };
    readonly receipt: { readonly missionId: string; readonly decision: string } | null;
  };
}

describe("job.execute negative-verification path (forced verification failure)", () => {
  it("NEGATIVE_1: a failed candidate cannot become champion", async () => {
    const { runtime, base } = await startTestRuntime(failingVerifierOverrides("failed"));
    try {
      const { jobId } = await createProjectMissionJob(base, "neg1");
      const response = await command(base, "job.execute", "idem-neg1", { jobId });
      expect(response.status).toBe(200);
      const body = (await response.json()) as ExecuteBody;

      expect(body.result.verification.status).toBe("failed");
      expect(body.result.decision.decision).not.toBe("champion");
      expect(body.result.decision.candidateId).toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("NEGATIVE_2: no verified solution does not deliver", async () => {
    const { runtime, base } = await startTestRuntime(failingVerifierOverrides("failed"));
    try {
      const { jobId, missionId } = await createProjectMissionJob(base, "neg2");
      const response = await command(base, "job.execute", "idem-neg2", { jobId });
      expect(response.status).toBe(200);
      const body = (await response.json()) as ExecuteBody;

      expect(body.result.decision.decision).toBe("no_verified_solution");
      expect(body.result.receipt).toBeNull();
      expect(body.result.job.status).toBe("failed");

      const receiptReadBack = await record(base, "delivery-receipt", missionId);
      expect(receiptReadBack.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("NEGATIVE_3: missing mandatory evidence (inconclusive verification) cannot silently pass", async () => {
    const { runtime, base } = await startTestRuntime(failingVerifierOverrides("inconclusive"));
    try {
      const { jobId, missionId } = await createProjectMissionJob(base, "neg3");
      const response = await command(base, "job.execute", "idem-neg3", { jobId });
      expect(response.status).toBe(200);
      const body = (await response.json()) as ExecuteBody;

      expect(body.result.verification.status).toBe("inconclusive");
      expect(body.result.verification.mandatoryChecksPassed).toBeLessThan(
        body.result.verification.mandatoryChecksTotal,
      );
      expect(body.result.decision.decision).toBe("no_verified_solution");
      expect(body.result.receipt).toBeNull();

      const receiptReadBack = await record(base, "delivery-receipt", missionId);
      expect(receiptReadBack.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("NEGATIVE_4: the negative result is durable (job, decision, evidence readable; no receipt)", async () => {
    const { runtime, base } = await startTestRuntime(failingVerifierOverrides("failed"));
    try {
      const { jobId, missionId } = await createProjectMissionJob(base, "neg4");
      const response = await command(base, "job.execute", "idem-neg4", { jobId });
      const body = (await response.json()) as ExecuteBody;
      expect(body.result.decision.decision).toBe("no_verified_solution");

      const jobReadBack = await record(base, "job", jobId);
      expect(jobReadBack.status).toBe(200);
      const jobRecord = (await jobReadBack.json()) as { record: { value: { status: string } } };
      expect(jobRecord.record.value.status).toBe("failed");

      const decisionReadBack = await record(base, "champion-decision", missionId);
      expect(decisionReadBack.status).toBe(200);
      const decisionRecord = (await decisionReadBack.json()) as {
        record: { value: { decision: string; candidateId?: string } };
      };
      expect(decisionRecord.record.value.decision).toBe("no_verified_solution");
      expect(decisionRecord.record.value.candidateId).toBeUndefined();

      expect(body.result.verification.evidenceIds.length).toBeGreaterThan(0);
      for (const evidenceId of body.result.verification.evidenceIds) {
        const evidenceReadBack = await record(base, "evidence", evidenceId);
        expect(evidenceReadBack.status).toBe(200);
        const evidenceRecord = (await evidenceReadBack.json()) as {
          record: { value: { status: string } };
        };
        expect(evidenceRecord.record.value.status).toBe("failed");
      }

      const receiptReadBack = await record(base, "delivery-receipt", missionId);
      expect(receiptReadBack.status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  }, 15_000);

  it("NEGATIVE_5: the negative result survives a restart", async () => {
    const first = await startTestRuntime(failingVerifierOverrides("failed"));
    const { jobId, missionId } = await createProjectMissionJob(first.base, "neg5");
    const response = await command(first.base, "job.execute", "idem-neg5", { jobId });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ExecuteBody;
    expect(body.result.decision.decision).toBe("no_verified_solution");
    const evidenceIds = body.result.verification.evidenceIds;

    const healthBeforeRestart = (await (await fetch(`${first.base}/health`)).json()) as {
      latestSequence: number;
    };
    expect(healthBeforeRestart.latestSequence).toBeGreaterThan(0);

    await first.runtime.shutdown();

    // A brand-new runtime instance against the same durable SQLite file - no verifier override is
    // needed here since nothing re-executes; this only proves the already-persisted negative
    // outcome survives a real restart, not a re-run of the forced failure.
    const second: RunningRuntime = await startRuntime(testConfig(first.databasePath));
    const secondBase = `http://127.0.0.1:${second.address.port}`;
    try {
      expect(second.startup.latestSequence).toBe(healthBeforeRestart.latestSequence);

      const jobAfter = await record(secondBase, "job", jobId);
      expect(jobAfter.status).toBe(200);
      const jobRecord = (await jobAfter.json()) as { record: { value: { status: string } } };
      expect(jobRecord.record.value.status).toBe("failed");

      const decisionAfter = await record(secondBase, "champion-decision", missionId);
      expect(decisionAfter.status).toBe(200);
      const decisionRecord = (await decisionAfter.json()) as {
        record: { value: { decision: string; candidateId?: string } };
      };
      expect(decisionRecord.record.value.decision).toBe("no_verified_solution");
      expect(decisionRecord.record.value.candidateId).toBeUndefined();

      for (const evidenceId of evidenceIds) {
        const evidenceAfter = await record(secondBase, "evidence", evidenceId);
        expect(evidenceAfter.status).toBe(200);
      }

      const receiptAfter = await record(secondBase, "delivery-receipt", missionId);
      expect(receiptAfter.status).toBe(404);
    } finally {
      await second.shutdown();
    }
  }, 15_000);
});
