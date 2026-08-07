import {
  type CapabilityId,
  CapabilityProfile,
  PromotionRecord,
  type PromotionRecord as PromotionRecordType,
  TrainingPacket,
  type TrainingPacketId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { CapabilityRepositoryPort } from "../ports/capability-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { TrainingStorePort } from "../ports/training-store.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import {
  type CapabilityMeasurement,
  calculateCapability,
} from "../services/capability-calculator.js";
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
  readonly measurements: readonly CapabilityMeasurement[];
  readonly minimumSampleSize: number;
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
    const profile = requireValue(
      await dependencies.capabilities.getProfile(command.capabilityId, context, transaction),
      "Capability profile does not exist.",
    );
    const packets = [];
    for (const packetId of command.sourcePacketIds) {
      const packet = requireValue(
        await dependencies.training.get(packetId, context, transaction),
        "Training packet does not exist.",
      );
      if (packet.value.status !== "verified") {
        throw new ApplicationError(
          "POLICY_REJECTED",
          "Only verified training packets can be promoted.",
          { details: { packetId, status: packet.value.status } },
        );
      }
      packets.push(packet);
    }
    const score = calculateCapability({
      current: profile.value,
      measurements: command.measurements,
      now: dependencies.clock.now(),
      minimumSampleSize: command.minimumSampleSize,
    });
    if (score.outcome !== "updated") {
      throw new ApplicationError("POLICY_REJECTED", score.detail, {
        details: {
          productionSampleSize: score.productionSampleSize,
          requiredSampleSize: score.requiredSampleSize,
        },
      });
    }
    const updatedProfile = CapabilityProfile.record(profile.value, score.nextScore);
    const record = PromotionRecord.create({
      id: command.promotionId,
      capabilityId: command.capabilityId,
      sourcePacketIds: command.sourcePacketIds,
      heldOutEvidenceIds: command.heldOutEvidenceIds,
      regressionEvidenceIds: command.regressionEvidenceIds,
      decision: "promoted",
      createdAt: dependencies.clock.now(),
    });
    const storedPromotion = await dependencies.capabilities.appendPromotion(
      record,
      context,
      transaction,
    );
    const storedProfile = await dependencies.capabilities.saveProfile(
      updatedProfile,
      WriteConditions.matchRevision(profile.revision),
      context,
      transaction,
    );
    for (const packet of packets) {
      await dependencies.training.save(
        TrainingPacket.promote(packet.value),
        WriteConditions.matchRevision(packet.revision),
        context,
        transaction,
      );
    }
    return Object.freeze({ promotion: storedPromotion, profileRevision: storedProfile.revision });
  });
}
