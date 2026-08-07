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

export async function selectChampionUseCase(
  dependencies: SelectChampionDependencies,
  command: SelectChampionCommand,
  context: OperationContext,
): Promise<Versioned<ChampionDecisionType>> {
  const selected = selectChampion({ candidates: command.candidates });
  const common = {
    id: command.decisionId,
    missionId: command.missionId,
    paretoCandidateIds:
      selected.outcome === "no_verified_solution" ? [] : selected.paretoCandidateIds,
    evidenceIds: evidenceIds(selected.reasons),
    rationale: selected.reasons,
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
