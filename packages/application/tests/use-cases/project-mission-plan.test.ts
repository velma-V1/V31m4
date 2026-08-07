import { Requirement, Score } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { createProject, planExecution, submitMission } from "../../src/index.js";
import { makeMission } from "../services/fixtures.js";
import { budget, context, Harness, T0 } from "./fixtures.js";

function missionCommand() {
  return {
    id: "mission-1",
    projectId: "project-1",
    title: "Build verified output",
    objective: "Produce a result with deterministic evidence.",
    requiredOutputs: [{ id: "output-1", kind: "source", description: "Source output" }],
    requirements: [
      Requirement.create({
        id: "requirement-1",
        statement: "Tests pass.",
        priority: "required",
        source: "user",
      }),
    ],
    constraints: [
      {
        id: "constraint-1",
        statement: "Preserve architecture.",
        category: "architecture" as const,
      },
    ],
    acceptanceCriteria: [
      { id: "criterion-1", statement: "Tests pass.", verificationMethod: "unit", mandatory: true },
    ],
    forbiddenChanges: [],
    evidenceRequirements: [
      { criterionId: "criterion-1", requiredEvidenceKinds: ["unit_test" as const] },
    ],
    resourceBudget: budget(),
    auditId: "audit-mission-1",
  };
}

describe("project, mission, and planning use cases", () => {
  it("creates and audits a project, then accepts a mission only for the active project", async () => {
    const harness = new Harness();
    const project = await createProject(
      {
        unitOfWork: harness.unitOfWork,
        projects: harness.projectRepository,
        policy: harness.policy,
        approvals: harness.approvalStore,
        audit: harness.audit,
        clock: harness.clock,
      },
      {
        projectId: "project-1",
        name: "V31M4",
        rootPath: "projects/v31m4",
        auditId: "audit-project-1",
      },
      context,
    );
    expect(project.value.status).toBe("active");
    const mission = await submitMission(
      {
        unitOfWork: harness.unitOfWork,
        projects: harness.projectRepository,
        missions: harness.missionRepository,
        audit: harness.audit,
        clock: harness.clock,
      },
      missionCommand(),
      context,
    );
    expect(mission.value.projectId).toBe(project.value.id);
    expect(harness.audits).toHaveLength(2);
  });

  it("rejects an approval that expires exactly at evaluation time", async () => {
    const harness = new Harness();
    harness.policyDecision = "require_approval";
    harness.approvals.set("approval-1", {
      revision: "1",
      value: Object.freeze({
        id: "approval-1",
        action: "project.create",
        resourceType: "project",
        requestedBy: context.actor,
        requiredScopes: ["execute"],
        context: {},
        status: "granted",
        requestedAt: T0,
        expiresAt: "2026-08-06T20:01:00.000Z",
      }),
    });
    await expect(
      createProject(
        {
          unitOfWork: harness.unitOfWork,
          projects: harness.projectRepository,
          policy: harness.policy,
          approvals: harness.approvalStore,
          audit: harness.audit,
          clock: harness.clock,
        },
        {
          projectId: "project-1",
          name: "V31M4",
          rootPath: "projects/v31m4",
          auditId: "audit-1",
          approvalId: "approval-1",
        },
        context,
      ),
    ).rejects.toThrow();
    expect(harness.projects.size).toBe(0);
  });

  it("builds a deterministic governed execution plan", () => {
    const input = {
      governance: {
        complexity: Score.parse(0.7),
        risk: Score.parse(0.5),
        reversibility: "reversible" as const,
        securityCritical: false,
        deterministicVerificationAvailable: true,
        requiredEvidenceStrength: "high" as const,
        estimatedCost: budget(),
        available: {
          wallClockMs: 180_000,
          modelInvocations: 8,
          toolInvocations: 8,
          concurrentWorkers: 4,
        },
        approvedCeiling: budget(),
        deadlineMs: 180_000,
      },
      mission: makeMission(),
      contextTokenLimit: 100,
      diversity: {
        seed: 7,
        allowedModelIds: ["model-1", "model-2", "model-3"],
        allowedStrategies: ["direct" as const, "failure_first" as const, "adversarial" as const],
        toolCatalog: ["tool-1", "tool-2"],
        contextArtifactIds: ["context-1"],
        missionConstraints: ["Preserve architecture."],
      },
    };
    const first = planExecution(input);
    const second = planExecution(input);
    expect(first).toEqual(second);
    expect(first.diversity.configurations.length > 1).toBe(true);
  });
});
