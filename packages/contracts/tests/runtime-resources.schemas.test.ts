import { describe, expect, it } from "vitest";
import {
  capabilityScoreSchema,
  deliveryReceiptSchema,
  listCandidatesRequestSchema,
  listCandidatesResponseSchema,
  promotionRecordSchema,
} from "../src/capabilities.schemas.js";
import { evidenceRecordSchema } from "../src/evidence.schemas.js";
import { jobSchema, stopJobRequestSchema } from "../src/jobs.schemas.js";
import {
  listMissionsRequestSchema,
  listMissionsResponseSchema,
  submitMissionRequestSchema,
} from "../src/missions.schemas.js";
import { createProjectRequestSchema, projectSchema } from "../src/projects.schemas.js";

const metadata = { schemaVersion: "1.0.0", requestId: "request:1" } as const;

describe("runtime resource contracts", () => {
  it("validates strict project requests and project state", () => {
    expect(
      createProjectRequestSchema.parse({
        ...metadata,
        name: "Alpha",
        rootPath: "projects/alpha",
      }),
    ).toMatchObject({ name: "Alpha", rootPath: "projects/alpha" });
    expect(
      createProjectRequestSchema.safeParse({
        ...metadata,
        name: "Alpha",
        rootPath: "projects/alpha",
        hidden: true,
      }).success,
    ).toBe(false);

    expect(
      projectSchema.parse({
        id: "project:alpha",
        name: "Alpha",
        rootPath: "projects/alpha",
        status: "active",
        createdAt: "2026-08-06T21:00:00.000Z",
        updatedAt: "2026-08-06T21:00:00.000Z",
      }).status,
    ).toBe("active");
  });

  it("requires complete evidence coverage for every mandatory mission criterion", () => {
    const mission = {
      ...metadata,
      projectId: "project:alpha",
      title: "Build contracts",
      objective: "Create strict runtime contracts.",
      requiredOutputs: [{ id: "output:1", kind: "source", description: "Contracts" }],
      requirements: [
        {
          id: "requirement:1",
          statement: "Reject unknown fields.",
          priority: "required",
          source: "user",
        },
      ],
      constraints: [
        { id: "constraint:1", statement: "Remain provider neutral.", category: "architecture" },
      ],
      acceptanceCriteria: [
        {
          id: "criterion:1",
          statement: "Unknown fields fail.",
          verificationMethod: "schema test",
          mandatory: true,
        },
      ],
      forbiddenChanges: [{ id: "forbidden:1", statement: "Do not add provider SDK types." }],
      evidenceRequirements: [{ criterionId: "criterion:1", requiredEvidenceKinds: ["unit_test"] }],
      resourceBudget: {
        maxWallClockMs: 60_000,
        maxModelInvocations: 2,
        maxToolInvocations: 2,
        maxRepairRounds: 1,
        maxConcurrentWorkers: 1,
      },
    } as const;

    expect(submitMissionRequestSchema.parse(mission).title).toBe("Build contracts");
    expect(
      submitMissionRequestSchema.safeParse({ ...mission, evidenceRequirements: [] }).success,
    ).toBe(false);
    expect(
      submitMissionRequestSchema.safeParse({
        ...mission,
        requirements: [...mission.requirements, mission.requirements[0]],
      }).success,
    ).toBe(false);
  });

  it("defines strict project-scoped mission and candidate list contracts", () => {
    expect(
      listMissionsRequestSchema.parse({
        ...metadata,
        projectId: "project:alpha",
        pagination: { limit: 25 },
      }),
    ).toMatchObject({ projectId: "project:alpha", pagination: { limit: 25 } });
    expect(
      listMissionsRequestSchema.safeParse({
        ...metadata,
        pagination: { limit: 25 },
      }).success,
    ).toBe(false);
    expect(
      listMissionsRequestSchema.safeParse({
        ...metadata,
        projectId: "project:alpha",
        pagination: { limit: 25 },
        hidden: true,
      }).success,
    ).toBe(false);

    expect(
      listCandidatesRequestSchema.parse({
        ...metadata,
        projectId: "project:alpha",
        missionId: "mission:1",
        pagination: { limit: 25 },
      }),
    ).toMatchObject({ projectId: "project:alpha", missionId: "mission:1" });
    expect(
      listCandidatesRequestSchema.safeParse({
        ...metadata,
        missionId: "mission:1",
        pagination: { limit: 25 },
      }).success,
    ).toBe(false);

    const mission = {
      id: "mission:1",
      projectId: "project:alpha",
      title: "List persisted records",
      objective: "Expose authoritative query results.",
      requiredOutputs: [{ id: "output:1", kind: "source", description: "Query surface" }],
      requirements: [
        {
          id: "requirement:1",
          statement: "Return persisted state.",
          priority: "required",
          source: "user",
        },
      ],
      constraints: [],
      acceptanceCriteria: [
        {
          id: "criterion:1",
          statement: "Queries are scoped.",
          verificationMethod: "integration test",
          mandatory: true,
        },
      ],
      forbiddenChanges: [],
      evidenceRequirements: [
        { criterionId: "criterion:1", requiredEvidenceKinds: ["integration_test"] },
      ],
      resourceBudget: {
        maxWallClockMs: 60_000,
        maxModelInvocations: 2,
        maxToolInvocations: 2,
        maxRepairRounds: 1,
        maxConcurrentWorkers: 1,
      },
      createdAt: "2026-08-11T12:00:00.000Z",
      revision: 1,
    } as const;
    expect(
      listMissionsResponseSchema.safeParse({
        ...metadata,
        missions: [mission],
        pagination: { total: 1 },
      }).success,
    ).toBe(true);
    expect(
      listMissionsResponseSchema.safeParse({
        ...metadata,
        missions: [mission, mission],
        pagination: { total: 2 },
      }).success,
    ).toBe(false);

    const candidate = {
      id: "candidate:1",
      missionId: "mission:1",
      parentCandidateIds: [],
      configuration: {
        modelId: "model:1",
        strategy: "direct",
        contextArtifactIds: [],
        toolIds: [],
        constraints: [],
      },
      responseArtifactId: "artifact:response",
      outputArtifactIds: ["artifact:output"],
      original: true,
      createdAt: "2026-08-11T12:01:00.000Z",
    } as const;
    expect(
      listCandidatesResponseSchema.safeParse({
        ...metadata,
        candidates: [candidate],
        pagination: { total: 1 },
      }).success,
    ).toBe(true);
    expect(
      listCandidatesResponseSchema.safeParse({
        ...metadata,
        candidates: [candidate, candidate],
        pagination: { total: 2 },
      }).success,
    ).toBe(false);
  });

  it("validates job state and only the two approved stop modes", () => {
    const job = {
      id: "job:1",
      projectId: "project:alpha",
      missionId: "mission:1",
      workflowId: "workflow:1",
      status: "running",
      currentStage: "verify",
      progress: 0.5,
      createdAt: "2026-08-06T21:00:00.000Z",
      updatedAt: "2026-08-06T21:01:00.000Z",
    } as const;
    expect(jobSchema.parse(job).progress).toBe(0.5);
    expect(jobSchema.safeParse({ ...job, progress: 1.01 }).success).toBe(false);
    expect(
      stopJobRequestSchema.parse({ ...metadata, jobId: "job:1", mode: "finish_and_stop" }).mode,
    ).toBe("finish_and_stop");
    expect(
      stopJobRequestSchema.safeParse({ ...metadata, jobId: "job:1", mode: "kill" }).success,
    ).toBe(false);
  });

  it("requires artifact-backed immutable evidence", () => {
    const evidence = {
      id: "evidence:1",
      projectId: "project:alpha",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "schema",
      subjectId: "contracts",
      status: "passed",
      summary: "All contract checks passed.",
      artifactIds: ["artifact:report"],
      verifierId: "verifier:contracts",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-06T21:02:00.000Z",
      immutable: true,
    } as const;
    expect(evidenceRecordSchema.parse(evidence).immutable).toBe(true);
    expect(evidenceRecordSchema.safeParse({ ...evidence, artifactIds: [] }).success).toBe(false);
    expect(evidenceRecordSchema.safeParse({ ...evidence, immutable: false }).success).toBe(false);
  });

  it("enforces capability difficulty ordering and nonempty evidence", () => {
    const score = {
      capabilityId: "capability:contracts",
      score: 0.9,
      sampleSize: 20,
      difficultyRange: [2, 5],
      evidenceIds: ["evidence:1"],
      measuredAt: "2026-08-06T21:03:00.000Z",
    } as const;
    expect(capabilityScoreSchema.parse(score).score).toBe(0.9);
    expect(capabilityScoreSchema.safeParse({ ...score, difficultyRange: [5, 2] }).success).toBe(
      false,
    );
    expect(capabilityScoreSchema.safeParse({ ...score, evidenceIds: [] }).success).toBe(false);
  });

  it("rejects impossible delivery and promotion records", () => {
    const receipt = {
      id: "delivery:1",
      missionId: "mission:1",
      decision: "champion",
      deliveredArtifactIds: ["artifact:result"],
      requirementsCovered: 2,
      requirementsTotal: 2,
      mandatoryChecksPassed: 3,
      mandatoryChecksTotal: 3,
      unresolvedRiskIds: [],
      evidenceIds: ["evidence:1"],
      createdAt: "2026-08-06T21:04:00.000Z",
    } as const;
    expect(deliveryReceiptSchema.parse(receipt).requirementsCovered).toBe(2);
    expect(deliveryReceiptSchema.safeParse({ ...receipt, requirementsCovered: 3 }).success).toBe(
      false,
    );

    const promotion = {
      id: "promotion:1",
      capabilityId: "capability:contracts",
      sourcePacketIds: ["training:1"],
      heldOutEvidenceIds: ["evidence:held-out"],
      regressionEvidenceIds: ["evidence:regression"],
      decision: "promoted",
      createdAt: "2026-08-06T21:05:00.000Z",
    } as const;
    expect(promotionRecordSchema.parse(promotion).decision).toBe("promoted");
    expect(promotionRecordSchema.safeParse({ ...promotion, heldOutEvidenceIds: [] }).success).toBe(
      false,
    );
  });
});
