import { assertDomain } from "../domain-errors.js";
import { SafePath, type SafePath as SafePathType } from "../value-objects/safe-path.js";
import { ProjectId, type ProjectId as ProjectIdType } from "../value-objects/ids.js";

export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
  readonly id: ProjectIdType;
  readonly name: string;
  readonly rootPath: SafePathType;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function validateTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_PROJECT",
    `${field} must be a canonical UTC ISO-8601 timestamp with milliseconds.`,
    { field, value },
  );
  return parsed;
}

function validateName(name: string): string {
  assertDomain(
    name.length > 0 && name === name.trim() && name.length <= 160,
    "INVALID_PROJECT",
    "Project name must be canonical and contain between 1 and 160 characters.",
    { name },
  );
  return name;
}

function transition(project: Project, status: ProjectStatus, updatedAt: string): Project {
  const nextTime = validateTimestamp(updatedAt, "updatedAt");
  const currentTime = validateTimestamp(project.updatedAt, "project.updatedAt");
  assertDomain(
    nextTime >= currentTime,
    "INVALID_STATE_TRANSITION",
    "Project update time cannot move backward.",
    { currentStatus: project.status, targetStatus: status },
  );
  assertDomain(
    project.status !== "archived" || status === "archived",
    "INVALID_STATE_TRANSITION",
    "Archived projects cannot return to an active lifecycle.",
    { currentStatus: project.status, targetStatus: status },
  );
  return Object.freeze({ ...project, status, updatedAt });
}

export const Project = Object.freeze({
  create(input: CreateProjectInput): Project {
    validateTimestamp(input.createdAt, "createdAt");
    return Object.freeze({
      id: ProjectId.parse(input.id),
      name: validateName(input.name),
      rootPath: SafePath.parse(input.rootPath),
      status: "active" as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  },

  rename(project: Project, name: string, updatedAt: string): Project {
    const transitioned = transition(project, project.status, updatedAt);
    return Object.freeze({ ...transitioned, name: validateName(name) });
  },

  activate(project: Project, updatedAt: string): Project {
    assertDomain(
      project.status === "paused" || project.status === "active",
      "INVALID_STATE_TRANSITION",
      "Only paused or active projects can become active.",
      { currentStatus: project.status },
    );
    return transition(project, "active", updatedAt);
  },

  pause(project: Project, updatedAt: string): Project {
    assertDomain(
      project.status === "active" || project.status === "paused",
      "INVALID_STATE_TRANSITION",
      "Only active or paused projects can become paused.",
      { currentStatus: project.status },
    );
    return transition(project, "paused", updatedAt);
  },

  archive(project: Project, updatedAt: string): Project {
    return transition(project, "archived", updatedAt);
  },
});
