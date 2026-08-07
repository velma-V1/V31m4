import { describe, expect, it } from "vitest";
import { linkMissionEvidence } from "../../src/index.js";
import { evidence, mission } from "./fixtures.js";

describe("evidence linker", () => {
  it("calculates complete mandatory coverage", () => {
    const result = linkMissionEvidence(mission(), [evidence()]);
    expect(result.mandatoryCovered).toBe(1);
    expect(result.criteria[0]?.status).toBe("passed");
  });

  it("keeps failed and passing evidence visible as a conflict", () => {
    const result = linkMissionEvidence(mission(), [evidence(), evidence({ id: "evidence-2", status: "failed" })]);
    expect(result.criteria[0]?.status).toBe("conflicting");
    expect(result.mandatoryCovered).toBe(0);
  });

  it("reports evidence linked to an unknown criterion", () => {
    const result = linkMissionEvidence(mission(), [evidence({ subjectId: "criterion-missing" })]);
    expect(result.orphanEvidenceIds).toEqual(["evidence-1"]);
  });
});
