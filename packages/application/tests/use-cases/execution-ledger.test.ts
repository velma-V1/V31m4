import {
  ContentHash,
  ExecutionLedgerEntry,
  type ExecutionLedgerEntry as LedgerEntry,
  sha256Hex,
} from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../src/application-errors.js";
import {
  decideRetry,
  isEntryStillValid,
  projectLedger,
} from "../../src/use-cases/reconcile-execution-effect.js";

/**
 * Reconciliation is a deterministic fold over recorded entries. No model participates, and an
 * effect that cannot be proved stays unproved.
 */
const hash = (seed: string) => ContentHash.parse(sha256Hex(seed));
const INTENT = hash("patch src/index.ts");

let counter = 0;
function entry(overrides: Record<string, unknown>): LedgerEntry {
  counter += 1;
  return ExecutionLedgerEntry.create({
    id: `ledger:${counter}`,
    taskId: "task:root",
    jobId: "job:1",
    recordedAt: "2026-08-26T00:00:00.000Z",
    detail: "recorded by the runtime",
    ...overrides,
  });
}

function attempt(id: string, intentFingerprint = INTENT): LedgerEntry {
  return ExecutionLedgerEntry.create({
    id,
    taskId: "task:root",
    jobId: "job:1",
    recordedAt: "2026-08-26T00:00:00.000Z",
    detail: "attempting code.patch",
    kind: "effect_attempt",
    intentFingerprint,
    operationId: "code.patch",
    workspaceId: "workspace-1",
    sandboxId: "sandbox:1",
  });
}

const facts = [
  { resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("after") },
];

describe("ledger projection", () => {
  it("reports an attempt with no outcome as unresolved", () => {
    const projection = projectLedger([attempt("ledger:a")]);
    expect(projection.attempts).toHaveLength(1);
    expect(projection.attempts[0]?.outcome).toBe("unresolved");
  });

  it("folds each outcome kind onto its attempt", () => {
    const cases = [
      ["effect_confirmation", "confirmed"],
      ["effect_nonapplication", "not_applied"],
      ["reconciliation_indeterminate", "indeterminate"],
    ] as const;
    for (const [kind, outcome] of cases) {
      const projection = projectLedger([
        attempt("ledger:a"),
        entry({
          kind,
          attemptEntryId: "ledger:a",
          facts: kind === "reconciliation_indeterminate" ? [] : facts,
        }),
      ]);
      expect(projection.attempts[0]?.outcome, kind).toBe(outcome);
    }
  });

  it("refuses to fold two conflicting finalized outcomes for one attempt", () => {
    expect(() =>
      projectLedger([
        attempt("ledger:a"),
        entry({ kind: "effect_confirmation", attemptEntryId: "ledger:a", facts }),
        entry({ kind: "effect_nonapplication", attemptEntryId: "ledger:a", facts }),
      ]),
    ).toThrow(ApplicationError);
  });

  it("records invalidations without rewriting the entries they supersede", () => {
    const observation = entry({ kind: "observation", facts });
    const projection = projectLedger([
      observation,
      entry({
        kind: "invalidation",
        invalidatesEntryIds: [observation.id],
        reason: "the file changed",
      }),
    ]);
    expect(projection.invalidatedEntryIds.has(observation.id)).toBe(true);
    // The original entry object is untouched: history is append-only.
    expect(observation.kind).toBe("observation");
  });

  it("is deterministic: the same entries always fold identically", () => {
    const entries = [
      attempt("ledger:a"),
      entry({ kind: "effect_confirmation", attemptEntryId: "ledger:a", facts }),
    ];
    expect(projectLedger(entries)).toEqual(projectLedger(entries));
  });
});

