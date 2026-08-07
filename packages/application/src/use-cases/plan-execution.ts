import type { MissionContract, ResourceBudget } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import {
  type ComputeGovernorInput,
  type ComputeGovernorSelection,
  selectComputeDecision,
} from "../services/compute-governor.js";
import {
  type CompiledContext,
  type ContextCandidate,
  compileContext,
} from "../services/context-compiler.js";
import {
  type DiversityPlan,
  type DiversityPlannerInput,
  planDiversity,
} from "../services/diversity-planner.js";

export interface PlanExecutionInput {
  readonly governance: ComputeGovernorInput;
  readonly mission: MissionContract;
  readonly supplementalContext?: readonly ContextCandidate[];
  readonly contextTokenLimit: number;
  readonly diversity: Omit<DiversityPlannerInput, "count" | "budget">;
}

export interface ExecutionPlan {
  readonly governance: ComputeGovernorSelection;
  readonly context: CompiledContext;
  readonly diversity: DiversityPlan;
}

function candidateCount(mode: ComputeGovernorSelection["mode"], budget: ResourceBudget): number {
  const desired = mode === "direct" || mode === "checked" ? 1 : mode === "competitive" ? 3 : 4;
  return Math.max(1, Math.min(desired, budget.maxModelInvocations, budget.maxConcurrentWorkers));
}

export function planExecution(input: PlanExecutionInput): ExecutionPlan {
  const governance = selectComputeDecision(input.governance);
  if (governance.outcome !== "selected") {
    throw new ApplicationError("POLICY_REJECTED", governance.detail, {
      details: { outcome: governance.outcome, reason: governance.reason },
    });
  }
  const context = compileContext({
    mission: input.mission,
    limitTokens: input.contextTokenLimit,
    ...(input.supplementalContext === undefined ? {} : { supplemental: input.supplementalContext }),
  });
  if (context.outcome !== "compiled") {
    throw new ApplicationError(
      "RESOURCE_EXHAUSTED",
      "Mandatory mission context exceeds the token limit.",
      {
        details: { mandatoryTokens: context.mandatoryTokens, limitTokens: context.limitTokens },
      },
    );
  }
  const diversity = planDiversity({
    ...input.diversity,
    count: candidateCount(governance.mode, governance.budget),
    budget: governance.budget,
  });
  if (diversity.outcome !== "planned") {
    throw new ApplicationError("RESOURCE_EXHAUSTED", diversity.detail, {
      details: { reason: diversity.reason, maximumFeasible: diversity.maximumFeasible },
    });
  }
  return Object.freeze({ governance, context, diversity });
}
