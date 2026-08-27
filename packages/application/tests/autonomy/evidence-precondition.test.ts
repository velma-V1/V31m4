import {
  type ContentHash,
  EvidenceRecord,
  ExecutionLedgerEntry,
  JobId,
  sha256Hex,
  TaskId,
} from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertEvidencePreconditionSatisfied,
  type EvidencePreconditionPolicy,
  type EvidencePreconditionState,
  evaluateEvidencePrecondition,
  type PreconditionRequirement,
  projectLedger,
} from "../../src/index.js";

/**
 * Evidence-conditioned effects.
 *
 * A consequential effect is allowed only when the facts that justify it exist *and are still
 * current*. Both halves matter: an observation that has gone stale is not an answer, and a denial
 * has to say precisely what is missing or the agent cannot go and get it.
 *
 * Everything here reads the authority that already exists — immutable `EvidenceRecord` facts with
 * their own kind/subject/status semantics, and valid Ledger observations and check results. There
 * is deliberately no second free-form evidence taxonomy.
 */
const T0 = "2026-08-27T00:00:00.000Z";
const taskId = TaskId.parse("task:gate");
const jobId = JobId.parse("job:1");

let entries: ExecutionLedgerEntry[];
let records: EvidenceRecord[];
let counter: number;

function observation(resourceKind: string, locator: string, at: string): ExecutionLedgerEntry {
  counter += 1;
  return ExecutionLedgerEntry.create({
    id: `ledger:${counter}`,
    taskId: "task:gate",
    jobId: "job:1",
    recordedAt: T0,
    kind: "observation",
    detail: `${resourceKind} observed`,
    facts: [{ resourceKind, locator, fingerprint: sha256Hex(at) }],
  });
}

function evidence(
  kind: EvidenceRecord["kind"],
  subjectType: string,
  status: EvidenceRecord["status"] = "passed",
): EvidenceRecord {
  counter += 1;
  return EvidenceRecord.create({
    id: `evidence:${counter}`,
    projectId: "project:1",
    jobId: "job:1",
    kind,
    subjectType,
    subjectId: "requirement:one",
    status,
    summary: `${kind} for ${subjectType}`,
    artifactIds: [`artifact-${counter}`],
    verifierId: "verifier:deterministic",
    verifierVersion: "1.0.0",
    createdAt: T0,
  });
}

/** The fingerprints every recorded fact currently carries; anything absent is not current. */
function currentFingerprints(): Record<string, string> {
  const current: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.kind !== "observation" && entry.kind !== "check_result") continue;
    for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
  }
  return current;
}

function state(overrides: Partial<EvidencePreconditionState> = {}): EvidencePreconditionState {
  return {
    taskId,
    jobId,
    history: entries,
    projection: projectLedger(entries),
    evidence: records,
    currentFingerprints: currentFingerprints(),
    ...overrides,
  };
}

const needsDefinition: PreconditionRequirement = Object.freeze({
  kind: "ledger_observation",
  resourceKind: "symbol_definition",
  requireCurrentFingerprint: true,
});
const needsUnitTest: PreconditionRequirement = Object.freeze({
  kind: "evidence",
  allowedEvidenceKinds: ["unit_test", "integration_test"] as const,
  subjectType: "acceptance_criterion",
  requirePassed: true,
});

function policyOf(...requirements: PreconditionRequirement[]): EvidencePreconditionPolicy {
  return Object.freeze({ policyId: "evidence.test.v1", requirements: Object.freeze(requirements) });
}

beforeEach(() => {
  counter = 0;
  entries = [];
  records = [];
});

describe("an empty policy is satisfied, so the investigation path is never blocked", () => {
  it("allows an operation that requires nothing", () => {
    const verdict = evaluateEvidencePrecondition(policyOf(), state());
    expect(verdict.kind).toBe("satisfied");
    expect(() => assertEvidencePreconditionSatisfied(verdict, "repo.search")).not.toThrow();
  });
});

