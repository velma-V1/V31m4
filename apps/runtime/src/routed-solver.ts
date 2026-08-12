import {
  ApplicationError,
  isApplicationError,
  type OperationContext,
  type RunSolverForgeCommand,
  type RunSolverForgeDependencies,
  routeModels,
  runSolverForge,
} from "@v31m4/application";
import type { ModelId, SolverCandidate, SolverConfiguration } from "@v31m4/domain";
import { createJobModelConfiguration } from "./job-verification-plan.js";

export interface RoutedSolverResult {
  readonly candidate: SolverCandidate;
  readonly configuration: SolverConfiguration;
}

/** Runs the existing solver forge using a bounded provider-neutral escalation plan. */
export async function runRoutedSolver(
  dependencies: RunSolverForgeDependencies,
  command: Omit<RunSolverForgeCommand, "configurations" | "candidateIds" | "invocationIds"> & {
    readonly candidateId: string;
    readonly preferredModelId: ModelId;
    invocationId(index: number): string;
  },
  context: OperationContext,
): Promise<RoutedSolverResult> {
  const catalog = await dependencies.models.list({ limit: 500 }, context);
  const routing = routeModels({
    profiles: catalog.items,
    requiredModality: "text",
    requiredCapabilityId: "software.coding",
    minimumContextTokens: 0,
    preferredModelId: command.preferredModelId,
    maxInvocations: command.resourceBudget.maxModelInvocations,
  });
  let lastFailure: unknown;
  for (let index = 0; index < routing.modelIds.length; index += 1) {
    const modelId = routing.modelIds[index];
    if (modelId === undefined) continue;
    const configuration = createJobModelConfiguration(modelId as ModelId);
    try {
      const [candidate] = await runSolverForge(
        dependencies,
        {
          jobId: command.jobId,
          missionId: command.missionId,
          projectId: command.projectId,
          promptArtifactId: command.promptArtifactId,
          configurations: [configuration],
          candidateIds: [command.candidateId],
          invocationIds: [command.invocationId(index)],
          createdAt: command.createdAt,
          resourceBudget: command.resourceBudget,
        },
        context,
      );
      if (candidate === undefined) {
        throw new ApplicationError("INTEGRITY_FAILURE", "Solver forge produced no candidate.");
      }
      return Object.freeze({ candidate, configuration });
    } catch (error) {
      lastFailure = error;
      if (!isApplicationError(error) || !error.retryable) throw error;
    }
  }
  if (lastFailure !== undefined) throw lastFailure;
  throw new ApplicationError("INTEGRITY_FAILURE", "Model routing produced no solver attempt.");
}
