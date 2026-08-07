import { assertDomain } from "../domain-errors.js";
import { ContentHash, type ContentHash as ContentHashType } from "../value-objects/content-hash.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  CheckpointId,
  type CheckpointId as CheckpointIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  JobId,
  type JobId as JobIdType,
} from "../value-objects/ids.js";

export interface Checkpoint {
  readonly id: CheckpointIdType;
  readonly jobId: JobIdType;
  readonly stage: string;
  readonly stateArtifactId: ArtifactIdType;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly contentHash: ContentHashType;
  readonly verified: boolean;
  readonly createdAt: string;
}

export interface CreateCheckpointInput {
  readonly id: string;
  readonly jobId: string;
  readonly stage: string;
  readonly stateArtifactId: string;
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
  readonly verified: boolean;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const Checkpoint = Object.freeze({
  create(input: CreateCheckpointInput): Checkpoint {
    const parsed = Date.parse(input.createdAt);
    assertDomain(
      ISO_PATTERN.test(input.createdAt) &&
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString() === input.createdAt,
      "INVALID_CHECKPOINT",
      "Checkpoint creation time must be canonical UTC ISO-8601 with milliseconds.",
    );
    assertDomain(
      input.stage.length > 0 && input.stage === input.stage.trim(),
      "INVALID_CHECKPOINT",
      "Checkpoint stage must be canonical and non-empty.",
    );
    const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_CHECKPOINT",
      "Checkpoint evidence IDs must be unique.",
    );
    assertDomain(
      !input.verified || evidenceIds.length > 0,
      "INVALID_CHECKPOINT",
      "A verified checkpoint must reference verification evidence.",
    );
    return Object.freeze({
      id: CheckpointId.parse(input.id),
      jobId: JobId.parse(input.jobId),
      stage: input.stage,
      stateArtifactId: ArtifactId.parse(input.stateArtifactId),
      evidenceIds: Object.freeze(evidenceIds),
      contentHash: ContentHash.parse(input.contentHash),
      verified: input.verified,
      createdAt: input.createdAt,
    });
  },
});
