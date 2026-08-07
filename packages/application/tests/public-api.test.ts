import { describe, expect, it } from "vitest";
import * as application from "../src/index.js";
import {
  ApplicationError,
  AvatarUnlockEngine,
  assertApplication,
  assertWithinDeadline,
  CapabilityCalculator,
  ChampionSelector,
  ComputeGovernor,
  ContextCompiler,
  createOperationContext,
  DiversityPlanner,
  EvidenceLinker,
  ImprovementPolicy,
  isApplicationError,
  normalizeApplicationError,
  PracticeSelector,
  remainingTimeMs,
  throwIfOperationCancelled,
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
  });

  it("exports all nine application services from the package entry point", () => {
    expect(typeof ComputeGovernor.select).toBe("function");
    expect(typeof ContextCompiler.compile).toBe("function");
    expect(typeof DiversityPlanner.plan).toBe("function");
    expect(typeof EvidenceLinker.link).toBe("function");
    expect(typeof ChampionSelector.select).toBe("function");
    expect(typeof ImprovementPolicy.decide).toBe("function");
    expect(typeof CapabilityCalculator.calculate).toBe("function");
    expect(typeof PracticeSelector.select).toBe("function");
    expect(typeof AvatarUnlockEngine.evaluate).toBe("function");
  });

  it("does not leak service internals through the public API", () => {
    expect("stableFingerprint" in application).toBe(false);
    expect("createSeededRandom" in application).toBe(false);
    expect("canonicalStringify" in application).toBe(false);
  });
});
