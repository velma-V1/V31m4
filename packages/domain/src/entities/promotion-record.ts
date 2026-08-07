import { assertDomain } from "../domain-errors.js";
import {
  CapabilityId,
  type CapabilityId as CapabilityIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  PromotionId,
  type PromotionId as PromotionIdType,
  TrainingPacketId,
  type TrainingPacketId as TrainingPacketIdType,
} from "../value-objects/ids.js";

export type PromotionDecision = "promoted" | "rejected" | "rolled_back";

export interface PromotionRecord {
  readonly id: PromotionIdType;
  readonly capabilityId: CapabilityIdType;
  readonly sourcePacketIds: readonly TrainingPacketIdType[];
  readonly heldOutEvidenceIds: readonly EvidenceIdType[];
  readonly regressionEvidenceIds: readonly EvidenceIdType[];
  readonly decision: PromotionDecision;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECISIONS = new Set<PromotionDecision>(["promoted", "rejected", "rolled_back"]);

export const PromotionRecord = Object.freeze({
  create(input: {
    readonly id: string;
    readonly capabilityId: string;
    readonly sourcePacketIds: readonly string[];
    readonly heldOutEvidenceIds: readonly string[];
    readonly regressionEvidenceIds: readonly string[];
    readonly decision: PromotionDecision;
    readonly createdAt: string;
  }): PromotionRecord {
    assertDomain(
      DECISIONS.has(input.decision),
      "INVALID_PROMOTION_RECORD",
      "Promotion decision is invalid.",
    );
    const parsed = Date.parse(input.createdAt);
    assertDomain(
      ISO_PATTERN.test(input.createdAt) &&
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString() === input.createdAt,
      "INVALID_PROMOTION_RECORD",
      "Promotion record time must be canonical UTC ISO-8601 with milliseconds.",
    );
    const sourcePacketIds = input.sourcePacketIds.map((id) => TrainingPacketId.parse(id));
    const heldOutEvidenceIds = input.heldOutEvidenceIds.map((id) => EvidenceId.parse(id));
    const regressionEvidenceIds = input.regressionEvidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      sourcePacketIds.length > 0 &&
        heldOutEvidenceIds.length > 0 &&
        regressionEvidenceIds.length > 0 &&
        new Set(sourcePacketIds).size === sourcePacketIds.length &&
        new Set(heldOutEvidenceIds).size === heldOutEvidenceIds.length &&
        new Set(regressionEvidenceIds).size === regressionEvidenceIds.length,
      "INVALID_PROMOTION_RECORD",
      "Promotion records require unique source packets, held-out evidence, and regression evidence.",
    );
    return Object.freeze({
      id: PromotionId.parse(input.id),
      capabilityId: CapabilityId.parse(input.capabilityId),
      sourcePacketIds: Object.freeze(sourcePacketIds),
      heldOutEvidenceIds: Object.freeze(heldOutEvidenceIds),
      regressionEvidenceIds: Object.freeze(regressionEvidenceIds),
      decision: input.decision,
      createdAt: input.createdAt,
    });
  },
});
