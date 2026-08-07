import type { EvidenceKind, EvidenceRecord } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Evidence Linker.
 *
 * Connects evidence to requirements, acceptance criteria, claims, candidates, and
 * artifacts, computes deterministic coverage, and surfaces gaps and conflicts. It only
 * links known records, rejects orphan and wrong-subject links, keeps failed evidence
 * visible, and never treats inconclusive evidence as passing.
 */

export type EvidenceSubjectType =
  | "requirement"
  | "acceptance_criterion"
  | "claim"
  | "candidate"
  | "artifact";

export interface EvidenceLink {
  readonly evidenceId: string;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
}

export interface RequirementSubject {
  readonly id: string;
  readonly mandatory: boolean;
}

export interface CriterionSubject {
  readonly id: string;
  readonly mandatory: boolean;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
}

export interface EvidenceLinkerInput {
  readonly evidence: readonly EvidenceRecord[];
  readonly links: readonly EvidenceLink[];
  readonly requirements?: readonly RequirementSubject[];
  readonly acceptanceCriteria?: readonly CriterionSubject[];
  readonly claimIds?: readonly string[];
  readonly candidateIds?: readonly string[];
  readonly artifactIds?: readonly string[];
}

export interface SubjectTrace {
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly evidenceIds: readonly string[];
  readonly passingEvidenceIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  readonly inconclusiveEvidenceIds: readonly string[];
  readonly conflicted: boolean;
  readonly satisfied: boolean;
}

export interface MissingMandatoryEvidence {
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly missingEvidenceKinds: readonly EvidenceKind[];
}

export interface EvidenceProvenance {
  readonly evidenceId: string;
  readonly verifierId: string;
  readonly verifierVersion: string;
}

export interface EvidenceLinkerResult {
  readonly traces: readonly SubjectTrace[];
  readonly orphanEvidenceLinks: readonly EvidenceLink[];
  readonly wrongSubjectLinks: readonly EvidenceLink[];
  readonly requirementCoverage: number;
  readonly criterionCoverage: number;
  readonly missingMandatoryEvidence: readonly MissingMandatoryEvidence[];
  readonly conflicts: readonly {
    readonly subjectType: EvidenceSubjectType;
    readonly subjectId: string;
  }[];
  readonly provenance: readonly EvidenceProvenance[];
}

interface MutableTrace {
  passing: Set<string>;
  failed: Set<string>;
  inconclusive: Set<string>;
  kinds: Set<EvidenceKind>;
}

function subjectKey(type: EvidenceSubjectType, id: string): string {
  return `${type}:${id}`;
}

function knownSubjects(input: EvidenceLinkerInput): Map<EvidenceSubjectType, Set<string>> {
  return new Map<EvidenceSubjectType, Set<string>>([
    ["requirement", new Set((input.requirements ?? []).map((subject) => subject.id))],
    [
      "acceptance_criterion",
      new Set((input.acceptanceCriteria ?? []).map((subject) => subject.id)),
    ],
    ["claim", new Set(input.claimIds ?? [])],
    ["candidate", new Set(input.candidateIds ?? [])],
    ["artifact", new Set(input.artifactIds ?? [])],
  ]);
}

function coverageRatio(satisfied: number, total: number): number {
  return total === 0 ? 1 : satisfied / total;
}

