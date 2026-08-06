import { assertDomain } from "../domain-errors.js";
import {
  CandidateId,
  EvidenceId,
  IssueId,
  type CandidateId as CandidateIdType,
  type EvidenceId as EvidenceIdType,
  type IssueId as IssueIdType,
} from "../value-objects/ids.js";

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus = "open" | "accepted" | "rejected" | "repaired";

export interface IssueRecord {
  readonly id: IssueIdType;
  readonly candidateId: CandidateIdType;
  readonly title: string;
  readonly exactDeficiency: string;
  readonly location?: string;
  readonly severity: IssueSeverity;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly expectedConsequence: string;
  readonly proposedCorrection: string;
  readonly verificationMethod: string;
  readonly regressionRisk: string;
  readonly status: IssueStatus;
}

const SEVERITIES = new Set<IssueSeverity>(["critical", "high", "medium", "low"]);

function canonicalText(value: string, field: string, max = 8000): string {
  assertDomain(
    value.length > 0 && value === value.trim() && value.length <= max,
    "INVALID_ISSUE_RECORD",
    `${field} must be canonical and non-empty.`,
  );
  return value;
}

export const IssueRecord = Object.freeze({
  create(input: {
    readonly id: string;
    readonly candidateId: string;
    readonly title: string;
    readonly exactDeficiency: string;
    readonly location?: string;
    readonly severity: IssueSeverity;
    readonly evidenceIds: readonly string[];
    readonly expectedConsequence: string;
    readonly proposedCorrection: string;
    readonly verificationMethod: string;
    readonly regressionRisk: string;
  }): IssueRecord {
    assertDomain(SEVERITIES.has(input.severity), "INVALID_ISSUE_RECORD", "Issue severity is invalid.");
    const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_ISSUE_RECORD",
      "Issue records require at least one unique evidence record.",
    );
    if (input.location !== undefined) {
      canonicalText(input.location, "location", 1000);
    }
    return Object.freeze({
      id: IssueId.parse(input.id),
      candidateId: CandidateId.parse(input.candidateId),
      title: canonicalText(input.title, "title", 240),
      exactDeficiency: canonicalText(input.exactDeficiency, "exactDeficiency"),
      ...(input.location === undefined ? {} : { location: input.location }),
      severity: input.severity,
      evidenceIds: Object.freeze(evidenceIds),
      expectedConsequence: canonicalText(input.expectedConsequence, "expectedConsequence"),
      proposedCorrection: canonicalText(input.proposedCorrection, "proposedCorrection"),
      verificationMethod: canonicalText(input.verificationMethod, "verificationMethod"),
      regressionRisk: canonicalText(input.regressionRisk, "regressionRisk"),
      status: "open" as const,
    });
  },

  accept(issue: IssueRecord): IssueRecord {
    assertDomain(issue.status === "open", "INVALID_STATE_TRANSITION", "Only open issues can be accepted.");
    return Object.freeze({ ...issue, status: "accepted" as const });
  },

  reject(issue: IssueRecord): IssueRecord {
    assertDomain(issue.status === "open", "INVALID_STATE_TRANSITION", "Only open issues can be rejected.");
    return Object.freeze({ ...issue, status: "rejected" as const });
  },

  markRepaired(issue: IssueRecord): IssueRecord {
    assertDomain(
      issue.status === "accepted",
      "INVALID_STATE_TRANSITION",
      "Only accepted issues can be marked repaired.",
    );
    return Object.freeze({ ...issue, status: "repaired" as const });
  },
});
