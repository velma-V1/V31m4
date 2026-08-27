import { ExecutionLedgerEntry, sha256Hex, TaskCapsule } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { projectLedger } from "../../src/index.js";
import { freezeEntryAcceptanceSnapshot } from "../../src/services/entry-acceptance-snapshot.js";
import { type ManagerRoutingInput, routeNextStep } from "../../src/services/manager-routing.js";

/**
 * Deterministic-first Manager routing.
 *
 * A model is not the default merely because one is available. The Manager first asks whether the
 * next bounded step is already decided by machinery V31M4 owns — the frozen acceptance contract and
 * the Execution Ledger — and only asks a model where adaptive reasoning materially helps. Nothing
 * here introduces authority: routing chooses *which* governed path runs, never what is permitted.
 */
const T0 = "2026-08-27T00:00:00.000Z";
let entryCounter = 0;

const capsule = TaskCapsule.create({
  taskId: "task:routing",
  jobId: "job:1",
  projectId: "project:1",
  phase: "execute",
  attempts: 1,
  maxAttempts: 3,
  objective: "Repair the failing verification path.",
  acceptanceCriterionIds: ["requirement:one"],
  dagNodes: [
    { id: "node:root", title: "Execute", dependsOn: [] },
    { id: "node:blocked", title: "Blocked", dependsOn: [], blocked: true },
  ],
  workspaceId: "workspace-1",
  stopCondition: "stop after three attempts",
  updatedAt: T0,
});

function snapshot(requiredChecks: readonly string[]) {
  return freezeEntryAcceptanceSnapshot({
    capsule,
    requiredChecks,
    requiredEvidenceKinds: ["unit_test"],
    riskPolicyIds: [],
    workspaceFingerprint: null,
    frozenAt: T0,
  });
}

function nextId(): string {
  entryCounter += 1;
  return `ledger:${entryCounter}`;
}

function checkResult(checkName: string, passed: boolean) {
  entryCounter += 1;
  return ExecutionLedgerEntry.create({
    id: `ledger:${entryCounter}`,
    taskId: "task:routing",
    jobId: "job:1",
    recordedAt: T0,
    kind: "check_result",
    checkName,
    passed,
    detail: `${checkName} ${passed ? "passed" : "failed"}`,
    facts: [
      {
        resourceKind: "check_report",
        locator: `reports/${checkName}.json`,
        fingerprint: sha256Hex(`${checkName}:${passed}`),
      },
    ],
  });
}

function attempt() {
  entryCounter += 1;
  return ExecutionLedgerEntry.create({
    id: `ledger:${entryCounter}`,
    taskId: "task:routing",
    jobId: "job:1",
    recordedAt: T0,
    kind: "effect_attempt",
    detail: "attempting code.patch",
    intentFingerprint: sha256Hex("intent"),
    operationId: "code.patch",
    workspaceId: "workspace-1",
    sandboxId: null,
  });
}

/**
 * "Nothing observed has moved since it was recorded." A locator absent from this map is *not*
 * confirmed current, which is the canonical fail-closed rule — so a routing input must state what
 * it still knows to be true rather than leaving it blank.
 */
function unchanged(entries: readonly ExecutionLedgerEntry[]): Record<string, string> {
  const current: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.kind !== "check_result" && entry.kind !== "observation") continue;
    for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
  }
  return current;
}

function routing(overrides: Partial<ManagerRoutingInput> = {}): ManagerRoutingInput {
  const entries = overrides.checkResults ?? [];
  return {
    snapshot: snapshot(["build.check", "test.regression"]),
    projection: projectLedger(entries),
    checkResults: entries,
    readyNodeIds: ["node:root"],
    currentFingerprints: unchanged(entries),
    ...overrides,
  };
}

describe("deterministic machinery is preferred whenever it is sufficient", () => {
  it("runs the first pending required check instead of asking a model", () => {
    expect(routeNextStep(routing())).toMatchObject({
      kind: "deterministic_check",
      checkName: "build.check",
    });
  });

  it("takes the checks in the contract's canonical order, not in arrival order", () => {
    const done = [checkResult("build.check", true)];
    expect(
      routeNextStep(
        routing({
          checkResults: done,
          projection: projectLedger(done),
          currentFingerprints: unchanged(done),
        }),
      ),
    ).toMatchObject({ kind: "deterministic_check", checkName: "test.regression" });
  });

  it("finishes the remaining deterministic checks before diagnosing an earlier failure", () => {
    // A cheap deterministic answer that is still outstanding beats spending a model turn on a
    // diagnosis that the outstanding check might well inform.
    const entries = [checkResult("build.check", false)];
    expect(
      routeNextStep(
        routing({
          checkResults: entries,
          projection: projectLedger(entries),
          currentFingerprints: unchanged(entries),
        }),
      ),
    ).toMatchObject({ kind: "deterministic_check", checkName: "test.regression" });
  });

  it("hands a fully satisfied contract to the auditor without a model turn", () => {
    const entries = [checkResult("build.check", true), checkResult("test.regression", true)];
    expect(
      routeNextStep(
        routing({
          checkResults: entries,
          projection: projectLedger(entries),
          currentFingerprints: unchanged(entries),
        }),
      ),
    ).toMatchObject({ kind: "audit" });
  });
});

