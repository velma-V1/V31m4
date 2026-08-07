import { Score, type VerificationResult } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Champion Selector.
 *
 * Selects a single verified champion, a Pareto set when no candidate dominates, or no
 * verified solution. Only candidates that passed every mandatory verification check and
 * carry no unresolved critical risk are eligible. Model confidence and model size are
 * not inputs and cannot influence the decision; comparison uses verified metrics only.
 */

export interface CandidateMetrics {
  readonly correctness: number;
  readonly coverage: number;
  readonly security: number;
  readonly performance: number;
  /** Structural complexity in [0, 1]; lower is better and is inverted for comparison. */
  readonly complexity: number;
  readonly evidenceStrength: number;
}

export interface CandidateEvaluation {
  readonly candidateId: string;
  readonly verification: VerificationResult;
  readonly metrics: CandidateMetrics;
  readonly unresolvedCriticalRisks: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface ChampionSelectorInput {
  readonly candidates: readonly CandidateEvaluation[];
}

export type ExclusionReason =
  | "mandatory_check_failed"
  | "missing_or_inconclusive_mandatory_checks"
  | "no_mandatory_checks"
  | "unresolved_critical_risk";

export interface ExcludedCandidate {
  readonly candidateId: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
  readonly criticalRisks: readonly string[];
}

export type ComparisonDimension =
  | "correctness"
  | "coverage"
  | "security"
  | "performance"
  | "complexity"
  | "evidence";

export interface ChampionReason {
  readonly dimension: ComparisonDimension;
  readonly statement: string;
  readonly evidenceIds: readonly string[];
}

export interface ChampionResult {
  readonly outcome: "champion";
  readonly candidateId: string;
  readonly paretoCandidateIds: readonly string[];
  readonly reasons: readonly ChampionReason[];
  readonly excluded: readonly ExcludedCandidate[];
}

export interface ParetoResult {
  readonly outcome: "pareto";
  readonly paretoCandidateIds: readonly string[];
  readonly recommendedCandidateId: string;
  readonly reasons: readonly ChampionReason[];
  readonly excluded: readonly ExcludedCandidate[];
}

export interface NoVerifiedSolutionResult {
  readonly outcome: "no_verified_solution";
  readonly reasons: readonly ChampionReason[];
  readonly excluded: readonly ExcludedCandidate[];
}

export type ChampionSelectorResult = ChampionResult | ParetoResult | NoVerifiedSolutionResult;

const DIMENSIONS: readonly (keyof CandidateMetrics)[] = [
  "correctness",
  "coverage",
  "security",
  "performance",
  "complexity",
  "evidenceStrength",
];

function assertMetrics(candidateId: string, metrics: CandidateMetrics): void {
  for (const dimension of DIMENSIONS) {
    try {
      Score.parse(metrics[dimension]);
    } catch {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        `Candidate metric ${dimension} must be between 0 and 1.`,
        { details: { candidateId, dimension } },
      );
    }
  }
}

/** Comparison vector where every element is "higher is better". */
function comparisonVector(metrics: CandidateMetrics): readonly number[] {
  return [
    metrics.correctness,
    metrics.coverage,
    metrics.security,
    metrics.performance,
    1 - metrics.complexity,
    metrics.evidenceStrength,
  ];
}

