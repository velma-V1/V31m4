import {
  PracticeTask,
  type PracticeTaskId,
  type PracticeTask as PracticeTaskType,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { PracticeRepositoryPort } from "../ports/practice-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { WorkspaceManagerPort } from "../ports/workspace-manager.port.js";
import { requireValue } from "./use-case-support.js";

export interface StopIdlePracticeDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly practice: PracticeRepositoryPort;
  readonly workspaces: WorkspaceManagerPort;
}

export async function stopIdlePractice(
  dependencies: StopIdlePracticeDependencies,
  practiceTaskId: PracticeTaskId,
  traceArtifactIds: readonly string[],
  context: OperationContext,
): Promise<Versioned<PracticeTaskType>> {
  const updated = await dependencies.unitOfWork.execute(context, async (transaction) => {
    const stored = requireValue(
      await dependencies.practice.get(practiceTaskId, context, transaction),
      "Practice task does not exist.",
    );
    const stopped = PracticeTask.stop(stored.value, traceArtifactIds);
    const saved = await dependencies.practice.save(
      stopped,
      WriteConditions.matchRevision(stored.revision),
      context,
      transaction,
    );
    return Object.freeze({ saved, workspaceId: stored.value.workspaceId });
  });
  try {
    await dependencies.workspaces.discard(updated.workspaceId, context);
    return updated.saved;
  } catch (error) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Practice stopped but its isolated workspace could not be disposed.",
      {
        cause: error,
        details: { practiceTaskId, workspaceId: updated.workspaceId },
        retryable: true,
      },
    );
  }
}