describe("retry decisions", () => {
  it("allows an intent that was never attempted", () => {
    expect(decideRetry(projectLedger([]), INTENT).allowed).toBe(true);
  });

  it("blocks an intent whose earlier attempt is still unresolved", () => {
    const decision = decideRetry(projectLedger([attempt("ledger:a")]), INTENT);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("ATTEMPT_UNRESOLVED");
  });

  it("blocks an intent whose earlier attempt is indeterminate", () => {
    const decision = decideRetry(
      projectLedger([
        attempt("ledger:a"),
        entry({ kind: "reconciliation_indeterminate", attemptEntryId: "ledger:a", facts: [] }),
      ]),
      INTENT,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("EFFECT_INDETERMINATE");
  });

  it("blocks an intent that was already confirmed as applied", () => {
    const decision = decideRetry(
      projectLedger([
        attempt("ledger:a"),
        entry({ kind: "effect_confirmation", attemptEntryId: "ledger:a", facts }),
      ]),
      INTENT,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("ALREADY_APPLIED");
  });

  it("allows a retry only after a verified non-application", () => {
    const decision = decideRetry(
      projectLedger([
        attempt("ledger:a"),
        entry({ kind: "effect_nonapplication", attemptEntryId: "ledger:a", facts }),
      ]),
      INTENT,
    );
    expect(decision.allowed).toBe(true);
  });

  it("blocks an intent whose earlier attempt merely failed", () => {
    // A failure says the attempt did not succeed. It does not say the effect never landed, so
    // treating it as a clear signal to repeat would be how a duplicate effect gets made.
    const decision = decideRetry(
      projectLedger([
        attempt("ledger:a"),
        entry({ kind: "failure", attemptEntryId: "ledger:a", reason: "the process died" }),
      ]),
      INTENT,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe("EFFECT_INDETERMINATE");
  });

  it("does not confuse a different intent with this one", () => {
    const projection = projectLedger([attempt("ledger:a", hash("some other work"))]);
    expect(decideRetry(projection, INTENT).allowed).toBe(true);
  });

  it("keeps blocking after a duplicate concurrent attempt is recorded", () => {
    // Two attempts at the same intent: whichever resolves, the other still gates a third try.
    const projection = projectLedger([attempt("ledger:a"), attempt("ledger:b")]);
    expect(decideRetry(projection, INTENT).allowed).toBe(false);
  });
});

describe("observation validity", () => {
  const observation = ExecutionLedgerEntry.create({
    id: "ledger:observation",
    taskId: "task:root",
    jobId: "job:1",
    recordedAt: "2026-08-26T00:00:00.000Z",
    detail: "read src/index.ts",
    kind: "observation",
    facts: [
      { resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("before") },
    ],
  });

  it("accepts an observation whose resource still carries the same fingerprint", () => {
    expect(
      isEntryStillValid(projectLedger([observation]), observation, {
        "src/index.ts": hash("before"),
      }),
    ).toBe(true);
  });

  it("rejects an observation after the resource it described changed", () => {
    expect(
      isEntryStillValid(projectLedger([observation]), observation, {
        "src/index.ts": hash("after the patch"),
      }),
    ).toBe(false);
  });

  it("rejects an observation of a resource that no longer exists", () => {
    expect(isEntryStillValid(projectLedger([observation]), observation, {})).toBe(false);
  });

  it("rejects an explicitly invalidated observation even when nothing changed", () => {
    const projection = projectLedger([
      observation,
      entry({
        kind: "invalidation",
        invalidatesEntryIds: [observation.id],
        reason: "a dependency it relied on moved",
      }),
    ]);
    expect(isEntryStillValid(projection, observation, { "src/index.ts": hash("before") })).toBe(
      false,
    );
  });

  it("rejects a check whose recorded facts have moved on", () => {
    const check = ExecutionLedgerEntry.create({
      id: "ledger:check",
      taskId: "task:root",
      jobId: "job:1",
      recordedAt: "2026-08-26T00:00:00.000Z",
      detail: "targeted tests passed",
      kind: "check_result",
      checkName: "targeted tests",
      passed: true,
      facts: [
        { resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("before") },
      ],
      dependsOnEntryIds: [observation.id],
    });
    const projection = projectLedger([observation, check]);
    expect(isEntryStillValid(projection, check, { "src/index.ts": hash("before") })).toBe(true);
    expect(isEntryStillValid(projection, check, { "src/index.ts": hash("patched") })).toBe(false);
  });
});
