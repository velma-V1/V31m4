import {
  type ChampionDecision,
  DeliveryReceipt,
  type DeliveryReceipt as DeliveryReceiptType,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { Versioned } from "../port-types.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";

export interface DeliverResultDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
  readonly clock: ClockPort;
}

export interface DeliverResultCommand {
  readonly receiptId: string;
  readonly decision: ChampionDecision;
  readonly deliveredArtifactIds: readonly string[];
  readonly requirementsCovered: number;
  readonly requirementsTotal: number;
  readonly mandatoryChecksPassed: number;
  readonly mandatoryChecksTotal: number;
  readonly unresolvedRiskIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export async function deliverResult(
  dependencies: DeliverResultDependencies,
  command: DeliverResultCommand,
  context: OperationContext,
): Promise<Versioned<DeliveryReceiptType>> {
  const receipt = DeliveryReceipt.create({
    id: command.receiptId,
    missionId: command.decision.missionId,
    decision: command.decision.decision,
    deliveredArtifactIds: command.deliveredArtifactIds,
    requirementsCovered: command.requirementsCovered,
    requirementsTotal: command.requirementsTotal,
    mandatoryChecksPassed: command.mandatoryChecksPassed,
    mandatoryChecksTotal: command.mandatoryChecksTotal,
    unresolvedRiskIds: command.unresolvedRiskIds,
    evidenceIds: command.evidenceIds,
    createdAt: dependencies.clock.now(),
  });
  return dependencies.unitOfWork.execute(context, (transaction) =>
    dependencies.candidates.saveDeliveryReceipt(receipt, context, transaction),
  );
}
