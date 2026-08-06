import { assertDomain } from "../domain-errors.js";
import {
  ArtifactId,
  CandidateId,
  MissionId,
  ModelId,
  ToolId,
  type ArtifactId as ArtifactIdType,
  type CandidateId as CandidateIdType,
  type MissionId as MissionIdType,
  type ModelId as ModelIdType,
  type ToolId as ToolIdType,
} from "../value-objects/ids.js";

export type SolverStrategy =
  | "direct"
  | "minimal_change"
  | "specification_first"
  | "failure_first"
  | "performance_constrained"
  | "clean_room"
  | "adversarial";

export interface SolverConfiguration {
  readonly modelId: ModelIdType;
  readonly strategy: SolverStrategy;
  readonly contextArtifactIds: readonly ArtifactIdType[];
  readonly toolIds: readonly ToolIdType[];
  readonly temperature?: number;
  readonly seed?: number;
  readonly constraints: readonly string[];
}

export interface SolverCandidate {
  readonly id: CandidateIdType;
  readonly missionId: MissionIdType;
  readonly parentCandidateIds: readonly CandidateIdType[];
  readonly configuration: SolverConfiguration;
  readonly responseArtifactId: ArtifactIdType;
  readonly outputArtifactIds: readonly ArtifactIdType[];
  readonly toolTraceArtifactId?: ArtifactIdType;
  readonly original: boolean;
  readonly createdAt: string;
}

export interface SolverConfigurationInput {
  readonly modelId: string;
  readonly strategy: SolverStrategy;
  readonly contextArtifactIds: readonly string[];
  readonly toolIds?: readonly string[];
  readonly temperature?: number;
  readonly seed?: number;
  readonly constraints?: readonly string[];
}

export interface CreateCandidateInput {
  readonly id: string;
  readonly missionId: string;
  readonly configuration: SolverConfigurationInput;
  readonly responseArtifactId: string;
  readonly outputArtifactIds: readonly string[];
  readonly toolTraceArtifactId?: string;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const STRATEGIES = new Set<SolverStrategy>([
  "direct",
  "minimal_change",
  "specification_first",
  "failure_first",
  "performance_constrained",
  "clean_room",
  "adversarial",
]);

function validateTimestamp(value: string): void {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_SOLVER_CANDIDATE",
    "Candidate creation time must be canonical UTC ISO-8601 with milliseconds.",
  );
}

function unique<T extends string>(values: readonly T[], field: string): readonly T[] {
  assertDomain(
    new Set(values).size === values.length,
    "INVALID_SOLVER_CANDIDATE",
    `${field} values must be unique.`,
  );
  return Object.freeze([...values]);
}

function createConfiguration(input: SolverConfigurationInput): SolverConfiguration {
  assertDomain(
    STRATEGIES.has(input.strategy),
    "INVALID_SOLVER_CANDIDATE",
    "Solver strategy is invalid.",
  );
  if (input.temperature !== undefined) {
    assertDomain(
      Number.isFinite(input.temperature) && input.temperature >= 0 && input.temperature <= 2,
      "INVALID_SOLVER_CANDIDATE",
      "Solver temperature must be between 0 and 2.",
    );
  }
  if (input.seed !== undefined) {
    assertDomain(
      Number.isSafeInteger(input.seed) && input.seed >= 0,
      "INVALID_SOLVER_CANDIDATE",
      "Solver seed must be a non-negative safe integer.",
    );
  }
  const constraints = (input.constraints ?? []).map((value) => value.trim());
  assertDomain(
    constraints.every((value) => value.length > 0 && value.length <= 1000) &&
      new Set(constraints).size === constraints.length,
    "INVALID_SOLVER_CANDIDATE",
    "Solver constraints must be unique canonical strings.",
  );
  return Object.freeze({
    modelId: ModelId.parse(input.modelId),
    strategy: input.strategy,
    contextArtifactIds: unique(
      input.contextArtifactIds.map((id) => ArtifactId.parse(id)),
      "contextArtifactIds",
    ) as readonly ArtifactIdType[],
    toolIds: unique(
      (input.toolIds ?? []).map((id) => ToolId.parse(id)),
      "toolIds",
    ) as readonly ToolIdType[],
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    constraints: Object.freeze(constraints),
  });
}

function create(
  input: CreateCandidateInput,
  parentCandidateIds: readonly string[],
  original: boolean,
): SolverCandidate {
  validateTimestamp(input.createdAt);
  const id = CandidateId.parse(input.id);
  const parents = unique(
    parentCandidateIds.map((parentId) => CandidateId.parse(parentId)),
    "parentCandidateIds",
  ) as readonly CandidateIdType[];
  assertDomain(
    original ? parents.length === 0 : parents.length > 0,
    "INVALID_SOLVER_CANDIDATE",
    original
      ? "Original candidates cannot have parents."
      : "Reconstructed candidates require at least one parent.",
  );
  assertDomain(
    !parents.includes(id),
    "INVALID_SOLVER_CANDIDATE",
    "Candidate lineage cannot contain a direct self-reference.",
  );
  const outputs = unique(
    input.outputArtifactIds.map((artifactId) => ArtifactId.parse(artifactId)),
    "outputArtifactIds",
  ) as readonly ArtifactIdType[];
  assertDomain(
    outputs.length > 0,
    "INVALID_SOLVER_CANDIDATE",
    "A candidate must produce at least one output artifact.",
  );
  return Object.freeze({
    id,
    missionId: MissionId.parse(input.missionId),
    parentCandidateIds: parents,
    configuration: createConfiguration(input.configuration),
    responseArtifactId: ArtifactId.parse(input.responseArtifactId),
    outputArtifactIds: outputs,
    ...(input.toolTraceArtifactId === undefined
      ? {}
      : { toolTraceArtifactId: ArtifactId.parse(input.toolTraceArtifactId) }),
    original,
    createdAt: input.createdAt,
  });
}

export const SolverCandidate = Object.freeze({
  createConfiguration,

  createOriginal(input: CreateCandidateInput): SolverCandidate {
    return create(input, [], true);
  },

  createReconstructed(
    input: CreateCandidateInput,
    parentCandidateIds: readonly string[],
  ): SolverCandidate {
    return create(input, parentCandidateIds, false);
  },
});
