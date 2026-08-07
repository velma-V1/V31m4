import { describe, expect, it } from "vitest";
import {
  DomainError,
  MissionContract,
  Project,
  Requirement,
  ResourceBudget,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";
const T1 = "2026-08-06T20:01:00.000Z";

describe("project and mission domain", () => {
  it("creates and transitions a project without mutating prior state", () => {
    const project = Project.create({
      id: "project-1",
      name: "V31M4",
      rootPath: "projects/v31m4",
      createdAt: T0,
    });
    const paused = Project.pause(project, T1);

    expect(project.status).toBe("active");
    expect(paused.status).toBe("paused");
    expect(paused.updatedAt).toBe(T1);
    expect(Object.isFrozen(paused)).toBe(true);
  });

  it("prevents archived projects from becoming active", () => {
    const project = Project.create({
      id: "project-1",
      name: "V31M4",
      rootPath: "projects/v31m4",
      createdAt: T0,
    });
    const archived = Project.archive(project, T1);

    expect(() => Project.activate(archived, "2026-08-06T20:02:00.000Z")).toThrowError(DomainError);
  });

  it("creates an immutable mission with mandatory evidence coverage", () => {
    const requirement = Requirement.create({
      id: "requirement-1",
      statement: "Produce a verified domain layer.",
      priority: "required",
      source: "user",
    });
    const mission = MissionContract.create({
      id: "mission-1",
      projectId: "project-1",
      title: "Domain Layer",
      objective: "Create complete immutable domain entities.",
      requiredOutputs: [
        {
          id: "output-1",
          kind: "source",
          description: "Compiled TypeScript domain package.",
        },
      ],
      requirements: [requirement],
      constraints: [
        {
          id: "constraint-1",
          statement: "No infrastructure dependencies.",
          category: "architecture",
        },
      ],
      acceptanceCriteria: [
        {
          id: "criterion-1",
          statement: "All domain tests pass.",
          verificationMethod: "Automated unit tests",
          mandatory: true,
        },
      ],
      forbiddenChanges: [
        {
          id: "forbidden-1",
          statement: "Do not add runtime dependencies.",
        },
      ],
      evidenceRequirements: [
        {
          criterionId: "criterion-1",
          requiredEvidenceKinds: ["unit_test"],
        },
      ],
      resourceBudget: ResourceBudget.create({
        maxWallClockMs: 1000,
        maxModelInvocations: 0,
        maxToolInvocations: 0,
        maxRepairRounds: 0,
        maxConcurrentWorkers: 1,
      }),
      createdAt: T0,
    });

    expect(mission.revision).toBe(1);
    expect(Object.isFrozen(mission.requiredOutputs)).toBe(true);
    expect(Object.isFrozen(mission.acceptanceCriteria[0])).toBe(true);
  });

  it("rejects mandatory criteria without evidence requirements", () => {
    const requirement = Requirement.create({
      id: "requirement-1",
      statement: "Produce a verified domain layer.",
      priority: "required",
      source: "user",
    });

    expect(() =>
      MissionContract.create({
        id: "mission-1",
        projectId: "project-1",
        title: "Domain Layer",
        objective: "Create complete immutable domain entities.",
        requiredOutputs: [{ id: "output-1", kind: "source", description: "Source files." }],
        requirements: [requirement],
        constraints: [],
        acceptanceCriteria: [
          {
            id: "criterion-1",
            statement: "Tests pass.",
            verificationMethod: "Unit tests",
            mandatory: true,
          },
        ],
        forbiddenChanges: [],
        evidenceRequirements: [],
        resourceBudget: ResourceBudget.create({
          maxWallClockMs: 1000,
          maxModelInvocations: 0,
          maxToolInvocations: 0,
          maxRepairRounds: 0,
          maxConcurrentWorkers: 1,
        }),
        createdAt: T0,
      }),
    ).toThrowError(DomainError);
  });
});
