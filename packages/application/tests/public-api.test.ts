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
});
