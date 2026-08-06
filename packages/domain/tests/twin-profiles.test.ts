import { describe, expect, it } from "vitest";
import {
  CapabilityProfile,
  DomainError,
  ModelProfile,
  PluginProfile,
  ProductionTwin,
  ToolProfile,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";

describe("production twin and capability profiles", () => {
  it("creates evidence-backed production twin relationships", () => {
    const requirement = ProductionTwin.createNode({
      id: "node-requirement",
      projectId: "project-1",
      kind: "requirement",
      label: "Verified domain entities",
    });
    const testNode = ProductionTwin.createNode({
      id: "node-test",
      projectId: "project-1",
      kind: "test",
      label: "Domain entity suite",
    });
    const edge = ProductionTwin.createEdge({
      id: "edge-verifies",
      projectId: "project-1",
      fromNodeId: testNode.id,
      toNodeId: requirement.id,
      kind: "verifies",
      evidenceIds: ["evidence-1"],
    });

    expect(edge.kind).toBe("verifies");
    expect(edge.evidenceIds).toEqual(["evidence-1"]);
  });

  it("rejects verification edges without evidence", () => {
    expect(() =>
      ProductionTwin.createEdge({
        id: "edge-verifies",
        projectId: "project-1",
        fromNodeId: "node-test",
        toNodeId: "node-requirement",
        kind: "verifies",
      }),
    ).toThrowError(DomainError);
  });

  it("records capability history in chronological order", () => {
    const initial = CapabilityProfile.createScore({
      capabilityId: "capability-domain",
      score: 0.7,
      sampleSize: 10,
      difficultyRange: [1, 3],
      evidenceIds: ["evidence-1"],
      measuredAt: T0,
    });
    const profile = CapabilityProfile.create({
      capabilityId: "capability-domain",
      displayName: "Domain Architecture",
      domain: "software",
      initialScore: {
        capabilityId: initial.capabilityId,
        score: initial.score,
        sampleSize: initial.sampleSize,
        difficultyRange: initial.difficultyRange,
        evidenceIds: initial.evidenceIds,
        measuredAt: initial.measuredAt,
      },
    });
    const updated = CapabilityProfile.record(profile, {
      capabilityId: "capability-domain",
      score: 0.8,
      sampleSize: 20,
      difficultyRange: [1, 4],
      evidenceIds: ["evidence-2"],
      measuredAt: "2026-08-06T20:01:00.000Z",
    });

    expect(updated.current.score).toBe(0.8);
    expect(updated.history).toHaveLength(2);
  });

  it("creates model, tool, and plugin profiles with isolated capabilities", () => {
    const score = CapabilityProfile.createScore({
      capabilityId: "capability-domain",
      score: 0.8,
      sampleSize: 20,
      difficultyRange: [1, 4],
      evidenceIds: ["evidence-1"],
      measuredAt: T0,
    });
    const model = ModelProfile.create({
      modelId: "model-qwen",
      adapterId: "adapter-ollama",
      displayName: "Qwen",
      status: "available",
      local: true,
      contextLimit: 32768,
      measuredCapabilities: [score],
      supportedModalities: ["text"],
    });
    const tool = ToolProfile.create({
      toolId: "tool-vitest",
      adapterId: "adapter-vitest",
      displayName: "Vitest",
      status: "available",
      operations: ["test.run"],
      installedVersion: "4.1.10",
      automationMethod: "cli",
    });
    const plugin = PluginProfile.create({
      pluginId: "plugin-software",
      version: "1.0.0",
      status: "registered",
      capabilities: ["capability-domain"],
      requiredToolIds: [tool.toolId],
    });

    expect(model.measuredCapabilities[0]?.score).toBe(0.8);
    expect(plugin.requiredToolIds).toEqual(["tool-vitest"]);
  });
});
