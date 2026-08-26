import { describe, expect, it } from "vitest";
import {
  ExecutionLedgerEntry,
  LEDGER_ENTRY_KINDS,
  LEDGER_LIMITS,
} from "../src/entities/execution-ledger-entry.js";
import { sha256Hex } from "../src/value-objects/canonical-fingerprint.js";
import { ContentHash } from "../src/value-objects/content-hash.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 3 — ledger entries are immutable, deterministic, and
 * structurally honest: an outcome entry cannot exist without the attempt it resolves.
 */
const hash = (seed: string) => ContentHash.parse(sha256Hex(seed));

const base = {
  id: "ledger:1",
  taskId: "task:root",
  jobId: "job:1",
  recordedAt: "2026-08-26T00:00:00.000Z",
  detail: "recorded by the runtime",
};

describe("ledger entry kinds", () => {
  it("exposes exactly the canonical kinds", () => {
    expect([...LEDGER_ENTRY_KINDS]).toEqual([
      "observation",
      "check_result",
      "effect_attempt",
      "effect_confirmation",
      "effect_nonapplication",
      "invalidation",
      "failure",
      "reconciliation_indeterminate",
    ]);
  });

  it("rejects a kind outside the canonical set", () => {
    expect(() => ExecutionLedgerEntry.create({ ...base, kind: "reconciled" } as never)).toThrow();
  });
});

describe("observation and check entries", () => {
  it("records resource facts with fingerprints", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "observation",
      facts: [{ resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("a") }],
    });
    expect(entry.kind).toBe("observation");
    expect(entry.kind === "observation" && entry.facts[0]?.locator).toBe("src/index.ts");
    expect(ContentHash.is(entry.fingerprint)).toBe(true);
  });

  it("requires at least one fact on an observation", () => {
    expect(() => ExecutionLedgerEntry.create({ ...base, kind: "observation", facts: [] })).toThrow(
      /fact/iu,
    );
  });

  it("records a check result with its validity dependencies", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "check_result",
      checkName: "targeted tests",
      passed: false,
      facts: [{ resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("a") }],
      dependsOnEntryIds: ["ledger:observation"],
    });
    expect(entry.kind === "check_result" && entry.passed).toBe(false);
    expect(entry.kind === "check_result" && entry.dependsOnEntryIds).toEqual([
      "ledger:observation",
    ]);
  });

  it("bounds the number of facts and dependencies", () => {
    const facts = Array.from({ length: LEDGER_LIMITS.maxFacts + 1 }, (_, index) => ({
      resourceKind: "workspace_file",
      locator: `file-${index}.ts`,
      fingerprint: hash(String(index)),
    }));
    expect(() => ExecutionLedgerEntry.create({ ...base, kind: "observation", facts })).toThrow();
  });
});

describe("effect attempt entries", () => {
  it("carries an intent fingerprint and the governed operation it will run", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "effect_attempt",
      intentFingerprint: hash("intent"),
      operationId: "code.patch",
      workspaceId: "workspace-1",
      sandboxId: "sandbox:1",
    });
    expect(entry.kind === "effect_attempt" && entry.intentFingerprint).toBe(hash("intent"));
    expect(entry.kind === "effect_attempt" && entry.operationId).toBe("code.patch");
  });

  it("requires an intent fingerprint", () => {
    expect(() =>
      ExecutionLedgerEntry.create({
        ...base,
        kind: "effect_attempt",
        operationId: "code.patch",
        workspaceId: "workspace-1",
        sandboxId: "sandbox:1",
      } as never),
    ).toThrow();
  });

  it("derives the same intent fingerprint for the same semantic intent", () => {
    const intent = {
      taskId: "task:root",
      operationId: "code.patch",
      workspaceId: "workspace-1",
      command: { executable: "git", arguments: ["status"] },
      parameters: { pathScope: ["src/index.ts"] },
    };
    const first = ExecutionLedgerEntry.intentFingerprint(intent);
    // Key order must not matter, and a second identical intent must match exactly.
    const second = ExecutionLedgerEntry.intentFingerprint({
      parameters: { pathScope: ["src/index.ts"] },
      command: { arguments: ["status"], executable: "git" },
      workspaceId: "workspace-1",
      operationId: "code.patch",
      taskId: "task:root",
    });
    expect(second).toBe(first);
    // A materially different intent must not collide.
    expect(
      ExecutionLedgerEntry.intentFingerprint({ ...intent, operationId: "command.run" }),
    ).not.toBe(first);
    expect(
      ExecutionLedgerEntry.intentFingerprint({ ...intent, workspaceId: "workspace-2" }),
    ).not.toBe(first);
  });
});

