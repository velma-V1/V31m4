import type { ArtifactId, ModelId, ResourceBudget, SolverStrategy, ToolId } from "@v31m4/domain";
import type { ContextItem } from "../services/context-compiler.js";
import { chooseExecutionPlan, type ComputeGovernorInput, type ComputeGovernorDecision } from "../services/compute-governor.js";
import { compileContext, type CompiledContext } from "../services/context-compiler.js";
import { planDiverseConfigurations, type DiversityPlan } from "../services/diversity-planner.js";

export interface PlanExecutionInput {
  readonly governance: ComputeGovernorInput;
  readonly contextItems: readonly ContextItem[];
  readonly contextTokenLimit: number;
  readonly modelIds: readonly ModelId[];
  readonly strategies: readonly SolverStrategy[];
  readonly toolSets: readonly (readonly ToolId[])[];
  readonly contextArtifactIds: readonly ArtifactId[];
  readonly constraints: readonly string[];
  readonly seed: number;
}

export interface ExecutionPlan {
  readonly governance: ComputeGovernorDecision;
  readonly context: CompiledContext;
  readonly diversity: DiversityPlan;
}

function candidateCount(mode: ComputeGovernorDecision["mode"], budget: ResourceBudget): number {
  const desired = mode === "direct" || mode === "checked" ? 1 : mode === "competitive" ? 3 : 4;
  return Math.max(1, Math.min(desired, budget.maxModelInvocations, budget.maxConcurrentWorkers));
}

export function planExecution(input: PlanExecutionInput): ExecutionPlan {
  const governance = chooseExecutionPlan(input.governance);
  const context = compileContext({ items: input.contextItems, maxTokens: input.contextTokenLimit });
  const diversity = planDiverseConfigurations({
    count: candidateCount(governance.mode, governance.budget),
    seed: input.seed,
    modelIds: input.modelIds,
    strategies: input.strategies,
    toolSets: input.toolSets,
    contextArtifactIds: input.contextArtifactIds,
    constraints: input.constraints,
    resourceBudget: governance.budget,
  });
  return Object.freeze({ governance, context, diversity });
}
