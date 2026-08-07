import { assertDomain } from "../domain-errors.js";
import {
  CandidateId,
  type CandidateId as CandidateIdType,
  ChampionDecisionId,
  type ChampionDecisionId as ChampionDecisionIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  MissionId,
  type MissionId as MissionIdType,
} from "../value-objects/ids.js";

export type DecisionDimension =
  | "correctness"
  | "coverage"
  | "security"
  | "performance"
  | "complexity"
  | "evidence";

export interface DecisionReason {
  readonly dimension: DecisionDimension;
  readonly statement: string;
  readonly evidenceIds: readonly EvidenceIdType[];
}

export interface ChampionDecision {
  readonly id: ChampionDecisionIdType;
  readonly missionId: MissionIdType;
  readonly decision: "champion" | "no_verified_solution";
  readonly candidateId?: CandidateIdType;
  readonly paretoCandidateIds: readonly CandidateIdType[];
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly rationale: readonly DecisionReason[];
  readonly decidedAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DIMENSIONS = new Set<DecisionDimension>([
  "correctness",
  "coverage",
  "security",
  "performance",
  "complexity",
  "evidence",
]);

function create(input: {
  readonly id: string;
  readonly missionId: string;
  readonly decision: "champion" | "no_verified_solution";
  readonly candidateId?: string;
  readonly paretoCandidateIds?: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly rationale: readonly {
    readonly dimension: DecisionDimension;
    readonly statement: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly decidedAt: string;
}): ChampionDecision {
  const parsed = Date.parse(input.decidedAt);
  assertDomain(
    ISO_PATTERN.test(input.decidedAt) &&
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString() === input.decidedAt,
    "INVALID_CHAMPION_DECISION",
    "Decision time must be canonical UTC ISO-8601 with milliseconds.",
  );
  const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
  assertDomain(
    evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
    "INVALID_CHAMPION_DECISION",
    "Champion decisions require unique evidence.",
  );
  const candidateId =
    input.candidateId === undefined ? undefined : CandidateId.parse(input.candidateId);
  assertDomain(
    input.decision === "champion" ? candidateId !== undefined : candidateId === undefined,
    "INVALID_CHAMPION_DECISION",
    "Champion decisions require a candidate; no-solution decisions forbid one.",
  );
  const pareto = (input.paretoCandidateIds ?? []).map((id) => CandidateId.parse(id));
  assertDomain(
    new Set(pareto).size === pareto.length,
    "INVALID_CHAMPION_DECISION",
    "Pareto candidate IDs must be unique.",
  );
  if (candidateId !== undefined) {
    assertDomain(
      pareto.length === 0 || pareto.includes(candidateId),
      "INVALID_CHAMPION_DECISION",
      "A champion must belong to the Pareto set when one is provided.",
    );
  }
  assertDomain(
    input.rationale.length > 0,
    "INVALID_CHAMPION_DECISION",
    "Champion decisions require rationale.",
  );
  const rationale = input.rationale.map((reason) => {
    assertDomain(
      DIMENSIONS.has(reason.dimension),
      "INVALID_CHAMPION_DECISION",
      "Decision reason dimension is invalid.",
    );
    assertDomain(
      reason.statement.length > 0 &&
        reason.statement === reason.statement.trim() &&
        reason.statement.length <= 4000,
      "INVALID_CHAMPION_DECISION",
      "Decision reason must be canonical and non-empty.",
    );
    const reasonEvidence = reason.evidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      reasonEvidence.length > 0 && reasonEvidence.every((id) => evidenceIds.includes(id)),
      "INVALID_CHAMPION_DECISION",
      "Decision reasons must reference evidence included in the decision.",
    );
    return Object.freeze({
      dimension: reason.dimension,
      statement: reason.statement,
      evidenceIds: Object.freeze([...new Set(reasonEvidence)]),
    });
  });

  return Object.freeze({
    id: ChampionDecisionId.parse(input.id),
    missionId: MissionId.parse(input.missionId),
    decision: input.decision,
    ...(candidateId === undefined ? {} : { candidateId }),
    paretoCandidateIds: Object.freeze(pareto),
    evidenceIds: Object.freeze(evidenceIds),
    rationale: Object.freeze(rationale),
    decidedAt: input.decidedAt,
  });
}

export const ChampionDecision = Object.freeze({
  createChampion(
    input: Omit<Parameters<typeof create>[0], "decision"> & { readonly candidateId: string },
  ): ChampionDecision {
    return create({ ...input, decision: "champion" });
  },

  createNoVerifiedSolution(
    input: Omit<Parameters<typeof create>[0], "decision" | "candidateId">,
  ): ChampionDecision {
    return create({ ...input, decision: "no_verified_solution" });
  },
});
