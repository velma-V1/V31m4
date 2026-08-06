import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMA_VERSION,
  assertContractVersionCompatible,
  isContractVersionCompatible,
} from "../src/common.schemas.js";
import { invokeModelRequestSchema } from "../src/models.schemas.js";

describe("contract compatibility", () => {
  it("accepts the exact current version and rejects silent minor or major drift", () => {
    expect(isContractVersionCompatible(CONTRACT_SCHEMA_VERSION)).toBe(true);
    expect(isContractVersionCompatible("1.0.1")).toBe(false);
    expect(isContractVersionCompatible("1.1.0")).toBe(false);
    expect(isContractVersionCompatible("2.0.0")).toBe(false);
    expect(() => assertContractVersionCompatible("1.0.0")).not.toThrow();
    expect(() => assertContractVersionCompatible("1.1.0")).toThrow();
  });

  it("rejects provider-specific request payloads at the public model boundary", () => {
    const request = {
      schemaVersion: "1.0.0",
      requestId: "request:1",
      jobId: "job:1",
      configuration: {
        modelId: "model:qwen",
        strategy: "direct",
        contextArtifactIds: ["artifact:context"],
        toolIds: [],
        constraints: [],
      },
      promptArtifactId: "artifact:prompt",
    } as const;
    expect(invokeModelRequestSchema.parse(request).jobId).toBe("job:1");
    expect(
      invokeModelRequestSchema.safeParse({
        ...request,
        ollamaOptions: { numGpu: 99 },
      }).success,
    ).toBe(false);
  });
});
