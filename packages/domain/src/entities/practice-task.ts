import { assertDomain } from "../domain-errors.js";
import {
  ArtifactId,
  CapabilityId,
  EvidenceId,
  PracticeTaskId,
  type ArtifactId as ArtifactIdType,
  type CapabilityId as CapabilityIdType,
  type EvidenceId as EvidenceIdType,
  type PracticeTaskId as PracticeTaskIdType,
} from "../value-objects/ids.js";
import { ResourceBudget, type ResourceBudget as ResourceBudgetType } from "../value-objects/resource-budget.js";
import { SafePath, type SafePath as SafePathType } from "../value-objects/safe-path.js";

export type PracticeTaskStatus =
  | "planned"
  | "running"
  | "checkpointed"
  | "completed"
  | "stopped"
  | "quarantined";

export interface PracticeTask {
  readonly id: PracticeTaskIdType;
  readonly capabilityId: CapabilityIdType;
  readonly targetDifficulty: number;
  readonly status: PracticeTaskStatus;
  readonly workspaceId: string;
  readonly isolatedWorkspacePath: SafePathType;
  readonly resourceBudget: ResourceBudgetType;
  readonly traceArtifactIds: readonly ArtifactIdType[];
  readonly evidenceIds: readonly EvidenceIdType[];
}

function transition(
  task: PracticeTask,
  target: PracticeTaskStatus,
  allowed: readonly PracticeTaskStatus[],
  additions?: {
    readonly traceArtifactIds?: readonly string[];
    readonly evidenceIds?: readonly string[];
  },
): PracticeTask {
  assertDomain(
    allowed.includes(task.status),
    "INVALID_STATE_TRANSITION",
    `Practice task cannot transition from ${task.status} to ${target}.`,
  );
  const traceArtifactIds = [
    ...task.traceArtifactIds,
    ...(additions?.traceArtifactIds ?? []).map((id) => ArtifactId.parse(id)),
  ];
  const evidenceIds = [
    ...task.evidenceIds,
    ...(additions?.evidenceIds ?? []).map((id) => EvidenceId.parse(id)),
  ];
  assertDomain(
    new Set(traceArtifactIds).size === traceArtifactIds.length &&
      new Set(evidenceIds).size === evidenceIds.length,
    "INVALID_PRACTICE_TASK",
    "Practice task trace and evidence IDs must remain unique.",
  );
  assertDomain(
    target !== "completed" && target !== "quarantined" || evidenceIds.length > 0,
    "INVALID_PRACTICE_TASK",
    "Completed and quarantined practice tasks require evidence.",
  );
  return Object.freeze({
    ...task,
    status: target,
    traceArtifactIds: Object.freeze(traceArtifactIds),
    evidenceIds: Object.freeze(evidenceIds),
  });
}

export const PracticeTask = Object.freeze({
  create(input: {
    readonly id: string;
    readonly capabilityId: string;
    readonly targetDifficulty: number;
    readonly workspaceId: string;
    readonly isolatedWorkspacePath: string;
    readonly resourceBudget: ResourceBudgetType;
  }): PracticeTask {
    assertDomain(
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.workspaceId),
      "INVALID_PRACTICE_TASK",
      "Practice workspace ID must be canonical.",
    );
    assertDomain(
      Number.isFinite(input.targetDifficulty) && input.targetDifficulty >= 0,
      "INVALID_PRACTICE_TASK",
      "Practice target difficulty must be finite and non-negative.",
    );
    return Object.freeze({
      id: PracticeTaskId.parse(input.id),
      capabilityId: CapabilityId.parse(input.capabilityId),
      targetDifficulty: input.targetDifficulty,
      status: "planned" as const,
      workspaceId: input.workspaceId,
      isolatedWorkspacePath: SafePath.parse(input.isolatedWorkspacePath),
      resourceBudget: ResourceBudget.create(input.resourceBudget),
      traceArtifactIds: Object.freeze([]),
      evidenceIds: Object.freeze([]),
    });
  },

  start(task: PracticeTask): PracticeTask {
    return transition(task, "running", ["planned", "checkpointed"]);
  },

  checkpoint(task: PracticeTask, traceArtifactIds: readonly string[]): PracticeTask {
    assertDomain(
      traceArtifactIds.length > 0,
      "INVALID_PRACTICE_TASK",
      "Checkpointing practice requires trace artifacts.",
    );
    return transition(task, "checkpointed", ["running"], { traceArtifactIds });
  },

  complete(
    task: PracticeTask,
    traceArtifactIds: readonly string[],
    evidenceIds: readonly string[],
  ): PracticeTask {
    return transition(task, "completed", ["running", "checkpointed"], {
      traceArtifactIds,
      evidenceIds,
    });
  },

  stop(task: PracticeTask, traceArtifactIds: readonly string[] = []): PracticeTask {
    return transition(task, "stopped", ["planned", "running", "checkpointed"], {
      traceArtifactIds,
    });
  },

  quarantine(task: PracticeTask): PracticeTask {
    return transition(task, "quarantined", ["completed"]);
  },
});
