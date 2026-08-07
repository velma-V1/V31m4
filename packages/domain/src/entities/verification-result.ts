import { assertDomain } from "../domain-errors.js";
import {
  CandidateId,
  type CandidateId as CandidateIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  MissionId,
  type MissionId as MissionIdType,
  VerificationPlanId,
  type VerificationPlanId as VerificationPlanIdType,
  VerificationResultId,
  type VerificationResultId as VerificationResultIdType,
} from "../value-objects/ids.js";
import type { EvidenceKind, EvidenceStatus } from "./evidence-record.js";

export interface VerificationCheck {
  readonly id: string;
  readonly criterionIds: readonly string[];
  readonly verifierId: string;
  readonly kind: EvidenceKind;
  readonly mandatory: boolean;
  readonly hidden: boolean;
  readonly timeoutMs: number;
}

export interface VerificationPlan {
  readonly id: VerificationPlanIdType;
  readonly missionId: MissionIdType;
  readonly candidateId: CandidateIdType;
  readonly checks: readonly VerificationCheck[];
}

export interface CompletedVerificationCheck {
  readonly checkId: string;
  readonly status: EvidenceStatus;
  readonly evidenceIds: readonly EvidenceIdType[];
}

export interface VerificationResult {
  readonly id: VerificationResultIdType;
  readonly planId: VerificationPlanIdType;
  readonly candidateId: CandidateIdType;
  readonly status: EvidenceStatus;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly mandatoryChecksPassed: number;
  readonly mandatoryChecksTotal: number;
  readonly optionalChecksPassed: number;
  readonly optionalChecksTotal: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function canonicalId(value: string, field: string): string {
  assertDomain(
    ID_PATTERN.test(value) && value === value.trim(),
    "INVALID_VERIFICATION_RESULT",
    `${field} must be a canonical identifier.`,
  );
  return value;
}

export const VerificationResult = Object.freeze({
  createPlan(input: {
    readonly id: string;
    readonly missionId: string;
    readonly candidateId: string;
    readonly checks: readonly VerificationCheck[];
  }): VerificationPlan {
    assertDomain(
      input.checks.length > 0,
      "INVALID_VERIFICATION_RESULT",
      "Verification plans must contain at least one check.",
    );
    const checks = input.checks.map((check) => {
      canonicalId(check.id, "check.id");
      assertDomain(
        check.criterionIds.length > 0 &&
          check.criterionIds.every((id) => ID_PATTERN.test(id)) &&
          new Set(check.criterionIds).size === check.criterionIds.length,
        "INVALID_VERIFICATION_RESULT",
        "Verification checks must reference unique canonical criteria.",
      );
      assertDomain(
        check.verifierId.length > 0 &&
          check.verifierId === check.verifierId.trim() &&
          check.verifierId.length <= 160,
        "INVALID_VERIFICATION_RESULT",
        "Verifier ID must be canonical.",
      );
      assertDomain(
        Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0,
        "INVALID_VERIFICATION_RESULT",
        "Verification timeout must be a positive safe integer.",
      );
      return Object.freeze({
        ...check,
        criterionIds: Object.freeze([...check.criterionIds]),
      });
    });
    assertDomain(
      new Set(checks.map((check) => check.id)).size === checks.length,
      "INVALID_VERIFICATION_RESULT",
      "Verification check IDs must be unique.",
    );
    return Object.freeze({
      id: VerificationPlanId.parse(input.id),
      missionId: MissionId.parse(input.missionId),
      candidateId: CandidateId.parse(input.candidateId),
      checks: Object.freeze(checks),
    });
  },

  calculate(input: {
    readonly id: string;
    readonly plan: VerificationPlan;
    readonly completedChecks: readonly {
      readonly checkId: string;
      readonly status: EvidenceStatus;
      readonly evidenceIds: readonly string[];
    }[];
  }): VerificationResult {
    const completedById = new Map(
      input.completedChecks.map((completed) => {
        const evidenceIds = completed.evidenceIds.map((id) => EvidenceId.parse(id));
        assertDomain(
          evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
          "INVALID_VERIFICATION_RESULT",
          "Completed verification checks require unique evidence records.",
          { checkId: completed.checkId },
        );
        return [
          canonicalId(completed.checkId, "completedCheck.checkId"),
          Object.freeze({ ...completed, evidenceIds: Object.freeze(evidenceIds) }),
        ] as const;
      }),
    );
    assertDomain(
      completedById.size === input.completedChecks.length,
      "INVALID_VERIFICATION_RESULT",
      "Completed verification check IDs must be unique.",
    );
    assertDomain(
      [...completedById.keys()].every((id) => input.plan.checks.some((check) => check.id === id)),
      "INVALID_VERIFICATION_RESULT",
      "Completed checks must belong to the verification plan.",
    );

    let missingMandatory = false;
    let failedMandatory = false;
    let inconclusiveMandatory = false;
    let mandatoryChecksPassed = 0;
    let optionalChecksPassed = 0;
    let mandatoryChecksTotal = 0;
    let optionalChecksTotal = 0;

    for (const check of input.plan.checks) {
      const completed = completedById.get(check.id);
      if (check.mandatory) {
        mandatoryChecksTotal += 1;
        if (completed === undefined) {
          missingMandatory = true;
        } else if (completed.status === "passed") {
          mandatoryChecksPassed += 1;
        } else if (completed.status === "failed") {
          failedMandatory = true;
        } else {
          inconclusiveMandatory = true;
        }
      } else {
        optionalChecksTotal += 1;
        if (completed?.status === "passed") {
          optionalChecksPassed += 1;
        }
      }
    }

    const status: EvidenceStatus = failedMandatory
      ? "failed"
      : missingMandatory || inconclusiveMandatory
        ? "inconclusive"
        : "passed";
    const evidenceIds = [...completedById.values()].flatMap((value) => value.evidenceIds);
    return Object.freeze({
      id: VerificationResultId.parse(input.id),
      planId: input.plan.id,
      candidateId: input.plan.candidateId,
      status,
      evidenceIds: Object.freeze([...new Set(evidenceIds)]),
      mandatoryChecksPassed,
      mandatoryChecksTotal,
      optionalChecksPassed,
      optionalChecksTotal,
    });
  },
});
