import { describe, expect, it } from "vitest";
import {
  containsPrivateReasoningKey,
  isPrivateReasoningKey,
  PRIVATE_REASONING_KEYS,
} from "../src/index.js";

describe("private reasoning is refused wherever it appears", () => {
  it("names every reasoning-bearing property the system refuses", () => {
    expect(PRIVATE_REASONING_KEYS).toContain("reasoning");
    expect(PRIVATE_REASONING_KEYS).toContain("thinking");
    expect(PRIVATE_REASONING_KEYS).toContain("chain_of_thought");
    expect(PRIVATE_REASONING_KEYS.length).toBeGreaterThan(4);
    expect(isPrivateReasoningKey("reasoning")).toBe(true);
    expect(isPrivateReasoningKey("summary")).toBe(false);
    // A frozen `Set` still accepts `add`, so the published list is an array that cannot be edited.
    expect(Object.isFrozen(PRIVATE_REASONING_KEYS)).toBe(true);
    expect(() => (PRIVATE_REASONING_KEYS as string[]).push("summary")).toThrow();
  });

  it("finds a reasoning key at any depth, including inside arrays", () => {
    for (const key of PRIVATE_REASONING_KEYS) {
      expect(containsPrivateReasoningKey({ [key]: "step 1" })).toBe(true);
      expect(containsPrivateReasoningKey({ a: { b: [{ [key]: "step 1" }] } })).toBe(true);
    }
  });

  it("leaves ordinary payloads alone and terminates on a cyclic one", () => {
    expect(containsPrivateReasoningKey({ query: "x", limit: 5, summary: "done" })).toBe(false);
    expect(containsPrivateReasoningKey(["a", 1, null, true])).toBe(false);
    expect(containsPrivateReasoningKey(null)).toBe(false);
    expect(containsPrivateReasoningKey("thinking")).toBe(false);
    const cyclic: Record<string, unknown> = { safe: 1 };
    cyclic["self"] = cyclic;
    expect(containsPrivateReasoningKey(cyclic)).toBe(false);
    cyclic["thinking"] = "step 1";
    expect(containsPrivateReasoningKey(cyclic)).toBe(true);
  });
});
