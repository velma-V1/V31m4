import { assertDomain } from "../domain-errors.js";
import {
  ClaimId,
  EvidenceId,
  ProjectId,
  type ClaimId as ClaimIdType,
  type EvidenceId as EvidenceIdType,
  type ProjectId as ProjectIdType,
} from "../value-objects/ids.js";

export type ClaimStatus = "proposed" | "supported" | "refuted" | "inconclusive";

export interface Claim {
  readonly id: ClaimIdType;
  readonly projectId: ProjectIdType;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateClaimInput {
  readonly id: string;
  readonly projectId: string;
  readonly statement: string;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function validateTimestamp(value: string): number {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_CLAIM",
    "Claim timestamps must be canonical UTC ISO-8601 with milliseconds.",
  );
  return parsed;
}

export const Claim = Object.freeze({
  create(input: CreateClaimInput): Claim {
    validateTimestamp(input.createdAt);
    assertDomain(
      input.statement.length > 0 &&
        input.statement === input.statement.trim() &&
        input.statement.length <= 8000,
      "INVALID_CLAIM",
      "Claim statement must be canonical and contain between 1 and 8000 characters.",
    );
    return Object.freeze({
      id: ClaimId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      statement: input.statement,
      status: "proposed" as const,
      evidenceIds: Object.freeze([]),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  },

  evaluate(
    claim: Claim,
    status: Exclude<ClaimStatus, "proposed">,
    evidenceIdsInput: readonly string[],
    updatedAt: string,
  ): Claim {
    const nextTime = validateTimestamp(updatedAt);
    assertDomain(
      nextTime >= validateTimestamp(claim.updatedAt),
      "INVALID_STATE_TRANSITION",
      "Claim update time cannot move backward.",
    );
    const evidenceIds = evidenceIdsInput.map((id) => EvidenceId.parse(id));
    assertDomain(
      evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_CLAIM",
      "Evaluated claims require at least one unique evidence record.",
    );
    return Object.freeze({
      ...claim,
      status,
      evidenceIds: Object.freeze(evidenceIds),
      updatedAt,
    });
  },
});
