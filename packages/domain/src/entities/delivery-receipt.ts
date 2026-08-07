import { assertDomain } from "../domain-errors.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  DeliveryReceiptId,
  type DeliveryReceiptId as DeliveryReceiptIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  IssueId,
  type IssueId as IssueIdType,
  MissionId,
  type MissionId as MissionIdType,
} from "../value-objects/ids.js";
import type { ChampionDecision } from "./champion-decision.js";

export interface DeliveryReceipt {
  readonly id: DeliveryReceiptIdType;
  readonly missionId: MissionIdType;
  readonly decision: ChampionDecision["decision"];
  readonly deliveredArtifactIds: readonly ArtifactIdType[];
  readonly requirementsCovered: number;
  readonly requirementsTotal: number;
  readonly mandatoryChecksPassed: number;
  readonly mandatoryChecksTotal: number;
  readonly unresolvedRiskIds: readonly IssueIdType[];
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECISIONS = new Set<ChampionDecision["decision"]>(["champion", "no_verified_solution"]);

function validateCount(passed: number, total: number, label: string): void {
  assertDomain(
    Number.isSafeInteger(passed) &&
      Number.isSafeInteger(total) &&
      total >= 0 &&
      passed >= 0 &&
      passed <= total,
    "INVALID_DELIVERY_RECEIPT",
    `${label} counts must be non-negative safe integers with passed <= total.`,
  );
}

export const DeliveryReceipt = Object.freeze({
  create(input: {
    readonly id: string;
    readonly missionId: string;
    readonly decision: ChampionDecision["decision"];
    readonly deliveredArtifactIds?: readonly string[];
    readonly requirementsCovered: number;
    readonly requirementsTotal: number;
    readonly mandatoryChecksPassed: number;
    readonly mandatoryChecksTotal: number;
    readonly unresolvedRiskIds?: readonly string[];
    readonly evidenceIds: readonly string[];
    readonly createdAt: string;
  }): DeliveryReceipt {
    assertDomain(
      DECISIONS.has(input.decision),
      "INVALID_DELIVERY_RECEIPT",
      "Delivery decision is invalid.",
    );
    const parsed = Date.parse(input.createdAt);
    assertDomain(
      ISO_PATTERN.test(input.createdAt) &&
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString() === input.createdAt,
      "INVALID_DELIVERY_RECEIPT",
      "Receipt creation time must be canonical UTC ISO-8601 with milliseconds.",
    );
    validateCount(input.requirementsCovered, input.requirementsTotal, "Requirement");
    validateCount(input.mandatoryChecksPassed, input.mandatoryChecksTotal, "Mandatory check");
    const deliveredArtifactIds = (input.deliveredArtifactIds ?? []).map((id) =>
      ArtifactId.parse(id),
    );
    assertDomain(
      input.decision !== "champion" || deliveredArtifactIds.length > 0,
      "INVALID_DELIVERY_RECEIPT",
      "Champion deliveries require at least one delivered artifact.",
    );
    assertDomain(
      input.decision !== "champion" ||
        (input.requirementsCovered === input.requirementsTotal &&
          input.mandatoryChecksPassed === input.mandatoryChecksTotal),
      "INVALID_DELIVERY_RECEIPT",
      "Champion delivery requires full requirement and mandatory-check coverage.",
    );
    const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_DELIVERY_RECEIPT",
      "Delivery receipts require unique evidence.",
    );
    return Object.freeze({
      id: DeliveryReceiptId.parse(input.id),
      missionId: MissionId.parse(input.missionId),
      decision: input.decision,
      deliveredArtifactIds: Object.freeze([...new Set(deliveredArtifactIds)]),
      requirementsCovered: input.requirementsCovered,
      requirementsTotal: input.requirementsTotal,
      mandatoryChecksPassed: input.mandatoryChecksPassed,
      mandatoryChecksTotal: input.mandatoryChecksTotal,
      unresolvedRiskIds: Object.freeze([
        ...new Set((input.unresolvedRiskIds ?? []).map((id) => IssueId.parse(id))),
      ]),
      evidenceIds: Object.freeze(evidenceIds),
      createdAt: input.createdAt,
    });
  },
});