describe("a ledger observation satisfies only while it is still current", () => {
  it("accepts a current observation of the required resource kind", () => {
    entries = [observation("symbol_definition", "src/target.ts#run", "v1")];
    const verdict = evaluateEvidencePrecondition(policyOf(needsDefinition), state());
    expect(verdict.kind).toBe("satisfied");
    expect(verdict.kind === "satisfied" ? verdict.satisfiedBy : []).toContain("ledger:1");
  });

  it("refuses a stale observation whose resource moved after it was recorded", () => {
    entries = [observation("symbol_definition", "src/target.ts#run", "v1")];
    const verdict = evaluateEvidencePrecondition(
      policyOf(needsDefinition),
      state({ currentFingerprints: { "src/target.ts#run": sha256Hex("v2") } }),
    );
    expect(verdict.kind).toBe("unsatisfied");
    expect(verdict.kind === "unsatisfied" ? verdict.missing[0]?.reason : "").toMatch(/stale/iu);
  });

  it("refuses an observation whose locator is no longer observed at all", () => {
    entries = [observation("symbol_definition", "src/target.ts#run", "v1")];
    expect(
      evaluateEvidencePrecondition(policyOf(needsDefinition), state({ currentFingerprints: {} }))
        .kind,
    ).toBe("unsatisfied");
  });

  it("refuses an observation of a different resource kind", () => {
    entries = [observation("impact_analysis", "src/target.ts", "v1")];
    expect(evaluateEvidencePrecondition(policyOf(needsDefinition), state()).kind).toBe(
      "unsatisfied",
    );
  });

  it("refuses an observation a later entry invalidated", () => {
    counter = 0;
    const observed = observation("symbol_definition", "src/target.ts#run", "v1");
    entries = [
      observed,
      ExecutionLedgerEntry.create({
        id: "ledger:invalidate",
        taskId: "task:gate",
        jobId: "job:1",
        recordedAt: T0,
        kind: "invalidation",
        detail: "the symbol was rewritten out of band",
        reason: "the symbol was rewritten out of band",
        invalidatesEntryIds: [observed.id],
      }),
    ];
    expect(evaluateEvidencePrecondition(policyOf(needsDefinition), state()).kind).toBe(
      "unsatisfied",
    );
  });

  it("accepts a current check result carrying the required fact", () => {
    counter += 1;
    entries = [
      ExecutionLedgerEntry.create({
        id: "ledger:check",
        taskId: "task:gate",
        jobId: "job:1",
        recordedAt: T0,
        kind: "check_result",
        checkName: "build.check",
        passed: true,
        detail: "build.check passed",
        facts: [
          {
            resourceKind: "check_report",
            locator: "reports/build.json",
            fingerprint: sha256Hex("report"),
          },
        ],
      }),
    ];
    const verdict = evaluateEvidencePrecondition(
      policyOf({
        kind: "ledger_observation",
        resourceKind: "check_report",
        requireCurrentFingerprint: true,
      }),
      state(),
    );
    expect(verdict.kind).toBe("satisfied");
  });

  it("refuses a failed check as a satisfying fact", () => {
    entries = [
      ExecutionLedgerEntry.create({
        id: "ledger:check",
        taskId: "task:gate",
        jobId: "job:1",
        recordedAt: T0,
        kind: "check_result",
        checkName: "build.check",
        passed: false,
        detail: "build.check failed",
        facts: [
          {
            resourceKind: "check_report",
            locator: "reports/build.json",
            fingerprint: sha256Hex("report"),
          },
        ],
      }),
    ];
    expect(
      evaluateEvidencePrecondition(
        policyOf({
          kind: "ledger_observation",
          resourceKind: "check_report",
          requireCurrentFingerprint: true,
        }),
        state(),
      ).kind,
    ).toBe("unsatisfied");
  });
});