describe("a model is invoked only where adaptive reasoning materially helps", () => {
  it("asks for a model turn when every required check ran and one genuinely failed", () => {
    const entries = [checkResult("build.check", true), checkResult("test.regression", false)];
    const route = routeNextStep(
      routing({
        checkResults: entries,
        projection: projectLedger(entries),
        currentFingerprints: unchanged(entries),
      }),
    );
    expect(route.kind).toBe("model_turn");
    expect(route.reason).toMatch(/test\.regression/u);
  });

  it("asks for a model turn when no deterministic contract applies to the task at all", () => {
    const route = routeNextStep(routing({ snapshot: snapshot([]) }));
    expect(route.kind).toBe("model_turn");
    expect(route.reason).toMatch(/no required deterministic check/iu);
  });

  it("treats a stale check as not run rather than as an answer", () => {
    const entries = [checkResult("build.check", true), checkResult("test.regression", true)];
    // The report the passing check rested on has moved, so the check is no longer current.
    const route = routeNextStep(
      routing({
        checkResults: entries,
        projection: projectLedger(entries),
        currentFingerprints: {
          ...unchanged(entries),
          "reports/test.regression.json": sha256Hex("moved"),
        },
      }),
    );
    expect(route).toMatchObject({ kind: "deterministic_check", checkName: "test.regression" });
  });

  it("treats an invalidated check as not run", () => {
    const passing = checkResult("build.check", true);
    const invalidation = ExecutionLedgerEntry.create({
      id: nextId(),
      taskId: "task:routing",
      jobId: "job:1",
      recordedAt: T0,
      kind: "invalidation",
      detail: "the build report was superseded",
      reason: "the build report was superseded",
      invalidatesEntryIds: [passing.id],
    });
    const entries = [passing, invalidation];
    expect(
      routeNextStep(
        routing({
          checkResults: [passing],
          projection: projectLedger(entries),
          currentFingerprints: unchanged([passing]),
        }),
      ),
    ).toMatchObject({ kind: "deterministic_check", checkName: "build.check" });
  });
});

describe("routing refuses to move while the world is unknown or nothing is ready", () => {
  it("blocks when no dependency-ready node exists", () => {
    const route = routeNextStep(routing({ readyNodeIds: [] }));
    expect(route.kind).toBe("blocked");
    expect(route.reason).toMatch(/ready/iu);
  });

  it("blocks while an effect attempt is still unreconciled", () => {
    const open = attempt();
    const route = routeNextStep(routing({ checkResults: [], projection: projectLedger([open]) }));
    expect(route.kind).toBe("blocked");
    expect(route.reason).toMatch(/unreconciled|reconcil/iu);
  });

  it("resumes once the ambiguous effect has been settled", () => {
    const open = attempt();
    const settled = ExecutionLedgerEntry.create({
      id: nextId(),
      taskId: "task:routing",
      jobId: "job:1",
      recordedAt: T0,
      kind: "effect_nonapplication",
      detail: "code.patch verified as not_applied",
      attemptEntryId: open.id,
      facts: [
        {
          resourceKind: "workspace_file",
          locator: "src/index.ts",
          fingerprint: sha256Hex("before"),
        },
      ],
    });
    expect(
      routeNextStep(routing({ checkResults: [], projection: projectLedger([open, settled]) })),
    ).toMatchObject({ kind: "deterministic_check", checkName: "build.check" });
  });

  it("returns a frozen decision that carries no authority of its own", () => {
    const route = routeNextStep(routing());
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.keys(route)).toEqual(expect.arrayContaining(["kind", "reason"]));
    // Routing never says what is permitted; it only says which governed path to take next.
    expect(Object.keys(route)).not.toContain("allowedOperations");
    expect(Object.keys(route)).not.toContain("policyDecision");
  });
});
