import { describe, expect, it } from "vitest";
import { assertDomain, DomainError, isDomainError } from "../src/domain-errors.js";

describe("DomainError", () => {
  it("preserves a typed code and immutable copied details", () => {
    const sourceDetails = { field: "projectId", received: "bad" };
    const error = new DomainError("INVALID_ID", "Invalid identifier.", sourceDetails);

    sourceDetails.received = "changed";

    expect(error.name).toBe("DomainError");
    expect(error.code).toBe("INVALID_ID");
    expect(error.message).toBe("Invalid identifier.");
    expect(error.details).toEqual({ field: "projectId", received: "bad" });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(isDomainError(error)).toBe(true);
  });

  it("assertDomain throws only when the condition is false", () => {
    expect(() => assertDomain(true, "INVALID_SCORE", "must not throw")).not.toThrow();
    expect(() => assertDomain(false, "INVALID_SCORE", "score failed")).toThrowError(
      new DomainError("INVALID_SCORE", "score failed"),
    );
  });
});