describe("an evidence requirement uses the existing record semantics, not a new taxonomy", () => {
  it("accepts a passing record of an allowed kind and subject type", () => {
    records = [evidence("unit_test", "acceptance_criterion")];
    const verdict = evaluateEvidencePrecondition(policyOf(needsUnitTest), state());
    expect(verdict.kind).toBe("satisfied");
    expect(verdict.kind === "satisfied" ? verdict.satisfiedBy : []).toContain("evidence:1");
  });

  it("refuses a record that did not pass", () => {
    records = [evidence("unit_test", "acceptance_criterion", "failed")];
    expect(evaluateEvidencePrecondition(policyOf(needsUnitTest), state()).kind).toBe("unsatisfied");
    records = [evidence("unit_test", "acceptance_criterion", "inconclusive")];
    expect(evaluateEvidencePrecondition(policyOf(needsUnitTest), state()).kind).toBe("unsatisfied");
  });

  it("refuses a record of a kind the requirement does not allow", () => {
    records = [evidence("benchmark", "acceptance_criterion")];
    expect(evaluateEvidencePrecondition(policyOf(needsUnitTest), state()).kind).toBe("unsatisfied");
  });

  it("refuses a record about a different subject type", () => {
    records = [evidence("unit_test", "candidate")];
    expect(evaluateEvidencePrecondition(policyOf(needsUnitTest), state()).kind).toBe("unsatisfied");
  });
});

describe("a denial is actionable and non-retryable until the state changes", () => {
  it("lists every missing requirement, not merely the first", () => {
    const verdict = evaluateEvidencePrecondition(policyOf(needsDefinition, needsUnitTest), state());
    expect(verdict.kind === "unsatisfied" ? verdict.missing.length : 0).toBe(2);
  });

  it("reports partial satisfaction without letting the effect through", () => {
    entries = [observation("symbol_definition", "src/target.ts#run", "v1")];
    const verdict = evaluateEvidencePrecondition(policyOf(needsDefinition, needsUnitTest), state());
    expect(verdict.kind).toBe("unsatisfied");
    expect(verdict.kind === "unsatisfied" ? verdict.missing.length : 0).toBe(1);
  });

  it("throws a non-retryable typed denial naming the operation and what is missing", () => {
    const verdict = evaluateEvidencePrecondition(policyOf(needsDefinition, needsUnitTest), state());
    try {
      assertEvidencePreconditionSatisfied(verdict, "code.patch");
      throw new Error("expected a denial");
    } catch (error) {
      const denial = error as {
        code: string;
        retryable: boolean;
        details: Record<string, unknown>;
      };
      expect(denial.code).toBe("POLICY_REJECTED");
      // Retrying the identical request changes nothing; new evidence or state must arrive first.
      expect(denial.retryable).toBe(false);
      expect(String(denial.details["operationId"])).toBe("code.patch");
      expect(String(denial.details["missing"])).toMatch(/symbol_definition/u);
      expect(String(denial.details["missing"])).toMatch(/unit_test/u);
    }
  });

  it("is deterministic: the same state and policy produce the same verdict", () => {
    entries = [observation("symbol_definition", "src/target.ts#run", "v1")];
    const policy = policyOf(needsDefinition, needsUnitTest);
    expect(evaluateEvidencePrecondition(policy, state())).toEqual(
      evaluateEvidencePrecondition(policy, state()),
    );
  });
});

describe("facts from another task or job never satisfy this task's gate", () => {
  it("ignores an observation recorded under a different job of the same task", () => {
    entries = [
      ExecutionLedgerEntry.create({
        id: "ledger:other-job",
        taskId: "task:gate",
        jobId: "job:2",
        recordedAt: T0,
        kind: "observation",
        detail: "symbol_definition observed in another run",
        facts: [
          {
            resourceKind: "symbol_definition",
            locator: "src/target.ts#run",
            fingerprint: sha256Hex("v1") as ContentHash,
          },
        ],
      }),
    ];
    expect(evaluateEvidencePrecondition(policyOf(needsDefinition), state()).kind).toBe(
      "unsatisfied",
    );
  });

  it("ignores an observation recorded against a different task", () => {
    entries = [
      ExecutionLedgerEntry.create({
        id: "ledger:other",
        taskId: "task:other",
        jobId: "job:1",
        recordedAt: T0,
        kind: "observation",
        detail: "symbol_definition observed elsewhere",
        facts: [
          {
            resourceKind: "symbol_definition",
            locator: "src/target.ts#run",
            fingerprint: sha256Hex("v1") as ContentHash,
          },
        ],
      }),
    ];
    expect(evaluateEvidencePrecondition(policyOf(needsDefinition), state()).kind).toBe(
      "unsatisfied",
    );
  });
});
