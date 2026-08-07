import { assertDomain } from "../domain-errors.js";
import { ContentHash, type ContentHash as ContentHashType } from "../value-objects/content-hash.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  JobId,
  type JobId as JobIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
} from "../value-objects/ids.js";
import { SafePath, type SafePath as SafePathType } from "../value-objects/safe-path.js";

export type ArtifactKind =
  | "source"
  | "document"
  | "image"
  | "video"
  | "audio"
  | "three_d_scene"
  | "game_project"
  | "mod_package"
  | "test_report"
  | "log"
  | "dataset"
  | "model_checkpoint"
  | "other";

export interface Artifact {
  readonly id: ArtifactIdType;
  readonly projectId: ProjectIdType;
  readonly jobId?: JobIdType;
  readonly kind: ArtifactKind;
  readonly logicalPath: SafePathType;
  readonly contentHash: ContentHashType;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly createdAt: string;
  readonly parentArtifactIds: readonly ArtifactIdType[];
}

export interface CreateArtifactInput {
  readonly id: string;
  readonly projectId: string;
  readonly jobId?: string;
  readonly kind: ArtifactKind;
  readonly logicalPath: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly createdAt: string;
  readonly parentArtifactIds?: readonly string[];
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const KINDS = new Set<ArtifactKind>([
  "source",
  "document",
  "image",
  "video",
  "audio",
  "three_d_scene",
  "game_project",
  "mod_package",
  "test_report",
  "log",
  "dataset",
  "model_checkpoint",
  "other",
]);
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;

export const Artifact = Object.freeze({
  create(input: CreateArtifactInput): Artifact {
    const parsedTime = Date.parse(input.createdAt);
    assertDomain(
      ISO_PATTERN.test(input.createdAt) &&
        Number.isFinite(parsedTime) &&
        new Date(parsedTime).toISOString() === input.createdAt,
      "INVALID_ARTIFACT",
      "Artifact creation time must be canonical UTC ISO-8601 with milliseconds.",
    );
    assertDomain(KINDS.has(input.kind), "INVALID_ARTIFACT", "Artifact kind is invalid.", {
      kind: input.kind,
    });
    assertDomain(
      Number.isSafeInteger(input.byteSize) && input.byteSize >= 0,
      "INVALID_ARTIFACT",
      "Artifact byte size must be a non-negative safe integer.",
      { byteSize: input.byteSize },
    );
    assertDomain(
      MEDIA_TYPE_PATTERN.test(input.mediaType) && input.mediaType === input.mediaType.trim(),
      "INVALID_ARTIFACT",
      "Artifact media type must be a canonical type/subtype value.",
      { mediaType: input.mediaType },
    );
    const id = ArtifactId.parse(input.id);
    const parents = (input.parentArtifactIds ?? []).map((parentId) => ArtifactId.parse(parentId));
    assertDomain(
      new Set(parents).size === parents.length,
      "INVALID_ARTIFACT",
      "Parent artifact IDs must be unique.",
    );
    assertDomain(
      !parents.includes(id),
      "INVALID_ARTIFACT",
      "An artifact cannot be its own parent.",
    );

    return Object.freeze({
      id,
      projectId: ProjectId.parse(input.projectId),
      ...(input.jobId === undefined ? {} : { jobId: JobId.parse(input.jobId) }),
      kind: input.kind,
      logicalPath: SafePath.parse(input.logicalPath),
      contentHash: ContentHash.parse(input.contentHash),
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      createdAt: input.createdAt,
      parentArtifactIds: Object.freeze(parents),
    });
  },
});
