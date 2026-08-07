import { ArtifactId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { compileContext } from "../../src/index.js";

const artifact = ArtifactId.parse("artifact-1");

describe("context compiler", () => {
  const items = [
    { id: "objective-1", kind: "objective" as const, content: "Build the verified service.", mandatory: true, priority: 100, estimatedTokens: 30, provenanceArtifactIds: [artifact] },
    { id: "constraint-1", kind: "constraint" as const, content: "Preserve architecture.", mandatory: true, priority: 100, estimatedTokens: 20, provenanceArtifactIds: [artifact] },
    { id: "optional-1", kind: "artifact" as const, content: "Optional supporting detail.", mandatory: false, priority: 5, estimatedTokens: 40, provenanceArtifactIds: [artifact] },
  ];

  it("preserves mandatory context and omits optional overflow", () => {
    const result = compileContext({ items, maxTokens: 60 });
    expect(result.items.map((item) => item.id)).toEqual(["objective-1", "constraint-1"]);
    expect(result.omittedItemIds).toEqual(["optional-1"]);
  });

  it("is deterministic for equivalent input", () => {
    const left = compileContext({ items, maxTokens: 100 });
    const right = compileContext({ items: [...items].reverse(), maxTokens: 100 });
    expect(left.fingerprint).toBe(right.fingerprint);
    expect(left.items.map((item) => item.id)).toEqual(right.items.map((item) => item.id));
  });

  it("rejects mandatory context that cannot fit", () => {
    expect(() => compileContext({ items, maxTokens: 40 })).toThrow();
  });
});