/** Computes deterministic evidence-to-subject traceability, coverage, and gaps. */
export function linkEvidence(input: EvidenceLinkerInput): EvidenceLinkerResult {
  const evidenceById = new Map<string, EvidenceRecord>();
  for (const record of input.evidence) {
    if (evidenceById.has(record.id)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Duplicate evidence record id.", {
        details: { evidenceId: record.id },
      });
    }
    evidenceById.set(record.id, record);
  }

  const subjects = knownSubjects(input);
  const traces = new Map<string, MutableTrace & { type: EvidenceSubjectType; id: string }>();
  const orphanEvidenceLinks: EvidenceLink[] = [];
  const wrongSubjectLinks: EvidenceLink[] = [];
  const seenLinks = new Set<string>();

  for (const link of input.links) {
    const record = evidenceById.get(link.evidenceId);
    if (record === undefined) {
      orphanEvidenceLinks.push(link);
      continue;
    }
    if (!(subjects.get(link.subjectType)?.has(link.subjectId) ?? false)) {
      wrongSubjectLinks.push(link);
      continue;
    }
    const key = `${subjectKey(link.subjectType, link.subjectId)}#${link.evidenceId}`;
    if (seenLinks.has(key)) {
      continue; // duplicate link: many-to-many is preserved, but not double-counted.
    }
    seenLinks.add(key);
    const traceKey = subjectKey(link.subjectType, link.subjectId);
    const trace = traces.get(traceKey) ?? {
      type: link.subjectType,
      id: link.subjectId,
      passing: new Set(),
      failed: new Set(),
      inconclusive: new Set(),
      kinds: new Set(),
    };
    if (record.status === "passed") {
      trace.passing.add(record.id);
      trace.kinds.add(record.kind);
    } else if (record.status === "failed") {
      trace.failed.add(record.id);
    } else {
      trace.inconclusive.add(record.id);
    }
    traces.set(traceKey, trace);
  }

  const subjectTraces: SubjectTrace[] = [...traces.values()].map((trace) => {
    const conflicted = trace.passing.size > 0 && trace.failed.size > 0;
    return Object.freeze({
      subjectType: trace.type,
      subjectId: trace.id,
      evidenceIds: Object.freeze(
        [...new Set([...trace.passing, ...trace.failed, ...trace.inconclusive])].sort(),
      ),
      passingEvidenceIds: Object.freeze([...trace.passing].sort()),
      failedEvidenceIds: Object.freeze([...trace.failed].sort()),
      inconclusiveEvidenceIds: Object.freeze([...trace.inconclusive].sort()),
      conflicted,
      satisfied: trace.passing.size > 0,
    });
  });

  const orderedTraces = stableSortBy(subjectTraces, (trace) =>
    subjectKey(trace.subjectType, trace.subjectId),
  );
  const conflicts = orderedTraces
    .filter((trace) => trace.conflicted)
    .map((trace) => Object.freeze({ subjectType: trace.subjectType, subjectId: trace.subjectId }));

  const missing: MissingMandatoryEvidence[] = [];
  for (const requirement of input.requirements ?? []) {
    const trace = traces.get(subjectKey("requirement", requirement.id));
    if (requirement.mandatory && (trace === undefined || trace.passing.size === 0)) {
      missing.push(
        Object.freeze({
          subjectType: "requirement",
          subjectId: requirement.id,
          missingEvidenceKinds: Object.freeze([]),
        }),
      );
    }
  }
  for (const criterion of input.acceptanceCriteria ?? []) {
    const trace = traces.get(subjectKey("acceptance_criterion", criterion.id));
    const coveredKinds = trace?.kinds ?? new Set<EvidenceKind>();
    const missingKinds = criterion.requiredEvidenceKinds.filter((kind) => !coveredKinds.has(kind));
    const hasPassing = (trace?.passing.size ?? 0) > 0;
    if (criterion.mandatory && (!hasPassing || missingKinds.length > 0)) {
      missing.push(
        Object.freeze({
          subjectType: "acceptance_criterion",
          subjectId: criterion.id,
          missingEvidenceKinds: Object.freeze([...missingKinds]),
        }),
      );
    }
  }

  const requirements = input.requirements ?? [];
  const requirementCoverage = coverageRatio(
    requirements.filter(
      (requirement) =>
        (traces.get(subjectKey("requirement", requirement.id))?.passing.size ?? 0) > 0,
    ).length,
    requirements.length,
  );
  const criteria = input.acceptanceCriteria ?? [];
  const criterionCoverage = coverageRatio(
    criteria.filter((criterion) => {
      const trace = traces.get(subjectKey("acceptance_criterion", criterion.id));
      const coveredKinds = trace?.kinds ?? new Set<EvidenceKind>();
      const missingKinds = criterion.requiredEvidenceKinds.filter(
        (kind) => !coveredKinds.has(kind),
      );
      return (trace?.passing.size ?? 0) > 0 && missingKinds.length === 0;
    }).length,
    criteria.length,
  );

  const provenance = stableSortBy(
    input.evidence.map((record) =>
      Object.freeze({
        evidenceId: record.id,
        verifierId: record.verifierId,
        verifierVersion: record.verifierVersion,
      }),
    ),
    (entry) => entry.evidenceId,
  );

  return Object.freeze({
    traces: Object.freeze(orderedTraces),
    orphanEvidenceLinks: Object.freeze(orphanEvidenceLinks),
    wrongSubjectLinks: Object.freeze(wrongSubjectLinks),
    requirementCoverage,
    criterionCoverage,
    missingMandatoryEvidence: Object.freeze(
      stableSortBy(missing, (entry) => subjectKey(entry.subjectType, entry.subjectId)),
    ),
    conflicts: Object.freeze(conflicts),
    provenance: Object.freeze(provenance),
  });
}

export const EvidenceLinker = Object.freeze({ link: linkEvidence });
