import { assertDomain } from "../domain-errors.js";
import { ContentHash, type ContentHash as ContentHashType } from "../value-objects/content-hash.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  CandidateId,
  type CandidateId as CandidateIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  IssueId,
  type IssueId as IssueIdType,
  MissionId,
  type MissionId as MissionIdType,
  RepairId,
  type RepairId as RepairIdType,
  TrainingPacketId,
  type TrainingPacketId as TrainingPacketIdType,
} from "../value-objects/ids.js";

export type TrainingPacketStatus = "quarantined" | "verified" | "promoted" | "rejected";
export type TrainingViewKind =
  | "sft"
  | "preference"
  | "failure_diagnosis"
  | "repair"
  | "tool_use"
  | "verification"
  | "planning";

export interface TrainingView {
  readonly kind: TrainingViewKind;
  readonly artifactId: ArtifactIdType;
}

export interface TrainingPacket {
  readonly id: TrainingPacketIdType;
  readonly missionId: MissionIdType;
  readonly status: TrainingPacketStatus;
  readonly taskArtifactId: ArtifactIdType;
  readonly contextArtifactIds: readonly ArtifactIdType[];
  readonly originalCandidateIds: readonly CandidateIdType[];
  readonly preferredCandidateId: CandidateIdType;
  readonly rejectedCandidateIds: readonly CandidateIdType[];
  readonly issueIds: readonly IssueIdType[];
  readonly repairIds: readonly RepairIdType[];
  readonly verificationEvidenceIds: readonly EvidenceIdType[];
  readonly trainingViews: readonly TrainingView[];
  readonly provenanceHash: ContentHashType;
  readonly evaluationLeakageChecked: boolean;
}

const VIEW_KINDS = new Set<TrainingViewKind>([
  "sft",
  "preference",
  "failure_diagnosis",
  "repair",
  "tool_use",
  "verification",
  "planning",
]);

function unique<T extends string>(
  values: readonly T[],
  field: string,
  require = false,
): readonly T[] {
  assertDomain(
    (!require || values.length > 0) && new Set(values).size === values.length,
    "INVALID_TRAINING_PACKET",
    `${field} must contain ${require ? "at least one " : ""}unique value.`,
  );
  return Object.freeze([...values]);
}

export const TrainingPacket = Object.freeze({
  createQuarantined(input: {
    readonly id: string;
    readonly missionId: string;
    readonly taskArtifactId: string;
    readonly contextArtifactIds: readonly string[];
    readonly originalCandidateIds: readonly string[];
    readonly preferredCandidateId: string;
    readonly rejectedCandidateIds: readonly string[];
    readonly issueIds?: readonly string[];
    readonly repairIds?: readonly string[];
    readonly verificationEvidenceIds: readonly string[];
    readonly trainingViews: readonly {
      readonly kind: TrainingViewKind;
      readonly artifactId: string;
    }[];
    readonly provenanceHash: string;
    readonly evaluationLeakageChecked: boolean;
  }): TrainingPacket {
    const originals = unique(
      input.originalCandidateIds.map((id) => CandidateId.parse(id)),
      "originalCandidateIds",
      true,
    ) as readonly CandidateIdType[];
    const preferred = CandidateId.parse(input.preferredCandidateId);
    const rejected = unique(
      input.rejectedCandidateIds.map((id) => CandidateId.parse(id)),
      "rejectedCandidateIds",
    ) as readonly CandidateIdType[];
    assertDomain(
      rejected.every((id) => originals.includes(id) && id !== preferred),
      "INVALID_TRAINING_PACKET",
      "Rejected candidates must be non-preferred original candidates.",
    );
    const evidenceIds = unique(
      input.verificationEvidenceIds.map((id) => EvidenceId.parse(id)),
      "verificationEvidenceIds",
      true,
    ) as readonly EvidenceIdType[];
    assertDomain(
      input.trainingViews.length > 0,
      "INVALID_TRAINING_PACKET",
      "Training packets require at least one training view.",
    );
    const views = input.trainingViews.map((view) => {
      assertDomain(
        VIEW_KINDS.has(view.kind),
        "INVALID_TRAINING_PACKET",
        "Training view kind is invalid.",
      );
      return Object.freeze({
        kind: view.kind,
        artifactId: ArtifactId.parse(view.artifactId),
      });
    });
    assertDomain(
      new Set(views.map((view) => `${view.kind}:${view.artifactId}`)).size === views.length,
      "INVALID_TRAINING_PACKET",
      "Training views must be unique by kind and artifact.",
    );
    return Object.freeze({
      id: TrainingPacketId.parse(input.id),
      missionId: MissionId.parse(input.missionId),
      status: "quarantined" as const,
      taskArtifactId: ArtifactId.parse(input.taskArtifactId),
      contextArtifactIds: unique(
        input.contextArtifactIds.map((id) => ArtifactId.parse(id)),
        "contextArtifactIds",
      ) as readonly ArtifactIdType[],
      originalCandidateIds: originals,
      preferredCandidateId: preferred,
      rejectedCandidateIds: rejected,
      issueIds: unique(
        (input.issueIds ?? []).map((id) => IssueId.parse(id)),
        "issueIds",
      ) as readonly IssueIdType[],
      repairIds: unique(
        (input.repairIds ?? []).map((id) => RepairId.parse(id)),
        "repairIds",
      ) as readonly RepairIdType[],
      verificationEvidenceIds: evidenceIds,
      trainingViews: Object.freeze(views),
      provenanceHash: ContentHash.parse(input.provenanceHash),
      evaluationLeakageChecked: input.evaluationLeakageChecked,
    });
  },

  markVerified(packet: TrainingPacket): TrainingPacket {
    assertDomain(
      packet.status === "quarantined",
      "INVALID_STATE_TRANSITION",
      "Only quarantined packets can be verified.",
    );
    assertDomain(
      packet.evaluationLeakageChecked,
      "INVALID_TRAINING_PACKET",
      "Training packets cannot be verified before leakage checks pass.",
    );
    return Object.freeze({ ...packet, status: "verified" as const });
  },

  promote(packet: TrainingPacket): TrainingPacket {
    assertDomain(
      packet.status === "verified",
      "INVALID_STATE_TRANSITION",
      "Only verified packets can be promoted.",
    );
    return Object.freeze({ ...packet, status: "promoted" as const });
  },

  reject(packet: TrainingPacket): TrainingPacket {
    assertDomain(
      packet.status === "quarantined" || packet.status === "verified",
      "INVALID_STATE_TRANSITION",
      "Only quarantined or verified packets can be rejected.",
    );
    return Object.freeze({ ...packet, status: "rejected" as const });
  },
});
