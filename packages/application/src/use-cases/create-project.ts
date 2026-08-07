import { Project, type Project as ProjectType } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { ProjectRepositoryPort } from "../ports/project-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { WriteConditions, type Versioned } from "../port-types.js";
import { appendAudit, authorizeAction } from "./use-case-support.js";

export interface CreateProjectDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly projects: ProjectRepositoryPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export interface CreateProjectCommand {
  readonly projectId: string;
  readonly name: string;
  readonly rootPath: string;
  readonly auditId: string;
  readonly approvalId?: string;
}

export async function createProject(
  dependencies: CreateProjectDependencies,
  command: CreateProjectCommand,
  context: OperationContext,
): Promise<Versioned<ProjectType>> {
  const project = Project.create({
    id: command.projectId,
    name: command.name,
    rootPath: command.rootPath,
    createdAt: dependencies.clock.now(),
  });
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    await authorizeAction(
      dependencies,
      { action: "project.create", resourceType: "project", resourceId: project.id, attributes: { rootPath: project.rootPath } },
      command.approvalId,
      context,
      transaction,
    );
    const saved = await dependencies.projects.save(project, WriteConditions.mustNotExist(), context, transaction);
    await appendAudit(dependencies.audit, dependencies.clock, {
      id: command.auditId,
      action: "project.create",
      resourceType: "project",
      resourceId: project.id,
      outcome: "completed",
      details: { revision: saved.revision },
    }, context, transaction);
    return saved;
  });
}