describe("outcome entries reference their attempt", () => {
  it("accepts an outcome that names its attempt", () => {
    for (const kind of [
      "effect_confirmation",
      "effect_nonapplication",
      "reconciliation_indeterminate",
    ] as const) {
      const entry = ExecutionLedgerEntry.create({
        ...base,
        kind,
        attemptEntryId: "ledger:attempt",
        facts:
          kind === "reconciliation_indeterminate"
            ? []
            : [{ resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("a") }],
      });
      expect(entry.kind).toBe(kind);
    }
  });

  it("refuses an orphan outcome with no attempt reference", () => {
    for (const kind of [
      "effect_confirmation",
      "effect_nonapplication",
      "reconciliation_indeterminate",
    ] as const) {
      expect(
        () => ExecutionLedgerEntry.create({ ...base, kind, facts: [] } as never),
        kind,
      ).toThrow();
    }
  });

  it("requires verified facts to confirm or deny application", () => {
    for (const kind of ["effect_confirmation", "effect_nonapplication"] as const) {
      expect(
        () =>
          ExecutionLedgerEntry.create({
            ...base,
            kind,
            attemptEntryId: "ledger:attempt",
            facts: [],
          }),
        kind,
      ).toThrow(/fact/iu);
    }
  });

  it("lets an indeterminate outcome record no facts, because none could be obtained", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "reconciliation_indeterminate",
      attemptEntryId: "ledger:attempt",
      facts: [],
    });
    expect(entry.kind).toBe("reconciliation_indeterminate");
  });
});

describe("invalidation entries", () => {
  it("names the entries it invalidates", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "invalidation",
      invalidatesEntryIds: ["ledger:observation", "ledger:check"],
      reason: "the patched file changed since it was observed",
    });
    expect(entry.kind === "invalidation" && entry.invalidatesEntryIds).toEqual([
      "ledger:observation",
      "ledger:check",
    ]);
  });

  it("refuses an invalidation that names nothing, or gives no reason", () => {
    expect(() =>
      ExecutionLedgerEntry.create({
        ...base,
        kind: "invalidation",
        invalidatesEntryIds: [],
        reason: "nothing to invalidate",
      }),
    ).toThrow();
    expect(() =>
      ExecutionLedgerEntry.create({
        ...base,
        kind: "invalidation",
        invalidatesEntryIds: ["ledger:observation"],
      }),
    ).toThrow(/reason/iu);
  });
});

describe("ledger entry immutability and determinism", () => {
  it("is deeply frozen and cannot be mutated through a retained input", () => {
    const facts = [
      { resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("a") },
    ];
    const entry = ExecutionLedgerEntry.create({ ...base, kind: "observation", facts });
    facts.push({ resourceKind: "workspace_file", locator: "injected.ts", fingerprint: hash("b") });
    if (entry.kind !== "observation") throw new Error("expected an observation");
    expect(entry.facts).toHaveLength(1);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.facts)).toBe(true);
    expect(Object.isFrozen(entry.facts[0])).toBe(true);
  });

  it("fingerprints identical content identically", () => {
    const input = {
      ...base,
      kind: "observation" as const,
      facts: [{ resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: hash("a") }],
    };
    expect(ExecutionLedgerEntry.create(input).fingerprint).toBe(
      ExecutionLedgerEntry.create(input).fingerprint,
    );
  });

  it("round-trips through persistence and rejects a tampered body", () => {
    const entry = ExecutionLedgerEntry.create({
      ...base,
      kind: "effect_attempt",
      intentFingerprint: hash("intent"),
      operationId: "code.patch",
      workspaceId: "workspace-1",
      sandboxId: "sandbox:1",
    });
    const reloaded = ExecutionLedgerEntry.rehydrate(JSON.parse(JSON.stringify(entry)));
    expect(reloaded).toEqual(entry);

    const tampered = { ...JSON.parse(JSON.stringify(entry)), detail: "rewritten history" };
    expect(() => ExecutionLedgerEntry.rehydrate(tampered)).toThrow(/fingerprint/iu);
  });

  it("bounds its detail text", () => {
    expect(() =>
      ExecutionLedgerEntry.create({
        ...base,
        detail: "x".repeat(LEDGER_LIMITS.maxTextLength + 1),
        kind: "failure",
        reason: "boom",
      }),
    ).toThrow();
  });
});
