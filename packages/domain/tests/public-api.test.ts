import { describe, expect, it } from "vitest";
import {
  ContentHash,
  createDomainEvent,
  DomainError,
  EventId,
  ProjectId,
  ResourceBudget,
  SafePath,
  Score,
} from "../src/index.js";

describe("@v31m4/domain public API", () => {
  it("exports every Foundation/Core Layer 1 runtime constructor", () => {
    expect(typeof DomainError).toBe("function");
    expect(typeof ProjectId.parse).toBe("function");
    expect(typeof EventId.parse).toBe("function");
    expect(typeof ContentHash.parse).toBe("function");
    expect(typeof SafePath.parse).toBe("function");
    expect(typeof Score.parse).toBe("function");
    expect(typeof ResourceBudget.create).toBe("function");
    expect(typeof createDomainEvent).toBe("function");
  });
});
