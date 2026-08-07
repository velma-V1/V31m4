import { describe, expect, it } from "vitest";
import {
  type ContextCandidate,
  ContextCompiler,
  compileContext,
} from "../../src/services/context-compiler.js";
import { makeMission } from "./fixtures.js";

const supplemental: readonly ContextCandidate[] = [
  {
    kind: "requirement",
    id: "req:1",
    content: "Frames must match the golden images.",
    provenance: "requirement:req:1",
    relevance: 0.9,
  },
  {
    kind: "artifact",
    id: "artifact:notes",
    content: "Loosely related design notes.",
    provenance: "artifact:artifact:notes",
    relevance: 0.1,
  },
  {
    kind: "issue",
    id: "issue:1",
    content: "Prior flakiness in the shadow pass.",
    provenance: "issue:issue:1",
    relevance: 0.6,
  },
];

describe("ContextCompiler.compile", () => {
  it("includes mandatory mission material and the objective", () => {
    const result = compileContext({ mission: makeMission(), limitTokens: 10_000 });
    expect(result.outcome).toBe("compiled");
    if (result.outcome === "compiled") {
      const kinds = result.items.map((item) => item.kind);
      expect(kinds).toContain("objective");
      expect(kinds).toContain("constraint");
      expect(kinds).toContain("forbidden_change");
      expect(kinds).toContain("evidence_rule");
      expect(
        result.items.some((item) => item.kind === "acceptance_criterion" && item.mandatory),
      ).toBe(true);
    }
  });

  it("prunes low-relevance optional material when the limit is tight", () => {
    const result = compileContext({
      mission: makeMission(),
      limitTokens: 60,
      supplemental,
    });
    expect(result.outcome).toBe("compiled");
    if (result.outcome === "compiled") {
      // Every mandatory item survives.
      expect(result.items.filter((item) => item.mandatory).length).toBeGreaterThan(0);
      // The least relevant artifact is dropped for the token limit.
      expect(result.omittedOptional.some((entry) => entry.id === "artifact:notes")).toBe(true);
      expect(result.includedTokens).toBeLessThanOrEqual(60);
    }
  });

  it("keeps higher-relevance optional material ahead of lower", () => {
    const result = compileContext({ mission: makeMission(), limitTokens: 10_000, supplemental });
    expect(result.outcome).toBe("compiled");
    if (result.outcome === "compiled") {
      const optionalIds = result.items.filter((item) => !item.mandatory).map((item) => item.id);
      expect(optionalIds).toContain("req:1");
      expect(optionalIds).toContain("issue:1");
    }
  });

  it("reports mandatory context that cannot fit", () => {
    const result = compileContext({ mission: makeMission(), limitTokens: 3 });
    expect(result.outcome).toBe("mandatory_context_exceeds_limit");
    if (result.outcome === "mandatory_context_exceeds_limit") {
      expect(result.mandatoryTokens).toBeGreaterThan(3);
      expect(result.mandatoryItems.length).toBeGreaterThan(0);
    }
  });

  it("removes duplicate candidates and records the omission", () => {
    const withDuplicate: readonly ContextCandidate[] = [
      supplemental[0] as ContextCandidate,
      { ...(supplemental[0] as ContextCandidate), content: "duplicate content" },
    ];
    const result = compileContext({
      mission: makeMission(),
      limitTokens: 10_000,
      supplemental: withDuplicate,
    });
    expect(result.outcome).toBe("compiled");
    if (result.outcome === "compiled") {
      expect(result.items.filter((item) => item.id === "req:1").length).toBe(1);
      expect(result.omittedOptional.some((entry) => entry.reason === "duplicate")).toBe(true);
    }
  });

  it("preserves provenance for every item", () => {
    const result = compileContext({ mission: makeMission(), limitTokens: 10_000, supplemental });
    expect(result.outcome).toBe("compiled");
    if (result.outcome === "compiled") {
      expect(result.items.every((item) => item.provenance.length > 0)).toBe(true);
    }
  });

  it("produces a stable fingerprint and deterministic ordering", () => {
    const first = compileContext({ mission: makeMission(), limitTokens: 10_000, supplemental });
    const second = compileContext({ mission: makeMission(), limitTokens: 10_000, supplemental });
    expect(first).toStrictEqual(second);
    if (first.outcome === "compiled" && second.outcome === "compiled") {
      expect(first.fingerprint).toBe(second.fingerprint);
    }
  });

  it("changes the fingerprint when included content changes", () => {
    const first = compileContext({ mission: makeMission(), limitTokens: 10_000 });
    const second = compileContext({
      mission: makeMission({ objective: "A different but equally deterministic objective." }),
      limitTokens: 10_000,
    });
    if (first.outcome === "compiled" && second.outcome === "compiled") {
      expect(first.fingerprint).not.toBe(second.fingerprint);
    }
  });

  it("rejects a non-positive token limit", () => {
    expect(() => ContextCompiler.compile({ mission: makeMission(), limitTokens: 0 })).toThrowError(
      /limitTokens must be a positive safe integer/,
    );
  });
});
