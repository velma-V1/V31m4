import { assertDomain } from "../domain-errors.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  CandidateId,
  type CandidateId as CandidateIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  IssueId,
  type IssueId as IssueIdType,
  RepairId,
  type RepairId as RepairIdType,
} from "../value-objects/ids.js";

export type RepairStatus = "passed" | "failed" | "rolled_back";

const REPAIR_STATUSES = new Set<RepairStatus>(["passed", "failed", "rolled_back"]);

export interface RepairRecord {
  readonly id: RepairIdType;
  readonly issueId: IssueIdType;
  readonly sourceCandidateId: CandidateIdType;
  readonly repairedCandidateId: CandidateIdType;
  readonly changedArtifactIds: readonly ArtifactIdType[];
  readonly focusedEvidenceIds: readonly EvidenceIdType[];
  readonly regressionEvidenceIds: readonly EvidenceIdType[];
  readonly status: RepairStatus;
}

function unique<T extends string>(values: readonly T[], field: string): readonly T[] {
  assertDomain(
    values.length > 0 && new Set(values).size === values.length,
    "INVALID_REPAIR_RECORD",
    `${field} must contain at least one unique value.`,
  );
  return Object.freeze([...values]);
}

export const RepairRecord = Object.freeze({
  create(input: {
    readonly id: string;
    readonly issueId: string;
    readonly sourceCandidateId: string;
    readonly repairedCandidateId: string;
    readonly changedArtifactIds: readonly string[];
    readonly focusedEvidenceIds: readonly string[];
    readonly regressionEvidenceIds: readonly string[];
    readonly status: RepairStatus;
  }): RepairRecord {
    assertDomain(
      REPAIR_STATUSES.has(input.status),
      "INVALID_REPAIR_RECORD",
      "Repair status is invalid.",
    );
    const sourceCandidateId = CandidateId.parse(input.sourceCandidateId);
    const repairedCandidateId = CandidateId.parse(input.repairedCandidateId);
    assertDomain(
      sourceCandidateId !== repairedCandidateId,
      "INVALID_REPAIR_RECORD",
      "A repair must produce a new candidate.",
    );
    const focused = unique(
      input.focusedEvidenceIds.map((id) => EvidenceId.parse(id)),
      "focusedEvidenceIds",
    ) as readonly EvidenceIdType[];
    const regression = unique(
      input.regressionEvidenceIds.map((id) => EvidenceId.parse(id)),
      "regressionEvidenceIds",
    ) as readonly EvidenceIdType[];
    assertDomain(
      input.status !== "passed" || (focused.length > 0 && regression.length > 0),
      "INVALID_REPAIR_RECORD",
      "Passed repairs require focused and regression evidence.",
    );
    return Object.freeze({
      id: RepairId.parse(input.id),
      issueId: IssueId.parse(input.issueId),
      sourceCandidateId,
      repairedCandidateId,
      changedArtifactIds: unique(
        input.changedArtifactIds.map((id) => ArtifactId.parse(id)),
        "changedArtifactIds",
      ) as readonly ArtifactIdType[],
      focusedEvidenceIds: focused,
      regressionEvidenceIds: regression,
      status: input.status,
    });
  },
});
