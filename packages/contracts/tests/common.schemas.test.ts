import { describe, expect, it } from "vitest";
import {
  apiRequestMetadataSchema,
  CONTRACT_SCHEMA_VERSION,
  contentHashSchema,
  contractVersionSchema,
  isoDateTimeSchema,
  paginationRequestSchema,
  projectIdSchema,
  resourceBudgetSchema,
  safeJsonValueSchema,
  safePathSchema,
} from "../src/common.schemas.js";

describe("common contract schemas", () => {
  it("accepts only the current exact contract version", () => {
    expect(contractVersionSchema.parse(CONTRACT_SCHEMA_VERSION)).toBe("1.0.0");
    expect(contractVersionSchema.safeParse("1.0").success).toBe(false);
    expect(contractVersionSchema.safeParse("v1.0.0").success).toBe(false);
    expect(contractVersionSchema.safeParse("1.0.1").success).toBe(false);
  });

  it("accepts canonical UTC timestamps and rejects normalized lookalikes", () => {
    expect(isoDateTimeSchema.parse("2026-08-06T21:00:00.000Z")).toBe("2026-08-06T21:00:00.000Z");
    expect(isoDateTimeSchema.safeParse("2026-08-06T21:00:00Z").success).toBe(false);
    expect(isoDateTimeSchema.safeParse("2026-02-30T21:00:00.000Z").success).toBe(false);
    expect(isoDateTimeSchema.safeParse("2026-08-06T17:00:00.000-04:00").success).toBe(false);
  });

  it("uses domain validation for durable identifiers, paths, hashes, and budgets", () => {
    expect(projectIdSchema.parse("project:alpha")).toBe("project:alpha");
    expect(projectIdSchema.safeParse(" bad").success).toBe(false);
    expect(safePathSchema.parse("projects/alpha")).toBe("projects/alpha");
    expect(safePathSchema.safeParse("../escape").success).toBe(false);
    expect(contentHashSchema.parse("a".repeat(64))).toBe("a".repeat(64));
    expect(contentHashSchema.safeParse("A".repeat(64)).success).toBe(false);

    expect(
      resourceBudgetSchema.parse({
        maxWallClockMs: 1,
        maxModelInvocations: 0,
        maxToolInvocations: 0,
        maxRepairRounds: 0,
        maxConcurrentWorkers: 1,
      }),
    ).toEqual({
      maxWallClockMs: 1,
      maxModelInvocations: 0,
      maxToolInvocations: 0,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    });
    expect(
      resourceBudgetSchema.safeParse({
        maxWallClockMs: 0,
        maxModelInvocations: 0,
        maxToolInvocations: 0,
        maxRepairRounds: 0,
        maxConcurrentWorkers: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown request metadata fields instead of stripping them", () => {
    expect(
      apiRequestMetadataSchema.parse({
        schemaVersion: "1.0.0",
        requestId: "request:1",
      }),
    ).toEqual({ schemaVersion: "1.0.0", requestId: "request:1" });
    expect(
      apiRequestMetadataSchema.safeParse({
        schemaVersion: "1.0.0",
        requestId: "request:1",
        ignored: true,
      }).success,
    ).toBe(false);
  });

  it("accepts finite acyclic JSON and rejects hostile or non-JSON values", () => {
    const valid = {
      title: "safe",
      nested: [1, true, null, { value: "ok" }],
    };
    expect(safeJsonValueSchema.parse(valid)).toEqual(valid);

    expect(safeJsonValueSchema.safeParse({ value: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(safeJsonValueSchema.safeParse(new Date()).success).toBe(false);
    expect(
      safeJsonValueSchema.safeParse(JSON.parse('{"__proto__":{"polluted":true}}')).success,
    ).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(safeJsonValueSchema.safeParse(cyclic).success).toBe(false);
  });

  it("bounds pagination and rejects unknown fields", () => {
    expect(paginationRequestSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(paginationRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationRequestSchema.safeParse({ limit: 501 }).success).toBe(false);
    expect(paginationRequestSchema.safeParse({ limit: 10, offset: -1 }).success).toBe(false);
    expect(paginationRequestSchema.safeParse({ limit: 10, extra: true }).success).toBe(false);
  });
});
