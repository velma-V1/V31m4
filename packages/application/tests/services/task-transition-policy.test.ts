import {
  EvidenceRecord,
  TaskCapsule,
  type TaskCapsule as TaskCapsuleEntity,
  type TaskCapsuleInput,
  type TaskPhase,
} from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  assessTaskEvidence,
  type TaskEvidenceAssessment,
  TaskTransitionPolicy,
  type TaskTransitionProposal,
} from "../../src/services/task-transition-policy.js";

/**
 * Transitions are deterministic checked predicates. No model decides whether an invariant
 * passed; the policy either proves the move is legal from the current capsule or refuses it.
 */
function capsule(overrides: Partial<TaskCapsuleInput> = {}) {
  return TaskCapsule.create({
    taskId: "task:root",
    jobId: "job:1",
    projectId: "project:1",
    objective: "Repair the failing verification path.",
    phase: "investigate",
    maxAttempts: 3,
    stopCondition: "stop after three attempts",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  });
}

function proposal(overrides: Partial<TaskTransitionProposal> = {}): TaskTransitionProposal {
  return {
    taskId: "task:root",
    expectedHeadRevision: "1",
    expectedCapsuleRevision: 1,
    from: "investigate",
    to: "plan",
    evidenceIds: [],
    reason: "the reproduction is understood",
    ...overrides,
  } as TaskTransitionProposal;
}

/**
 * Stands in for what the evidence authority returned. The policy is pure, so these tests supply
 * the assessment directly; that the assessment can only come from real resolved records is what
 * `propose-task-transition.test.ts` and the runtime task-state suite prove.
 */
function accepted(proposal: TaskTransitionProposal): TaskEvidenceAssessment {
  return { verifiedEvidenceIds: new Set(proposal.evidenceIds), rejections: [] };
}

function evaluate(
  current: TaskCapsuleEntity,
  candidate: TaskTransitionProposal,
  assessment: TaskEvidenceAssessment = accepted(candidate),
) {
  return TaskTransitionPolicy.evaluate(current, candidate, assessment);
}

describe("TaskTransitionPolicy legal moves", () => {
  it("allows the canonical forward path", () => {
    const legal: readonly (readonly [TaskPhase, TaskPhase])[] = [
      ["investigate", "plan"],
      ["plan", "execute"],
      ["execute", "verify"],
      ["verify", "complete"],
      ["verify", "repair"],
      ["repair", "verify"],
      ["blocked", "investigate"],
    ];
    for (const [from, to] of legal) {
      const decision = evaluate(
        capsule({ phase: from, attempts: 0 }),
        proposal({
          from,
          to,
          evidenceIds: ["evidence:1"],
          expectedCapsuleRevision: 1,
        }),
      );
      expect(decision.allowed, `${from} -> ${to}: ${JSON.stringify(decision)}`).toBe(true);
    }
  });

  it("allows any phase to become blocked", () => {
    for (const from of ["investigate", "plan", "execute", "verify", "repair"] as const) {
      const decision = evaluate(capsule({ phase: from }), proposal({ from, to: "blocked" }));
      expect(decision.allowed, from).toBe(true);
    }
  });
});

