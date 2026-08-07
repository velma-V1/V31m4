import type { ArtifactId, ModelId, ResourceBudget, SolverConfiguration, SolverStrategy, ToolId } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";

export interface DiversityPlanInput {
  readonly count: number;
  readonly seed: number;
  readonly modelIds: readonly ModelId[];
  readonly strategies: readonly SolverStrategy[];
  readonly toolSets: readonly (readonly ToolId[])[];
  readonly contextArtifactIds: readonly ArtifactId[];
  readonly constraints: readonly string[];
  readonly resourceBudget: ResourceBudget;
}

export interface DiversityPlan {
  readonly configurations: readonly SolverConfiguration[];
  readonly pairwiseMateriallyDistinct: true;
}

function materialKey(modelId: ModelId, strategy: SolverStrategy, toolIds: readonly ToolId[]): string {
  return `${modelId}|${strategy}|${[...toolIds].sort().join(",")}`;
}

function seededOrder(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 2_654_435_761)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function planDiverseConfigurations(input: DiversityPlanInput): DiversityPlan {
  assertApplication(Number.isSafeInteger(input.count) && input.count > 0, "INVALID_APPLICATION_INPUT", "Diversity count must be positive.");
  assertApplication(Number.isSafeInteger(input.seed) && input.seed >= 0, "INVALID_APPLICATION_INPUT", "Diversity seed must be non-negative.");
  assertApplication(input.modelIds.length > 0, "INVALID_APPLICATION_INPUT", "At least one model is required.");
  assertApplication(input.strategies.length > 0, "INVALID_APPLICATION_INPUT", "At least one strategy is required.");
  assertApplication(input.toolSets.length > 0, "INVALID_APPLICATION_INPUT", "At least one tool set is required.");
  assertApplication(input.resourceBudget.maxModelInvocations >= input.count, "RESOURCE_EXHAUSTED", "Model invocation budget is smaller than the requested candidate count.");
  assertApplication(input.resourceBudget.maxConcurrentWorkers > 0, "RESOURCE_EXHAUSTED", "At least one worker is required.");

  const combinations: Array<Readonly<{ modelId: ModelId; strategy: SolverStrategy; toolIds: readonly ToolId[]; key: string }>> = [];
  const seen = new Set<string>();
  for (const modelId of input.modelIds) {
    for (const strategy of input.strategies) {
      for (const tools of input.toolSets) {
        const uniqueTools = [...new Set(tools)].sort();
        assertApplication(uniqueTools.length === tools.length, "INVALID_APPLICATION_INPUT", "Tool sets cannot contain duplicates.");
        const key = materialKey(modelId, strategy, uniqueTools);
        if (!seen.has(key)) {
          seen.add(key);
          combinations.push(Object.freeze({ modelId, strategy, toolIds: Object.freeze(uniqueTools), key }));
        }
      }
    }
  }
  if (combinations.length < input.count) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "The approved models, strategies, and tools cannot produce the requested material diversity.", {
      details: { requested: input.count, available: combinations.length },
    });
  }

  const ordered = combinations
    .map((combination, index) => ({ combination, order: seededOrder(input.seed, index) }))
    .sort((left, right) => left.order - right.order || left.combination.key.localeCompare(right.combination.key));
  const configurations = ordered.slice(0, input.count).map(({ combination }, index) =>
    Object.freeze({
      modelId: combination.modelId,
      strategy: combination.strategy,
      contextArtifactIds: Object.freeze([...new Set(input.contextArtifactIds)]),
      toolIds: combination.toolIds,
      seed: input.seed + index,
      constraints: Object.freeze([...new Set(input.constraints)]),
    }),
  );
  return Object.freeze({ configurations: Object.freeze(configurations), pairwiseMateriallyDistinct: true as const });
}
