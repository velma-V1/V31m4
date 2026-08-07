import { describe, expect, it } from "vitest";
import {
  type EvidenceLink,
  EvidenceLinker,
  linkEvidence,
} from "../../src/services/evidence-linker.js";
import { makeEvidence } from "./fixtures.js";

describe("EvidenceLinker.link", () => {
  it("computes complete coverage for satisfied subjects", () => {
    const evidence = [makeEvidence({ id: "evidence:pass", status: "passed", kind: "hidden_test" })];
    const links: readonly EvidenceLink[] = [
      {
        evidenceId: "evidence:pass",
        subjectType: "acceptance_criterion",
        subjectId: "criterion:1",
      },
    ];
    const result = linkEvidence({
      evidence,
      links,
      acceptanceCriteria: [
        { id: "criterion:1", mandatory: true, requiredEvidenceKinds: ["hidden_test"] },
      ],
      requirements: [{ id: "req:1", mandatory: false }],
    });
    expect(result.criterionCoverage).toBe(1);
    expect(result.missingMandatoryEvidence).toHaveLength(0);
  });

  it("identifies missing mandatory evidence and required kinds", () => {
    const evidence = [makeEvidence({ id: "evidence:x", status: "passed", kind: "unit_test" })];
    const result = linkEvidence({
      evidence,
      links: [
        { evidenceId: "evidence:x", subjectType: "acceptance_criterion", subjectId: "criterion:1" },
      ],
      acceptanceCriteria: [
        { id: "criterion:1", mandatory: true, requiredEvidenceKinds: ["hidden_test"] },
      ],
    });
    expect(result.missingMandatoryEvidence).toHaveLength(1);
    expect(result.missingMandatoryEvidence[0]?.missingEvidenceKinds).toContain("hidden_test");
    expect(result.criterionCoverage).toBe(0);
  });

  it("rejects orphan evidence links", () => {
    const result = linkEvidence({
      evidence: [],
      links: [{ evidenceId: "evidence:ghost", subjectType: "claim", subjectId: "claim:1" }],
      claimIds: ["claim:1"],
    });
    expect(result.orphanEvidenceLinks).toHaveLength(1);
  });

  it("rejects evidence attached to an unknown subject", () => {
    const evidence = [makeEvidence({ id: "evidence:1" })];
    const result = linkEvidence({
      evidence,
      links: [{ evidenceId: "evidence:1", subjectType: "requirement", subjectId: "req:unknown" }],
      requirements: [{ id: "req:1", mandatory: true }],
    });
    expect(result.wrongSubjectLinks).toHaveLength(1);
  });

  it("flags conflicting evidence while keeping failed evidence visible", () => {
    const evidence = [
      makeEvidence({ id: "evidence:pass", status: "passed" }),
      makeEvidence({ id: "evidence:fail", status: "failed" }),
    ];
    const result = linkEvidence({
      evidence,
      links: [
        { evidenceId: "evidence:pass", subjectType: "candidate", subjectId: "candidate:1" },
        { evidenceId: "evidence:fail", subjectType: "candidate", subjectId: "candidate:1" },
      ],
      candidateIds: ["candidate:1"],
    });
    expect(result.conflicts).toHaveLength(1);
    const trace = result.traces.find((entry) => entry.subjectId === "candidate:1");
    expect(trace?.failedEvidenceIds).toContain("evidence:fail");
    expect(trace?.conflicted).toBe(true);
  });

  it("never treats inconclusive evidence as passing", () => {
    const evidence = [makeEvidence({ id: "evidence:inc", status: "inconclusive" })];
    const result = linkEvidence({
      evidence,
      links: [
        {
          evidenceId: "evidence:inc",
          subjectType: "acceptance_criterion",
          subjectId: "criterion:1",
        },
      ],
      acceptanceCriteria: [
        { id: "criterion:1", mandatory: true, requiredEvidenceKinds: ["hidden_test"] },
      ],
    });
    const trace = result.traces.find((entry) => entry.subjectId === "criterion:1");
    expect(trace?.satisfied).toBe(false);
    expect(trace?.inconclusiveEvidenceIds).toContain("evidence:inc");
    expect(result.missingMandatoryEvidence).toHaveLength(1);
  });

  it("preserves many-to-many traceability and de-duplicates links", () => {
    const evidence = [makeEvidence({ id: "evidence:shared", status: "passed" })];
    const links: readonly EvidenceLink[] = [
      { evidenceId: "evidence:shared", subjectType: "requirement", subjectId: "req:1" },
      { evidenceId: "evidence:shared", subjectType: "requirement", subjectId: "req:1" },
      { evidenceId: "evidence:shared", subjectType: "requirement", subjectId: "req:2" },
    ];
    const result = linkEvidence({
      evidence,
      links,
      requirements: [
        { id: "req:1", mandatory: true },
        { id: "req:2", mandatory: true },
      ],
    });
    expect(result.requirementCoverage).toBe(1);
    const trace = result.traces.find((entry) => entry.subjectId === "req:1");
    expect(trace?.passingEvidenceIds).toHaveLength(1);
  });

  it("preserves evidence provenance deterministically", () => {
    const evidence = [
      makeEvidence({ id: "evidence:b", verifierId: "verifier:b" }),
      makeEvidence({ id: "evidence:a", verifierId: "verifier:a" }),
    ];
    const first = linkEvidence({ evidence, links: [] });
    const second = linkEvidence({ evidence, links: [] });
    expect(first).toStrictEqual(second);
    expect(first.provenance.map((entry) => entry.evidenceId)).toEqual(["evidence:a", "evidence:b"]);
  });

  it("rejects duplicate evidence ids with a typed error", () => {
    const evidence = [makeEvidence({ id: "evidence:dup" }), makeEvidence({ id: "evidence:dup" })];
    expect(() => EvidenceLinker.link({ evidence, links: [] })).toThrowError(/Duplicate evidence/);
  });

  it("produces the same traceability regardless of evidence and link order", () => {
    const evidence = [
      makeEvidence({ id: "evidence:1", status: "passed", kind: "hidden_test" }),
      makeEvidence({ id: "evidence:2", status: "failed" }),
      makeEvidence({ id: "evidence:3", status: "inconclusive" }),
    ];
    const links: readonly EvidenceLink[] = [
      { evidenceId: "evidence:1", subjectType: "acceptance_criterion", subjectId: "criterion:1" },
      { evidenceId: "evidence:2", subjectType: "candidate", subjectId: "candidate:1" },
      { evidenceId: "evidence:3", subjectType: "requirement", subjectId: "req:1" },
    ];
    const args = {
      acceptanceCriteria: [
        { id: "criterion:1", mandatory: true, requiredEvidenceKinds: ["hidden_test"] as const },
      ],
      candidateIds: ["candidate:1"],
      requirements: [{ id: "req:1", mandatory: true }],
    };
    const forward = linkEvidence({ evidence, links, ...args });
    const reversed = linkEvidence({
      evidence: [...evidence].reverse(),
      links: [...links].reverse(),
      ...args,
    });
    expect(reversed).toStrictEqual(forward);
  });
});
