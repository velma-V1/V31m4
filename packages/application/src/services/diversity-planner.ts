import {
  ResourceBudget,
  SolverCandidate,
  type SolverConfiguration,
  type SolverStrategy,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { createSeededRandom } from "./internal/deterministic.js";

/**
 * Diversity Planner.
 *
 * Produces materially different solver configurations. Diversity is measured over
 * meaningful dimensions — strategy and tool set — not wording, temperature, or model
 * size. Generation is deterministic for a given seed. Impossible requests (more
 * distinct configurations than the approved strategies and tools can support) are
 * rejected with the maximum feasible count.
 */

export interface DiversityPlannerInput {
  readonly count: number;
  readonly seed: number;
  readonly allowedStrategies: readonly SolverStrategy[];
  readonly allowedModelIds: readonly string[];
  readonly toolCatalog: readonly string[];
  readonly contextArtifactIds: readonly string[];
  readonly missionConstraints: readonly string[];
  readonly budget: ResourceBudget;
  readonly requiredToolIds?: readonly string[];
}

export interface PairwiseDistance {
  readonly left: number;
  readonly right: number;
  readonly distance: number;
  readonly material: boolean;
}

export interface DiversityPlan {
  readonly outcome: "planned";
  readonly configurations: readonly SolverConfiguration[];
  readonly pairwiseDistances: readonly PairwiseDistance[];
  readonly minimumPairwiseDistance: number;
}

export interface DiversityInfeasible {
  readonly outcome: "infeasible";
  readonly reason: "insufficient_diversity" | "budget_exceeded";
  readonly requested: number;
  readonly maximumFeasible: number;
  readonly detail: string;
}

export type DiversityPlannerResult = DiversityPlan | DiversityInfeasible;

interface CandidateSpec {
  readonly strategy: SolverStrategy;
  readonly modelId: string;
  readonly toolIds: readonly string[];
}

const STRATEGY_DIFFERENCE_WEIGHT = 2;
const MODEL_DIFFERENCE_WEIGHT = 0.25;

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertNonEmpty<T>(values: readonly T[], message: string): void {
  if (values.length === 0) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", message);
  }
}

function jaccardDistance(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return 1 - intersection / union;
}

function distance(left: CandidateSpec, right: CandidateSpec): number {
  let value = 0;
  if (left.strategy !== right.strategy) {
    value += STRATEGY_DIFFERENCE_WEIGHT;
  }
  value += jaccardDistance(left.toolIds, right.toolIds);
  if (left.modelId !== right.modelId) {
    value += MODEL_DIFFERENCE_WEIGHT;
  }
  return value;
}

/** Two configurations are materially distinct only if strategy or tool set differs. */
function isMaterial(left: CandidateSpec, right: CandidateSpec): boolean {
  return left.strategy !== right.strategy || jaccardDistance(left.toolIds, right.toolIds) > 0;
}

function buildToolSubsets(
  required: readonly string[],
  optional: readonly string[],
  maxTools: number,
): readonly string[][] {
  const subsets: string[][] = [[...required]];
  for (const tool of optional) {
    subsets.push([...required, tool]);
  }
  if (optional.length >= 2) {
    subsets.push([...required, ...optional]);
  }
  return subsets.filter((subset) => subset.length <= maxTools);
}

function buildPool(input: DiversityPlannerInput): CandidateSpec[] {
  const strategies = dedupe(input.allowedStrategies) as SolverStrategy[];
  const models = dedupe(input.allowedModelIds);
  const required = dedupe(input.requiredToolIds ?? []);
  const optional = dedupe(input.toolCatalog).filter((tool) => !required.includes(tool));
  const subsets = buildToolSubsets(required, optional, input.budget.maxToolInvocations);

  const pool: CandidateSpec[] = [];
  let modelCursor = 0;
  for (const strategy of strategies) {
    for (const toolIds of subsets) {
      const modelId = models[modelCursor % models.length] as string;
      modelCursor += 1;
      pool.push({ strategy, modelId, toolIds });
    }
  }
  return pool;
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = createSeededRandom(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = current;
  }
  return copy;
}

function greedySelect(pool: readonly CandidateSpec[], count: number): CandidateSpec[] {
  const selected: CandidateSpec[] = [];
  for (const candidate of pool) {
    if (selected.every((existing) => isMaterial(existing, candidate))) {
      selected.push(candidate);
      if (selected.length === count) {
        break;
      }
    }
  }
  return selected;
}

function toConfiguration(
  spec: CandidateSpec,
  input: DiversityPlannerInput,
  index: number,
): SolverConfiguration {
  return SolverCandidate.createConfiguration({
    modelId: spec.modelId,
    strategy: spec.strategy,
    contextArtifactIds: input.contextArtifactIds,
    toolIds: spec.toolIds,
    seed: (input.seed + index) >>> 0,
    constraints: input.missionConstraints,
  });
}

function computeDistances(specs: readonly CandidateSpec[]): {
  readonly pairwise: PairwiseDistance[];
  readonly minimum: number;
} {
  const pairwise: PairwiseDistance[] = [];
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < specs.length; left += 1) {
    for (let right = left + 1; right < specs.length; right += 1) {
      const a = specs[left] as CandidateSpec;
      const b = specs[right] as CandidateSpec;
      const value = distance(a, b);
      minimum = Math.min(minimum, value);
      pairwise.push(Object.freeze({ left, right, distance: value, material: isMaterial(a, b) }));
    }
  }
  return { pairwise, minimum: Number.isFinite(minimum) ? minimum : 0 };
}

/** Plans a set of materially distinct solver configurations, or reports infeasibility. */
export function planDiversity(input: DiversityPlannerInput): DiversityPlannerResult {
  if (!Number.isSafeInteger(input.count) || input.count <= 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "count must be a positive safe integer.",
    );
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "seed must be a non-negative safe integer.",
    );
  }
  assertNonEmpty(input.allowedStrategies, "allowedStrategies must not be empty.");
  assertNonEmpty(input.allowedModelIds, "allowedModelIds must not be empty.");
  ResourceBudget.create(input.budget);

  const required = dedupe(input.requiredToolIds ?? []);
  if (required.length > input.budget.maxToolInvocations) {
    return Object.freeze({
      outcome: "infeasible",
      reason: "budget_exceeded",
      requested: input.count,
      maximumFeasible: 0,
      detail: "Required tools exceed the tool-invocation budget.",
    });
  }
  if (input.count > input.budget.maxConcurrentWorkers) {
    return Object.freeze({
      outcome: "infeasible",
      reason: "budget_exceeded",
      requested: input.count,
      maximumFeasible: input.budget.maxConcurrentWorkers,
      detail: "Requested configuration count exceeds the concurrent-worker budget.",
    });
  }

  const pool = seededShuffle(buildPool(input), input.seed);
  const selected = greedySelect(pool, input.count);
  if (selected.length < input.count) {
    return Object.freeze({
      outcome: "infeasible",
      reason: "insufficient_diversity",
      requested: input.count,
      maximumFeasible: selected.length,
      detail:
        "The approved strategies and tools cannot produce the requested number of materially distinct configurations.",
    });
  }

  const configurations = selected.map((spec, index) => toConfiguration(spec, input, index));
  const { pairwise, minimum } = computeDistances(selected);
  return Object.freeze({
    outcome: "planned",
    configurations: Object.freeze(configurations),
    pairwiseDistances: Object.freeze(pairwise),
    minimumPairwiseDistance: minimum,
  });
}

export const DiversityPlanner = Object.freeze({ plan: planDiversity });
