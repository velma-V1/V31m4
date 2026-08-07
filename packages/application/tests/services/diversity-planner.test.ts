import { ArtifactId, ModelId, ToolId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { planDiverseConfigurations } from "../../src/index.js";
import { budget } from "./fixtures.js";

describe("diversity planner", () => {
  const input = {
    count: 3,
    seed: 7,
    modelIds: [ModelId.parse("model-1"), ModelId.parse("model-2")],
    strategies: ["direct", "failure_first"] as const,
    toolSets: [[ToolId.parse("tool-1")], [ToolId.parse("tool-2")]],
    contextArtifactIds: [ArtifactId.parse("artifact-context-1")],
    constraints: ["Preserve behavior."],
    resourceBudget: budget(),
  };

  it("creates materially distinct configurations", () => {
    const result = planDiverseConfigurations(input);
    const keys = result.configurations.map((value) => `${value.modelId}|${value.strategy}|${value.toolIds.join(",")}`);
    expect(result.configurations).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("is deterministic for the same seed", () => {
    expect(planDiverseConfigurations(input)).toEqual(planDiverseConfigurations(input));
  });

  it("rejects impossible diversity requests", () => {
    expect(() => planDiverseConfigurations({ ...input, count: 9 })).toThrow();
  });
});
