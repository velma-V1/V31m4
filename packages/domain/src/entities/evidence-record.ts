import { assertDomain } from "../domain-errors.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  JobId,
  type JobId as JobIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
} from "../value-objects/ids.js";

export type EvidenceKind =
  | "unit_test"
  | "integration_test"
  | "hidden_test"
  | "property_test"
  | "mutation_test"
  | "static_analysis"
  | "benchmark"
  | "visual_inspection"
  | "audio_inspection"
  | "source"
  | "tool_log"
  | "runtime_log"
  | "artifact_comparison"
  | "human_approval";

export type EvidenceStatus = "passed" | "failed" | "inconclusive";

export interface EvidenceRecord {
  readonly id: EvidenceIdType;
  readonly projectId: ProjectIdType;
  readonly jobId?: JobIdType;
  readonly kind: EvidenceKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly artifactIds: readonly ArtifactIdType[];
  readonly verifierId: string;
  readonly verifierVersion: string;
  readonly createdAt: string;
  readonly immutable: true;
}

export interface CreateEvidenceRecordInput {
  readonly id: string;
  readonly projectId: string;
  readonly jobId?: string;
  readonly kind: EvidenceKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly artifactIds: readonly string[];
  readonly verifierId: string;
  readonly verifierVersion: string;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const KINDS = new Set<EvidenceKind>([
  "unit_test",
  "integration_test",
  "hidden_test",
  "property_test",
  "mutation_test",
  "static_analysis",
  "benchmark",
  "visual_inspection",
  "audio_inspection",
  "source",
  "tool_log",
  "runtime_log",
  "artifact_comparison",
  "human_approval",
]);
const STATUSES = new Set<EvidenceStatus>(["passed", "failed", "inconclusive"]);

function canonicalText(value: string, field: string, maxLength: number): string {
  assertDomain(
    value.length > 0 && value === value.trim() && value.length <= maxLength,
    "INVALID_EVIDENCE",
    `${field} must be canonical and contain between 1 and ${maxLength} characters.`,
    { field, length: value.length },
  );
  return value;
}

export const EvidenceRecord = Object.freeze({
  create(input: CreateEvidenceRecordInput): EvidenceRecord {
    const parsedTime = Date.parse(input.createdAt);
    assertDomain(
      ISO_PATTERN.test(input.createdAt) &&
        Number.isFinite(parsedTime) &&
        new Date(parsedTime).toISOString() === input.createdAt,
      "INVALID_EVIDENCE",
      "Evidence creation time must be canonical UTC ISO-8601 with milliseconds.",
    );
    assertDomain(KINDS.has(input.kind), "INVALID_EVIDENCE", "Evidence kind is invalid.");
    assertDomain(STATUSES.has(input.status), "INVALID_EVIDENCE", "Evidence status is invalid.");
    const artifactIds = input.artifactIds.map((id) => ArtifactId.parse(id));
    assertDomain(
      artifactIds.length > 0,
      "INVALID_EVIDENCE",
      "Evidence must reference at least one immutable artifact.",
    );
    assertDomain(
      new Set(artifactIds).size === artifactIds.length,
      "INVALID_EVIDENCE",
      "Evidence artifact IDs must be unique.",
    );
    return Object.freeze({
      id: EvidenceId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      ...(input.jobId === undefined ? {} : { jobId: JobId.parse(input.jobId) }),
      kind: input.kind,
      subjectType: canonicalText(input.subjectType, "subjectType", 120),
      subjectId: canonicalText(input.subjectId, "subjectId", 160),
      status: input.status,
      summary: canonicalText(input.summary, "summary", 8000),
      artifactIds: Object.freeze(artifactIds),
      verifierId: canonicalText(input.verifierId, "verifierId", 160),
      verifierVersion: canonicalText(input.verifierVersion, "verifierVersion", 80),
      createdAt: input.createdAt,
      immutable: true as const,
    });
  },
});
