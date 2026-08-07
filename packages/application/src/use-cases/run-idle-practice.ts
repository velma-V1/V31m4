import { PracticeTask, type PracticeTask as PracticeTaskType, type ProjectId, type ResourceBudget } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { CapabilityRepositoryPort } from "../ports/capability-repository.port.js";
import type { PracticeRepositoryPort } from "../ports/practice-repository.port.js";
import type { ResourceMonitorPort } from "../ports/resource-monitor.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { WorkspaceManagerPort } from "../ports/workspace-manager.port.js";
import { WriteConditions, type Versioned } from "../port-types.js";
import { selectPracticeTask, type PracticeCandidate } from "../services/practice-selector.js";
import { collectPortPages } from "./use-case-support.js";

export interface RunIdlePracticeDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capabilities: CapabilityRepositoryPort;
  readonly practice: PracticeRepositoryPort;
  readonly resources: ResourceMonitorPort;
  readonly workspaces: WorkspaceManagerPort;
}

export interface RunIdlePracticeCommand {
  readonly projectId: ProjectId;
  readonly candidates: readonly PracticeCandidate[];
  readonly recentCapabilityIds: readonly string[];
  readonly requiredIdleMs: number;
  readonly cooldownMs: number;
  readonly approvedBudget: ResourceBudget;
}

export async function runIdlePractice(
  dependencies: RunIdlePracticeDependencies,
  command: RunIdlePracticeCommand,
  context: OperationContext,
): Promise<Versioned<PracticeTaskType> | null> {
  const reading = await dependencies.resources.read(context);
  const profiles = await collectPortPages((cursor) =>
    dependencies.capabilities.listProfiles(cursor === undefined ? { limit: 500 } : { limit: 500, cursor }, context),
  );
  const selection = selectPracticeTask({
    profiles: profiles.map((item) => item.value),
    candidates: command.candidates,
    now: reading.capturedAt,
    idleForMs: reading.idleForMs,
    requiredIdleMs: command.requiredIdleMs,
    cooldownMs: command.cooldownMs,
    availableBudget: {
      ...command.approvedBudget,
      ...(command.approvedBudget.maxRamBytes === undefined ? {} : { maxRamBytes: Math.min(command.approvedBudget.maxRamBytes, reading.ramTotalBytes - reading.ramUsedBytes) }),
      ...(command.approvedBudget.maxVramBytes === undefined || reading.vramTotalBytes === undefined || reading.vramUsedBytes === undefined
        ? {}
        : { maxVramBytes: Math.min(command.approvedBudget.maxVramBytes, reading.vramTotalBytes - reading.vramUsedBytes) }),
    },
    recentCapabilityIds: command.recentCapabilityIds,
  });
  if (selection.selected === null) return null;
  const workspace = await dependencies.workspaces.create(command.projectId, "practice", context);
  const task = PracticeTask.start(PracticeTask.create({
    id: selection.selected.id,
    capabilityId: selection.selected.capabilityId,
    targetDifficulty: selection.selected.targetDifficulty,
    workspaceId: workspace.id,
    isolatedWorkspacePath: workspace.rootPath,
    resourceBudget: selection.selected.estimatedBudget,
  }));
  try {
    return await dependencies.unitOfWork.execute(context, (transaction) =>
      dependencies.practice.save(task, WriteConditions.mustNotExist(), context, transaction),
    );
  } catch (error) {
    await dependencies.workspaces.discard(workspace.id, context);
    throw new ApplicationError("TRANSACTION_FAILED", "Practice task could not be stored.", { cause: error });
  }
}
