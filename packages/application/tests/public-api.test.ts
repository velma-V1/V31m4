import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  assertApplication,
  assertWithinDeadline,
  createOperationContext,
  isApplicationError,
  normalizeApplicationError,
  remainingTimeMs,
  throwIfOperationCancelled,
  chooseExecutionPlan,
  compileContext,
  planDiverseConfigurations,
  linkMissionEvidence,
  selectChampion,
  decideImprovement,
  calculateCapabilityScore,
  selectPracticeTask,
  evaluateAvatarUnlocks,
} from "../src/index.js";

describe("@v31m4/application public API", () => {
  it("exports every runtime constructor and helper", () => {
    expect(typeof ApplicationError).toBe("function");
    expect(typeof assertApplication).toBe("function");
    expect(typeof isApplicationError).toBe("function");
    expect(typeof normalizeApplicationError).toBe("function");
    expect(typeof createOperationContext).toBe("function");
    expect(typeof throwIfOperationCancelled).toBe("function");
    expect(typeof assertWithinDeadline).toBe("function");
    expect(typeof remainingTimeMs).toBe("function");
    expect(typeof chooseExecutionPlan).toBe("function");
    expect(typeof compileContext).toBe("function");
    expect(typeof planDiverseConfigurations).toBe("function");
    expect(typeof linkMissionEvidence).toBe("function");
    expect(typeof selectChampion).toBe("function");
    expect(typeof decideImprovement).toBe("function");
    expect(typeof calculateCapabilityScore).toBe("function");
    expect(typeof selectPracticeTask).toBe("function");
    expect(typeof evaluateAvatarUnlocks).toBe("function");
  });
});
