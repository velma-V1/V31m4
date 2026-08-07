import { CapabilityProfile, PromotionRecord, TrainingPacket, type CapabilityId, type PromotionRecord as PromotionRecordType, type TrainingPacketId } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { CapabilityRepositoryPort } from "../ports/capability-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { TrainingStorePort } from "../ports/training-store.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { WriteConditions, type Versioned } from "../port-types.js";
import { calculateCapabilityScore, type CapabilityObservation } from "../services/capability-calculator.js";
import { requireValue } from "./use-case-support.js";

export interface PromoteCapabilityDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capabilities: CapabilityRepositoryPort;
  readonly training: TrainingStorePort;
  readonly clock: ClockPort;
}

export interface PromoteCapabilityCommand {
  readonly promotionId: string;
  readonly capabilityId: CapabilityId;
  readonly sourcePacketIds: readonly TrainingPacketId[];
  readonly heldOutEvidenceIds: readonly string[];
  readonly regressionEvidenceIds: readonly string[];
  readonly observations: readonly CapabilityObservation[];
  readonly minimumSampleSize: number;
  readonly practiceWeight: number;
}

export interface PromoteCapabilityOutcome {
  readonly promotion: Versioned<PromotionRecordType>;
  readonly profileRevision: string;
}

export async function promoteCapability(
  dependencies: PromoteCapabilityDependencies,
  command: PromoteCapabilityCommand,
  context: OperationContext,
): Promise<PromoteCapabilityOutcome> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const profile = requireValue(await dependencies.capabilities.getProfile(command.capabilityId, context, transaction), "Capability profile does not exist.");
    const packets = [];
    for (const packetId of command.sourcePacketIds) {
      const packet = requireValue(await dependencies.training.get(packetId, context, transaction), "Training packet does not exist.");
      if (packet.value.status !== "verified") {
        throw new ApplicationError("POLICY_REJECTED", "Only verified training packets can be promoted.", { details: { packetId, status: packet.value.status } });
      }
      packets.push(packet);
    }
    const score = calculateCapabilityScore({
      profile: profile.value,
      observations: command.observations,
      measuredAt: dependencies.clock.now(),
      minimumSampleSize: command.minimumSampleSize,
      practiceWeight: command.practiceWeight,
    });
    const updatedProfile = CapabilityProfile.record(profile.value, {
      capabilityId: score.capabilityId,
      score: score.score,
      sampleSize: score.sampleSize,
      difficultyRange: score.difficultyRange,
      evidenceIds: score.evidenceIds,
      measuredAt: score.measuredAt,
    });
    const record = PromotionRecord.create({
      id: command.promotionId,
      capabilityId: command.capabilityId,
      sourcePacketIds: command.sourcePacketIds,
      heldOutEvidenceIds: command.heldOutEvidenceIds,
      regressionEvidenceIds: command.regressionEvidenceIds,
      decision: "promoted",
      createdAt: dependencies.clock.now(),
    });
    const storedPromotion = await dependencies.capabilities.appendPromotion(record, context, transaction);
    const storedProfile = await dependencies.capabilities.saveProfile(updatedProfile, WriteConditions.matchRevision(profile.revision), context, transaction);
    for (const packet of packets) {
      await dependencies.training.save(TrainingPacket.promote(packet.value), WriteConditions.matchRevision(packet.revision), context, transaction);
    }
    return Object.freeze({ promotion: storedPromotion, profileRevision: storedProfile.revision });
  });
}
