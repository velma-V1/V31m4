import type { ChampionDecision } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { selectChampion, type SelectChampionInput } from "../services/champion-selector.js";
import type { Versioned } from "../port-types.js";

export interface SelectChampionDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
}

export async function selectChampionUseCase(
  dependencies: SelectChampionDependencies,
  input: SelectChampionInput,
  context: OperationContext,
): Promise<Versioned<ChampionDecision>> {
  const decision = selectChampion(input);
  return dependencies.unitOfWork.execute(context, (transaction) =>
    dependencies.candidates.saveChampionDecision(decision, context, transaction),
  );
}
