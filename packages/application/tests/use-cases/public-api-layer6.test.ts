import * as application from "../../src/index.js";
import { describe, expect, it } from "vitest";

describe("Layer 6 public API", () => {
  it("exports all 21 application use cases and the practice repository boundary", () => {
    const names = [
      "createProject", "submitMission", "planExecution", "startJob", "checkpointJob", "resumeJob", "stopJob",
      "runSolverForge", "verifyCandidates", "recordIssues", "repairCandidate", "selectChampionUseCase", "deliverResult",
      "compileTrainingPacket", "promoteCapability", "runIdlePractice", "stopIdlePractice", "evaluateAvatarUnlocksUseCase",
      "registerPlugin", "invokeModel", "invokeTool",
    ];
    for (const name of names) expect(name in application).toBe(true);
    expect("PracticeRepositoryPort" in application).toBe(false);
  });
});
