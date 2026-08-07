import { MissionContract, type CreateMissionContractInput, type MissionContract as MissionContractType } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { MissionRepositoryPort } from "../ports/mission-repository.port.js";
import type { ProjectRepositoryPort } from "../ports/project-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { Versioned } from "../port-types.js";
import { appendAudit, requireValue } from "./use-case-support.js";

export interface SubmitMissionDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly projects: ProjectRepositoryPort;
  readonly missions: MissionRepositoryPort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export interface SubmitMissionCommand extends Omit<CreateMissionContractInput, "createdAt"> {
  readonly auditId: string;
}

export async function submitMission(
  dependencies: SubmitMissionDependencies,
  command: SubmitMissionCommand,
  context: OperationContext,
): Promise<Versioned<MissionContractType>> {
  const { auditId: _auditId, ...missionInput } = command;
  const mission = MissionContract.create({ ...missionInput, createdAt: dependencies.clock.now() });
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const project = requireValue(
      await dependencies.projects.getById(mission.projectId, context, transaction),
      "Mission project does not exist.",
    );
    if (project.value.status !== "active") {
      throw new ApplicationError("CONFLICT", "Missions can be submitted only to active projects.", {
        details: { projectId: mission.projectId, status: project.value.status },
      });
    }
    const stored = await dependencies.missions.append(mission, context, transaction);
    await appendAudit(dependencies.audit, dependencies.clock, {
      id: command.auditId,
      action: "mission.submit",
      resourceType: "mission",
      resourceId: mission.id,
      outcome: "completed",
      details: { projectId: mission.projectId },
    }, context, transaction);
    return stored;
  });
}