describe("TaskTransitionPolicy refusals", () => {
  it("refuses a proposal for a different task", () => {
    const decision = evaluate(capsule(), proposal({ taskId: "task:other" }));
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("TASK_MISMATCH");
  });

  it("refuses a stale logical capsule revision", () => {
    const decision = evaluate(capsule(), proposal({ expectedCapsuleRevision: 7 }));
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("STALE_CAPSULE_REVISION");
  });

  it("refuses a proposal whose from-phase is not the current phase", () => {
    const decision = evaluate(
      capsule({ phase: "plan" }),
      proposal({ from: "investigate", to: "plan" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("PHASE_MISMATCH");
  });

  it("refuses an illegal edge", () => {
    for (const [from, to] of [
      ["investigate", "complete"],
      ["investigate", "execute"],
      ["plan", "verify"],
      ["execute", "complete"],
      ["repair", "complete"],
    ] as const) {
      const decision = evaluate(
        capsule({ phase: from }),
        proposal({ from, to, evidenceIds: ["evidence:1"] }),
      );
      expect(decision.allowed, `${from} -> ${to}`).toBe(false);
      expect(decision.allowed === false && decision.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("refuses a self-transition", () => {
    const decision = evaluate(capsule({ phase: "plan" }), proposal({ from: "plan", to: "plan" }));
    expect(decision.allowed).toBe(false);
  });

  it("treats complete as terminal", () => {
    for (const to of ["investigate", "plan", "execute", "verify", "repair", "blocked"] as const) {
      const decision = evaluate(
        capsule({ phase: "complete" }),
        proposal({ from: "complete", to, evidenceIds: ["evidence:1"] }),
      );
      expect(decision.allowed, `complete -> ${to}`).toBe(false);
    }
  });

  it("refuses a transition that requires evidence and has none", () => {
    for (const [from, to] of [
      ["verify", "complete"],
      ["execute", "repair"],
      ["verify", "repair"],
    ] as const) {
      const decision = evaluate(capsule({ phase: from }), proposal({ from, to, evidenceIds: [] }));
      expect(decision.allowed, `${from} -> ${to}`).toBe(false);
      expect(decision.allowed === false && decision.code).toBe("MISSING_EVIDENCE");
    }
  });

  it("refuses evidence that is not a valid durable identifier", () => {
    const decision = evaluate(
      capsule({ phase: "verify" }),
      proposal({ from: "verify", to: "complete", evidenceIds: ["not a valid id"] }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses a transition once the attempt budget is exhausted", () => {
    const exhausted = capsule({ phase: "plan", attempts: 3, maxAttempts: 3 });
    const decision = evaluate(exhausted, proposal({ from: "plan", to: "execute" }));
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("ATTEMPTS_EXHAUSTED");
  });

  it("still permits blocking when the attempt budget is exhausted", () => {
    const exhausted = capsule({ phase: "plan", attempts: 3, maxAttempts: 3 });
    expect(evaluate(exhausted, proposal({ from: "plan", to: "blocked" })).allowed).toBe(true);
  });

  it("refuses an empty or oversized reason", () => {
    for (const reason of ["", "   ", "x".repeat(4001)]) {
      expect(evaluate(capsule(), proposal({ reason })).allowed).toBe(false);
    }
  });

  it("reports every reason it refused for, not just the first", () => {
    const decision = evaluate(
      capsule({ phase: "plan" }),
      proposal({ from: "investigate", to: "plan", expectedCapsuleRevision: 9 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reasons.length).toBeGreaterThan(1);
  });
});

describe("TaskTransitionPolicy evidence verification", () => {
  it("refuses a syntactically valid evidence ID the evidence authority never resolved", () => {
    const decision = evaluate(
      capsule({ phase: "verify" }),
      proposal({ from: "verify", to: "complete", evidenceIds: ["evidence:fake"] }),
      {
        verifiedEvidenceIds: new Set(),
        rejections: [{ evidenceId: "evidence:fake", reason: "unknown" }],
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("INVALID_EVIDENCE");
    expect(decision.allowed === false && decision.reasons.join(" ")).toMatch(/does not exist/u);
  });

  it("refuses a cited record the assessment silently omitted", () => {
    // Nothing rejected it explicitly, but it is not in the verified set either. Absence of proof
    // is never proof, so the transition still fails closed.
    const decision = evaluate(
      capsule({ phase: "verify" }),
      proposal({ from: "verify", to: "complete", evidenceIds: ["evidence:1"] }),
      { verifiedEvidenceIds: new Set(), rejections: [] },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("INVALID_EVIDENCE");
  });
});

describe("assessTaskEvidence", () => {
  const owning = capsule({
    phase: "verify",
    acceptanceCriterionIds: ["requirement:1"],
    changeArtifactIds: ["artifact:1"],
  });

  function record(overrides: Partial<Parameters<typeof EvidenceRecord.create>[0]> = {}) {
    return EvidenceRecord.create({
      id: "evidence:1",
      projectId: "project:1",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "task",
      subjectId: "task:root",
      status: "passed",
      summary: "the targeted regression passed",
      artifactIds: ["artifact:log"],
      verifierId: "verifier:node",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    });
  }

  function assess(...records: readonly ReturnType<typeof record>[]) {
    return assessTaskEvidence(
      owning,
      ["evidence:1"],
      new Map(records.map((value) => [value.id, value])),
    );
  }

  it("accepts a passing record about this exact task", () => {
    expect([...assess(record()).verifiedEvidenceIds]).toEqual(["evidence:1"]);
  });

  it("accepts a passing record about an acceptance criterion this capsule owns", () => {
    const accepted = assess(
      record({ subjectType: "acceptance_criterion", subjectId: "requirement:1" }),
    );
    expect([...accepted.verifiedEvidenceIds]).toEqual(["evidence:1"]);
  });

  it("accepts a passing record about a change artifact this capsule owns", () => {
    expect([
      ...assess(record({ subjectType: "artifact", subjectId: "artifact:1" })).verifiedEvidenceIds,
    ]).toEqual(["evidence:1"]);
  });

  it("rejects a record that does not exist", () => {
    const assessment = assessTaskEvidence(owning, ["evidence:1"], new Map());
    expect(assessment.verifiedEvidenceIds.size).toBe(0);
    expect(assessment.rejections).toEqual([{ evidenceId: "evidence:1", reason: "unknown" }]);
  });

  it("rejects failed and inconclusive records", () => {
    for (const status of ["failed", "inconclusive"] as const) {
      const assessment = assess(record({ status }));
      expect(assessment.verifiedEvidenceIds.size, status).toBe(0);
      expect(assessment.rejections[0]?.reason, status).toBe("not_passed");
    }
  });

  it("rejects a record belonging to another project", () => {
    expect(assess(record({ projectId: "project:other" })).rejections[0]?.reason).toBe(
      "wrong_project",
    );
  });

  it("rejects a record belonging to another job", () => {
    expect(assess(record({ jobId: "job:other" })).rejections[0]?.reason).toBe("wrong_job");
  });

  it("rejects a record about another task, another criterion, or an unrelated subject", () => {
    for (const subject of [
      { subjectType: "task", subjectId: "task:other" },
      { subjectType: "acceptance_criterion", subjectId: "requirement:other" },
      { subjectType: "artifact", subjectId: "artifact:other" },
      { subjectType: "candidate", subjectId: "candidate:1" },
    ] as const) {
      const assessment = assess(record(subject));
      expect(assessment.verifiedEvidenceIds.size, JSON.stringify(subject)).toBe(0);
      expect(assessment.rejections[0]?.reason, JSON.stringify(subject)).toBe("wrong_subject");
    }
  });

  it("accepts a project-scoped record that names no job at all", () => {
    const scoped = EvidenceRecord.create({
      id: "evidence:1",
      projectId: "project:1",
      kind: "unit_test",
      subjectType: "task",
      subjectId: "task:root",
      status: "passed",
      summary: "the targeted regression passed",
      artifactIds: ["artifact:log"],
      verifierId: "verifier:node",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    expect([...assess(scoped).verifiedEvidenceIds]).toEqual(["evidence:1"]);
  });
});

describe("TaskTransitionPolicy attempt accounting", () => {
  it("counts entering execute and repair as attempts, and nothing else", () => {
    expect(TaskTransitionPolicy.attemptCost("execute")).toBe(1);
    expect(TaskTransitionPolicy.attemptCost("repair")).toBe(1);
    for (const phase of ["investigate", "plan", "verify", "blocked", "complete"] as const) {
      expect(TaskTransitionPolicy.attemptCost(phase), phase).toBe(0);
    }
  });
});
