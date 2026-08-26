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
  reconcileExecutionEffect,
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

/**
 * Every authoritative decision folds the *whole* history. A repository that pages must be walked
 * to exhaustion, and a cursor progression that never terminates is an integrity condition — never
 * an excuse to decide against whatever the first page happened to contain.
 */
describe("paged ledger reads", () => {
  const taskId = "task:root" as never;
  const operationContext = {} as never;

  function pagingLedger(pages: readonly (readonly LedgerEntry[])[]) {
    const calls: (string | undefined)[] = [];
    return {
      calls,
      ledger: {
        async append() {
          throw new Error("unused");
        },
        async getById() {
          return null;
        },
        async listForTask(_task: never, request: { readonly cursor?: string }) {
          calls.push(request.cursor);
          const index = request.cursor === undefined ? 0 : Number(request.cursor);
          const items = pages[index] ?? [];
          return Object.freeze({
            items,
            ...(index + 1 < pages.length ? { nextCursor: String(index + 1) } : {}),
          });
        },
      } as never,
    };
  }

  it("follows the cursor to exhaustion and folds every page", async () => {
    const attemptEntry = attempt("ledger:paged");
    const outcome = entry({
      kind: "effect_confirmation",
      attemptEntryId: "ledger:paged",
      facts,
    });
    const { ledger, calls } = pagingLedger([
      [entry({ kind: "observation", facts })],
      [attemptEntry],
      [outcome],
    ]);
    const projection = await reconcileExecutionEffect({ ledger }, taskId, operationContext);
    expect(calls).toEqual([undefined, "1", "2"]);
    expect(projection.attempts).toHaveLength(1);
    expect(projection.attempts[0]?.outcome).toBe("confirmed");
  });

  it("is deterministic: the same paged history always folds identically", async () => {
    const pages = [[attempt("ledger:a")], [entry({ kind: "observation", facts })]];
    const first = await reconcileExecutionEffect(
      { ledger: pagingLedger(pages).ledger },
      taskId,
      operationContext,
    );
    const second = await reconcileExecutionEffect(
      { ledger: pagingLedger(pages).ledger },
      taskId,
      operationContext,
    );
    expect(first).toEqual(second);
  });

  it("refuses a repeated cursor rather than looping or truncating", async () => {
    const cyclic = {
      async append() {
        throw new Error("unused");
      },
      async getById() {
        return null;
      },
      async listForTask() {
        // Always the same cursor: a malformed progression that never terminates.
        return Object.freeze({ items: [attempt("ledger:a")], nextCursor: "0" });
      },
    } as never;
    await expect(
      reconcileExecutionEffect({ ledger: cyclic }, taskId, operationContext),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
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

/**
 * `dependsOnEntryIds` is a real validity edge, not a decoration. A conclusion cannot outlive its
 * premise: a check whose own report file has not moved is still stale once the observation it was
 * derived from goes stale or is invalidated.
 *
 * Every case below keeps the check's own fact on a *different* resource from its dependency's, so
 * nothing can pass by accident through the check's own fingerprint moving too.
 */
describe("check validity dependencies", () => {
  const REPORT = "reports/targeted-tests.json";
  const stableReport = { [REPORT]: hash("report-stable") };

  function observationEntry(
    id: string,
    locator: string,
    seed: string,
    overrides: Record<string, unknown> = {},
  ): LedgerEntry {
    return ExecutionLedgerEntry.create({
      id,
      taskId: "task:root",
      jobId: "job:1",
      recordedAt: "2026-08-26T00:00:00.000Z",
      detail: `read ${locator}`,
      kind: "observation",
      facts: [{ resourceKind: "workspace_file", locator, fingerprint: hash(seed) }],
      ...overrides,
    });
  }

  function checkEntry(
    id: string,
    locator: string,
    seed: string,
    dependsOnEntryIds: readonly string[],
    overrides: Record<string, unknown> = {},
  ): LedgerEntry {
    return ExecutionLedgerEntry.create({
      id,
      taskId: "task:root",
      jobId: "job:1",
      recordedAt: "2026-08-26T00:00:01.000Z",
      detail: "targeted tests passed",
      kind: "check_result",
      checkName: "targeted tests",
      passed: true,
      facts: [{ resourceKind: "report", locator, fingerprint: hash(seed) }],
      dependsOnEntryIds,
      ...overrides,
    });
  }

  const source = observationEntry("ledger:observation-source", "src/index.ts", "source-before");
  const check = checkEntry("ledger:check", REPORT, "report-stable", [source.id]);

  it("keeps a check valid while its dependency is current", () => {
    const projection = projectLedger([source, check]);
    expect(
      isEntryStillValid(projection, check, {
        ...stableReport,
        "src/index.ts": hash("source-before"),
      }),
    ).toBe(true);
  });

  it("invalidates a check whose dependency was explicitly invalidated", () => {
    const projection = projectLedger([
      source,
      check,
      entry({
        kind: "invalidation",
        invalidatesEntryIds: [source.id],
        reason: "the source file moved on",
      }),
    ]);
    // The check's own report is untouched; only the premise was superseded.
    expect(
      isEntryStillValid(projection, check, {
        ...stableReport,
        "src/index.ts": hash("source-before"),
      }),
    ).toBe(false);
  });

  it("invalidates a check whose dependency's own resource went stale", () => {
    const projection = projectLedger([source, check]);
    expect(
      isEntryStillValid(projection, check, {
        ...stableReport,
        "src/index.ts": hash("source-after"),
      }),
    ).toBe(false);
  });

  it("propagates invalidation through a chain of checks", () => {
    const middle = checkEntry("ledger:check-middle", "reports/unit.json", "unit-stable", [
      source.id,
    ]);
    const outer = checkEntry("ledger:check-outer", REPORT, "report-stable", [middle.id]);
    const entries = [source, middle, outer];
    const current = {
      ...stableReport,
      "reports/unit.json": hash("unit-stable"),
      "src/index.ts": hash("source-before"),
    };
    expect(isEntryStillValid(projectLedger(entries), outer, current)).toBe(true);
    // One stale resource two hops away is enough.
    expect(
      isEntryStillValid(projectLedger(entries), outer, {
        ...current,
        "src/index.ts": hash("source-after"),
      }),
    ).toBe(false);
    // And so is an explicit invalidation two hops away.
    expect(
      isEntryStillValid(
        projectLedger([
          ...entries,
          entry({
            kind: "invalidation",
            invalidatesEntryIds: [source.id],
            reason: "superseded",
          }),
        ]),
        outer,
        current,
      ),
    ).toBe(false);
  });

  it("fails closed when a declared dependency is not in the history at all", () => {
    const orphan = checkEntry("ledger:orphan", REPORT, "report-stable", ["ledger:missing"]);
    expect(isEntryStillValid(projectLedger([orphan]), orphan, stableReport)).toBe(false);
  });

  it("fails closed on a dependency from another task or another job", () => {
    for (const foreign of [{ taskId: "task:other" }, { jobId: "job:other" }]) {
      const stranger = observationEntry("ledger:foreign", "src/index.ts", "source-before", foreign);
      const dependent = checkEntry("ledger:dependent", REPORT, "report-stable", [stranger.id]);
      expect(
        isEntryStillValid(projectLedger([stranger, dependent]), dependent, {
          ...stableReport,
          "src/index.ts": hash("source-before"),
        }),
        JSON.stringify(foreign),
      ).toBe(false);
    }
  });

  it("fails closed on a dependency cycle in corrupted history", () => {
    // Append refuses a dependency that does not already exist, so a cycle can only reach the fold
    // through corrupted storage. It must not loop, and it must not be trusted.
    const left = checkEntry("ledger:cycle-left", "reports/left.json", "left-stable", [
      "ledger:cycle-right",
    ]);
    const right = checkEntry("ledger:cycle-right", "reports/right.json", "right-stable", [
      "ledger:cycle-left",
    ]);
    const current = {
      "reports/left.json": hash("left-stable"),
      "reports/right.json": hash("right-stable"),
    };
    expect(isEntryStillValid(projectLedger([left, right]), left, current)).toBe(false);
    expect(isEntryStillValid(projectLedger([left, right]), right, current)).toBe(false);
  });

  it("judges a non-fact-bearing entry by invalidation alone", () => {
    // Append refuses to create this shape — an invalidation may only name a fact-bearing entry —
    // but the fold must still be well defined if corrupted history presents one. It changes no
    // retry decision either way; `decideRetry` reads attempt outcomes, never the invalidated set.
    const attemptEntry = attempt("ledger:attempt-validity");
    expect(isEntryStillValid(projectLedger([attemptEntry]), attemptEntry, {})).toBe(true);
    expect(
      isEntryStillValid(
        projectLedger([
          attemptEntry,
          entry({
            kind: "invalidation",
            invalidatesEntryIds: [attemptEntry.id],
            reason: "superseded",
          }),
        ]),
        attemptEntry,
        {},
      ),
    ).toBe(false);
  });
});
