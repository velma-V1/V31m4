import {
  type ArtifactId,
  type JobId,
  type MissionId,
  type ProjectId,
  type ResourceBudget,
  SolverCandidate,
  type SolverCandidate as SolverCandidateType,
  type SolverConfiguration,
} from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { throwIfOperationCancelled } from "../operation-context.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { ModelGatewayPort } from "../ports/model-gateway.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { WorkspaceManagerPort } from "../ports/workspace-manager.port.js";

export interface RunSolverForgeDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
  readonly models: ModelGatewayPort;
  readonly workspaces: WorkspaceManagerPort;
}

export interface RunSolverForgeCommand {
  readonly jobId: JobId;
  readonly missionId: MissionId;
  readonly projectId: ProjectId;
  readonly promptArtifactId: ArtifactId;
  readonly configurations: readonly SolverConfiguration[];
  readonly candidateIds: readonly string[];
  readonly invocationIds: readonly string[];
  readonly createdAt: string;
  readonly resourceBudget: ResourceBudget;
}

export async function runSolverForge(
  dependencies: RunSolverForgeDependencies,
  command: RunSolverForgeCommand,
  context: OperationContext,
): Promise<readonly SolverCandidateType[]> {
  assertApplication(
    command.configurations.length > 0,
    "INVALID_APPLICATION_INPUT",
    "Solver forge requires at least one configuration.",
  );
  assertApplication(
    command.candidateIds.length === command.configurations.length &&
      command.invocationIds.length === command.configurations.length,
    "INVALID_APPLICATION_INPUT",
    "Every solver configuration requires a candidate and invocation ID.",
  );
  assertApplication(
    new Set(command.candidateIds).size === command.candidateIds.length,
    "INVALID_APPLICATION_INPUT",
    "Candidate IDs must be unique.",
  );
  const results: SolverCandidateType[] = [];
  for (let index = 0; index < command.configurations.length; index += 1) {
    throwIfOperationCancelled(context);
    const configuration = command.configurations[index];
    const candidateId = command.candidateIds[index];
    const invocationId = command.invocationIds[index];
    assertApplication(
      configuration !== undefined && candidateId !== undefined && invocationId !== undefined,
      "INTEGRITY_FAILURE",
      "Solver forge input arrays became misaligned.",
    );
    const workspace = await dependencies.workspaces.create(command.projectId, "candidate", context);
    try {
      const invocation = await dependencies.models.invoke(
        {
          invocationId,
          jobId: command.jobId,
          modelId: configuration.modelId,
          promptArtifactId: command.promptArtifactId,
          configuration,
          resourceBudget: command.resourceBudget,
          metadata: { workspaceId: workspace.id },
        },
        context,
      );
      if (invocation.finishReason !== "completed" || invocation.outputArtifactIds.length === 0) {
        throw new ApplicationError(
          "DEPENDENCY_FAILURE",
          "Solver invocation did not produce a complete candidate.",
          { details: { invocationId, finishReason: invocation.finishReason } },
        );
      }
      const candidate = SolverCandidate.createOriginal({
        id: candidateId,
        missionId: command.missionId,
        configuration: {
          modelId: configuration.modelId,
          strategy: configuration.strategy,
          contextArtifactIds: configuration.contextArtifactIds,
          toolIds: configuration.toolIds,
          ...(configuration.temperature === undefined
            ? {}
            : { temperature: configuration.temperature }),
          ...(configuration.seed === undefined ? {} : { seed: configuration.seed }),
          constraints: configuration.constraints,
        },
        responseArtifactId: invocation.responseArtifactId,
        outputArtifactIds: invocation.outputArtifactIds,
        createdAt: command.createdAt,
      });
      await dependencies.unitOfWork.execute(context, async (transaction) => {
        await dependencies.candidates.appendCandidate(candidate, context, transaction);
      });
      await dependencies.workspaces.seal(workspace.id, context);
      results.push(candidate);
    } catch (error) {
      await dependencies.workspaces.discard(workspace.id, context);
      throw error;
    }
  }
  return Object.freeze(results);
}
