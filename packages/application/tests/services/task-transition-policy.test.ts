import { TaskCapsule, type TaskCapsuleInput, type TaskPhase } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
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
      const decision = TaskTransitionPolicy.evaluate(
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
      const decision = TaskTransitionPolicy.evaluate(
        capsule({ phase: from }),
        proposal({ from, to: "blocked" }),
      );
      expect(decision.allowed, from).toBe(true);
    }
  });
});

describe("TaskTransitionPolicy refusals", () => {
  it("refuses a proposal for a different task", () => {
    const decision = TaskTransitionPolicy.evaluate(capsule(), proposal({ taskId: "task:other" }));
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("TASK_MISMATCH");
  });

  it("refuses a stale logical capsule revision", () => {
    const decision = TaskTransitionPolicy.evaluate(
      capsule(),
      proposal({ expectedCapsuleRevision: 7 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("STALE_CAPSULE_REVISION");
  });

  it("refuses a proposal whose from-phase is not the current phase", () => {
    const decision = TaskTransitionPolicy.evaluate(
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
      const decision = TaskTransitionPolicy.evaluate(
        capsule({ phase: from }),
        proposal({ from, to, evidenceIds: ["evidence:1"] }),
      );
      expect(decision.allowed, `${from} -> ${to}`).toBe(false);
      expect(decision.allowed === false && decision.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("refuses a self-transition", () => {
    const decision = TaskTransitionPolicy.evaluate(
      capsule({ phase: "plan" }),
      proposal({ from: "plan", to: "plan" }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("treats complete as terminal", () => {
    for (const to of ["investigate", "plan", "execute", "verify", "repair", "blocked"] as const) {
      const decision = TaskTransitionPolicy.evaluate(
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
      const decision = TaskTransitionPolicy.evaluate(
        capsule({ phase: from }),
        proposal({ from, to, evidenceIds: [] }),
      );
      expect(decision.allowed, `${from} -> ${to}`).toBe(false);
      expect(decision.allowed === false && decision.code).toBe("MISSING_EVIDENCE");
    }
  });

  it("refuses evidence that is not a valid durable identifier", () => {
    const decision = TaskTransitionPolicy.evaluate(
      capsule({ phase: "verify" }),
      proposal({ from: "verify", to: "complete", evidenceIds: ["not a valid id"] }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses a transition once the attempt budget is exhausted", () => {
    const exhausted = capsule({ phase: "plan", attempts: 3, maxAttempts: 3 });
    const decision = TaskTransitionPolicy.evaluate(
      exhausted,
      proposal({ from: "plan", to: "execute" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("ATTEMPTS_EXHAUSTED");
  });

  it("still permits blocking when the attempt budget is exhausted", () => {
    const exhausted = capsule({ phase: "plan", attempts: 3, maxAttempts: 3 });
    expect(
      TaskTransitionPolicy.evaluate(exhausted, proposal({ from: "plan", to: "blocked" })).allowed,
    ).toBe(true);
  });

  it("refuses an empty or oversized reason", () => {
    for (const reason of ["", "   ", "x".repeat(4001)]) {
      expect(TaskTransitionPolicy.evaluate(capsule(), proposal({ reason })).allowed).toBe(false);
    }
  });

  it("reports every reason it refused for, not just the first", () => {
    const decision = TaskTransitionPolicy.evaluate(
      capsule({ phase: "plan" }),
      proposal({ from: "investigate", to: "plan", expectedCapsuleRevision: 9 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reasons.length).toBeGreaterThan(1);
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
