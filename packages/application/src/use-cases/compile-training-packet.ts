import { TrainingPacket, type TrainingPacket as TrainingPacketType, type TrainingViewKind } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { TrainingStorePort } from "../ports/training-store.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { WriteConditions, type Versioned } from "../port-types.js";

export interface CompileTrainingPacketDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly training: TrainingStorePort;
}

export interface CompileTrainingPacketCommand {
  readonly id: string;
  readonly missionId: string;
  readonly taskArtifactId: string;
  readonly contextArtifactIds: readonly string[];
  readonly originalCandidateIds: readonly string[];
  readonly preferredCandidateId: string;
  readonly rejectedCandidateIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly repairIds: readonly string[];
  readonly verificationEvidenceIds: readonly string[];
  readonly trainingViews: readonly { readonly kind: TrainingViewKind; readonly artifactId: string }[];
  readonly provenanceHash: string;
  readonly evaluationLeakageChecked: boolean;
}

export async function compileTrainingPacket(
  dependencies: CompileTrainingPacketDependencies,
  command: CompileTrainingPacketCommand,
  context: OperationContext,
): Promise<Versioned<TrainingPacketType>> {
  const packet = TrainingPacket.createQuarantined(command);
  return dependencies.unitOfWork.execute(context, (transaction) =>
    dependencies.training.save(packet, WriteConditions.mustNotExist(), context, transaction),
  );
}
