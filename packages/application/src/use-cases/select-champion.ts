import {
  ChampionDecision,
  type ChampionDecision as ChampionDecisionType,
  type MissionId,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { Versioned } from "../port-types.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import {
  type CandidateEvaluation,
  type ChampionReason,
  selectChampion,
} from "../services/champion-selector.js";

export interface SelectChampionDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
}

export interface SelectChampionCommand {
  readonly decisionId: string;
  readonly missionId: MissionId;
  readonly decidedAt: string;
  readonly candidates: readonly CandidateEvaluation[];
}

function evidenceIds(reasons: readonly ChampionReason[]): readonly string[] {
  return Object.freeze([...new Set(reasons.flatMap((reason) => reason.evidenceIds))].sort());
}

/**
 * `selectChampion`'s `no_verified_solution` reason is a summary statement, not attributed to any
 * one candidate, so it deliberately carries no `evidenceIds` of its own. `ChampionDecision`
 * requires every decision - including a no-verified-solution one - to reference the real evidence
 * that produced it, so this falls back to the union of evidence every evaluated candidate actually
 * carries (the verification evidence that led to their exclusion), rather than to the empty set.
 */
function noVerifiedSolutionEvidenceIds(
  candidates: readonly CandidateEvaluation[],
): readonly string[] {
  return Object.freeze(
    [...new Set(candidates.flatMap((candidate) => candidate.evidenceIds))].sort(),
  );
}

export async function selectChampionUseCase(
  dependencies: SelectChampionDependencies,
  command: SelectChampionCommand,
  context: OperationContext,
): Promise<Versioned<ChampionDecisionType>> {
  const selected = selectChampion({ candidates: command.candidates });
  const isNoVerifiedSolution = selected.outcome === "no_verified_solution";
  const evidence = isNoVerifiedSolution
    ? noVerifiedSolutionEvidenceIds(command.candidates)
    : evidenceIds(selected.reasons);
  // Each rationale reason must itself reference evidence included in the decision; the
  // no_verified_solution summary reason carries no candidate-specific evidence of its own, so it
  // is stamped with the same decision-level evidence rather than left empty.
  const rationale = isNoVerifiedSolution
    ? selected.reasons.map((reason) => Object.freeze({ ...reason, evidenceIds: evidence }))
    : selected.reasons;
  const common = {
    id: command.decisionId,
    missionId: command.missionId,
    paretoCandidateIds: isNoVerifiedSolution ? [] : selected.paretoCandidateIds,
    evidenceIds: evidence,
    rationale,
    decidedAt: command.decidedAt,
  };
  const decision =
    selected.outcome === "no_verified_solution"
      ? ChampionDecision.createNoVerifiedSolution(common)
      : ChampionDecision.createChampion({
          ...common,
          candidateId:
            selected.outcome === "champion"
              ? selected.candidateId
              : selected.recommendedCandidateId,
        });
  return dependencies.unitOfWork.execute(context, (transaction) =>
    dependencies.candidates.saveChampionDecision(decision, context, transaction),
  );
}
