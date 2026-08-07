import type { EvidenceKind, EvidenceRecord, EvidenceStatus, MissionContract } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export interface CriterionEvidenceCoverage {
  readonly criterionId: string;
  readonly requiredKinds: readonly EvidenceKind[];
  readonly evidenceIds: readonly string[];
  readonly status: EvidenceStatus | "missing" | "conflicting";
  readonly missingKinds: readonly EvidenceKind[];
}

export interface EvidenceLinkResult {
  readonly criteria: readonly CriterionEvidenceCoverage[];
  readonly mandatoryCovered: number;
  readonly mandatoryTotal: number;
  readonly orphanEvidenceIds: readonly string[];
}

function statusFor(records: readonly EvidenceRecord[]): EvidenceStatus | "missing" | "conflicting" {
  if (records.length === 0) return "missing";
  const statuses = new Set(records.map((record) => record.status));
  if (statuses.has("passed") && statuses.has("failed")) return "conflicting";
  if (statuses.has("failed")) return "failed";
  if (statuses.has("inconclusive")) return "inconclusive";
  return "passed";
}

export function linkMissionEvidence(mission: MissionContract, evidence: readonly EvidenceRecord[]): EvidenceLinkResult {
  const criterionIds = new Set(mission.acceptanceCriteria.map((criterion) => criterion.id));
  const duplicateIds = evidence.map((record) => record.id);
  assertApplication(new Set(duplicateIds).size === duplicateIds.length, "INVALID_APPLICATION_INPUT", "Evidence IDs must be unique.");

  const orphanEvidenceIds = evidence
    .filter((record) => record.subjectType === "acceptance_criterion" && !criterionIds.has(record.subjectId))
    .map((record) => String(record.id))
    .sort();
  const criteria = mission.acceptanceCriteria.map((criterion) => {
    const required = mission.evidenceRequirements.find((rule) => rule.criterionId === criterion.id)?.requiredEvidenceKinds ?? [];
    const linked = evidence.filter(
      (record) => record.subjectType === "acceptance_criterion" && record.subjectId === criterion.id,
    );
    const passedKinds = new Set(linked.filter((record) => record.status === "passed").map((record) => record.kind));
    const missingKinds = required.filter((kind) => !passedKinds.has(kind));
    const rawStatus = statusFor(linked);
    const status = rawStatus === "passed" && missingKinds.length > 0 ? "missing" : rawStatus;
    return Object.freeze({
      criterionId: criterion.id,
      requiredKinds: Object.freeze([...required]),
      evidenceIds: Object.freeze(linked.map((record) => String(record.id)).sort()),
      status,
      missingKinds: Object.freeze([...missingKinds]),
    });
  });
  const mandatory = mission.acceptanceCriteria.filter((criterion) => criterion.mandatory);
  const mandatoryCovered = mandatory.filter((criterion) => criteria.find((value) => value.criterionId === criterion.id)?.status === "passed").length;
  return Object.freeze({
    criteria: Object.freeze(criteria),
    mandatoryCovered,
    mandatoryTotal: mandatory.length,
    orphanEvidenceIds: Object.freeze(orphanEvidenceIds),
  });
}
