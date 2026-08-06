import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  assertApplication,
  isApplicationError,
  normalizeApplicationError,
} from "../src/application-errors.js";

describe("ApplicationError", () => {
  it("copies and recursively freezes safe details", () => {
    const source = { nested: { attempts: [1, 2] } };
    const error = new ApplicationError("CONFLICT", "conflict", { details: source });
    source.nested.attempts.push(3);
    expect(error.details).toEqual({ nested: { attempts: [1, 2] } });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(error.details["nested"])).toBe(true);
    expect(isApplicationError(error)).toBe(true);
  });

  it("serializes without leaking the cause", () => {
    const error = new ApplicationError("DEPENDENCY_FAILURE", "failed", {
      retryable: true,
      cause: new Error("provider secret"),
      details: { provider: "local" },
    });
    expect(error.toJSON()).toEqual({
      code: "DEPENDENCY_FAILURE",
      message: "failed",
      retryable: true,
      details: { provider: "local" },
    });
  });

  it("asserts and normalizes unknown failures", () => {
    expect(() => assertApplication(false, "NOT_FOUND", "missing")).toThrow(ApplicationError);
    const normalized = normalizeApplicationError(new Error("raw"));
    expect(normalized.code).toBe("DEPENDENCY_FAILURE");
    expect(normalizeApplicationError(normalized)).toBe(normalized);
  });
});