function dominates(left: CandidateEvaluation, right: CandidateEvaluation): boolean {
  const a = comparisonVector(left.metrics);
  const b = comparisonVector(right.metrics);
  let strictlyBetter = false;
  for (let index = 0; index < a.length; index += 1) {
    const leftValue = a[index] as number;
    const rightValue = b[index] as number;
    if (leftValue < rightValue) {
      return false;
    }
    if (leftValue > rightValue) {
      strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

function aggregateScore(metrics: CandidateMetrics): number {
  return comparisonVector(metrics).reduce((sum, value) => sum + value, 0);
}

function classifyExclusion(candidate: CandidateEvaluation): ExcludedCandidate | undefined {
  const { verification } = candidate;
  if (candidate.unresolvedCriticalRisks.length > 0) {
    return Object.freeze({
      candidateId: candidate.candidateId,
      reason: "unresolved_critical_risk",
      detail: "Candidate has unresolved critical risks and cannot be a champion.",
      criticalRisks: Object.freeze([...candidate.unresolvedCriticalRisks]),
    });
  }
  if (verification.status === "failed") {
    return Object.freeze({
      candidateId: candidate.candidateId,
      reason: "mandatory_check_failed",
      detail: "Candidate failed a mandatory verification check.",
      criticalRisks: Object.freeze([]),
    });
  }
  if (verification.status === "inconclusive") {
    return Object.freeze({
      candidateId: candidate.candidateId,
      reason: "missing_or_inconclusive_mandatory_checks",
      detail: "Candidate has missing or inconclusive mandatory verification checks.",
      criticalRisks: Object.freeze([]),
    });
  }
  if (verification.mandatoryChecksTotal === 0) {
    return Object.freeze({
      candidateId: candidate.candidateId,
      reason: "no_mandatory_checks",
      detail: "Candidate has no mandatory verification checks and cannot be certified.",
      criticalRisks: Object.freeze([]),
    });
  }
  return undefined;
}

function buildReasons(champion: CandidateEvaluation): ChampionReason[] {
  const labels: Readonly<Record<ComparisonDimension, number>> = {
    correctness: champion.metrics.correctness,
    coverage: champion.metrics.coverage,
    security: champion.metrics.security,
    performance: champion.metrics.performance,
    complexity: 1 - champion.metrics.complexity,
    evidence: champion.metrics.evidenceStrength,
  };
  return (Object.keys(labels) as ComparisonDimension[]).map((dimension) =>
    Object.freeze({
      dimension,
      statement: `Verified ${dimension} score ${labels[dimension].toFixed(3)}.`,
      evidenceIds: Object.freeze([...champion.evidenceIds]),
    }),
  );
}

/** Selects a verified champion, a Pareto set, or no verified solution. */
export function selectChampion(input: ChampionSelectorInput): ChampionSelectorResult {
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (seen.has(candidate.candidateId)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Duplicate candidate id.", {
        details: { candidateId: candidate.candidateId },
      });
    }
    seen.add(candidate.candidateId);
    assertMetrics(candidate.candidateId, candidate.metrics);
  }

  const excluded: ExcludedCandidate[] = [];
  const eligible: CandidateEvaluation[] = [];
  for (const candidate of input.candidates) {
    const exclusion = classifyExclusion(candidate);
    if (exclusion === undefined) {
      eligible.push(candidate);
    } else {
      excluded.push(exclusion);
    }
  }
  const orderedExcluded = stableSortBy(excluded, (entry) => entry.candidateId);

  if (eligible.length === 0) {
    return Object.freeze({
      outcome: "no_verified_solution",
      reasons: Object.freeze([
        Object.freeze({
          dimension: "evidence" as const,
          statement: "No candidate passed mandatory verification without unresolved critical risk.",
          evidenceIds: Object.freeze([]),
        }),
      ]),
      excluded: Object.freeze(orderedExcluded),
    });
  }

  const pareto = eligible.filter(
    (candidate) => !eligible.some((other) => other !== candidate && dominates(other, candidate)),
  );
  const orderedPareto = stableSortBy(pareto, (candidate) => candidate.candidateId);
  const paretoIds = Object.freeze(orderedPareto.map((candidate) => candidate.candidateId));

  if (orderedPareto.length === 1) {
    const champion = orderedPareto[0] as CandidateEvaluation;
    return Object.freeze({
      outcome: "champion",
      candidateId: champion.candidateId,
      paretoCandidateIds: paretoIds,
      reasons: Object.freeze(buildReasons(champion)),
      excluded: Object.freeze(orderedExcluded),
    });
  }

  // No single dominator: preserve the Pareto set and recommend deterministically.
  const recommended = stableSortBy(
    orderedPareto,
    (candidate) => `${(1 - aggregateScore(candidate.metrics)).toFixed(6)}:${candidate.candidateId}`,
  )[0] as CandidateEvaluation;
  return Object.freeze({
    outcome: "pareto",
    paretoCandidateIds: paretoIds,
    recommendedCandidateId: recommended.candidateId,
    reasons: Object.freeze(buildReasons(recommended)),
    excluded: Object.freeze(orderedExcluded),
  });
}

export const ChampionSelector = Object.freeze({ select: selectChampion });
