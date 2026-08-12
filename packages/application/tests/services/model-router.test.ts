import { CapabilityProfile, ModelProfile } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { routeModels } from "../../src/index.js";

function profile(
  modelId: string,
  options: {
    status?: "available" | "unavailable" | "degraded";
    contextLimit?: number;
    score?: number;
    sampleSize?: number;
  } = {},
) {
  return ModelProfile.create({
    modelId,
    adapterId: "ollama-local-supervised",
    displayName: modelId,
    status: options.status ?? "available",
    local: true,
    ...(options.contextLimit === undefined ? {} : { contextLimit: options.contextLimit }),
    measuredCapabilities:
      options.score === undefined
        ? []
        : [
            CapabilityProfile.createScore({
              capabilityId: "software.coding",
              score: options.score,
              sampleSize: options.sampleSize ?? 1,
              difficultyRange: [0, 1] as const,
              evidenceIds: [`evidence-${modelId}`],
              measuredAt: "2026-08-12T00:00:00.000Z",
            }),
          ],
    supportedModalities: ["text"],
  });
}

describe("routeModels", () => {
  it("routes by verified measured capability and returns a bounded escalation order", () => {
    const plan = routeModels({
      profiles: [
        profile("efficient", { score: 0.7, sampleSize: 20 }),
        profile("capable", { score: 0.9, sampleSize: 8 }),
        profile("offline", { status: "unavailable", score: 1, sampleSize: 100 }),
      ],
      requiredModality: "text",
      requiredCapabilityId: "software.coding",
      minimumContextTokens: 0,
      preferredModelId: "efficient",
      maxInvocations: 2,
    });
    expect(plan.modelIds).toEqual(["capable", "efficient"]);
    expect(plan.reason).toMatch(/measured/i);
  });

  it("uses explicit preference only when verified measurements do not distinguish candidates", () => {
    expect(
      routeModels({
        profiles: [profile("model-b"), profile("model-a")],
        requiredModality: "text",
        minimumContextTokens: 0,
        preferredModelId: "model-b",
        maxInvocations: 1,
      }).modelIds,
    ).toEqual(["model-b"]);
  });

  it("fails closed when availability, modality, or context requirements cannot be met", () => {
    expect(() =>
      routeModels({
        profiles: [profile("small", { contextLimit: 1024 })],
        requiredModality: "text",
        minimumContextTokens: 4096,
        maxInvocations: 1,
      }),
    ).toThrow(/model/i);
  });
});
