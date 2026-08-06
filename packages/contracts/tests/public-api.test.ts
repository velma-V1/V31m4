import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

describe("@v31m4/contracts public API", () => {
  it("exports every Layer 3 contract family", () => {
    expect(contracts.CONTRACT_SCHEMA_VERSION).toBe("1.0.0");
    expect(typeof contracts.createProjectRequestSchema.parse).toBe("function");
    expect(typeof contracts.submitMissionRequestSchema.parse).toBe("function");
    expect(typeof contracts.jobSchema.parse).toBe("function");
    expect(typeof contracts.evidenceRecordSchema.parse).toBe("function");
    expect(typeof contracts.capabilityProfileSchema.parse).toBe("function");
    expect(typeof contracts.modelProfileSchema.parse).toBe("function");
    expect(typeof contracts.toolProfileSchema.parse).toBe("function");
    expect(typeof contracts.pluginManifestContractSchema.parse).toBe("function");
    expect(typeof contracts.practiceTaskSchema.parse).toBe("function");
    expect(typeof contracts.avatarStateSchema.parse).toBe("function");
    expect(typeof contracts.runtimeEventSchema.parse).toBe("function");
    expect(typeof contracts.adapterRpcMessageSchema.parse).toBe("function");
  });
});
