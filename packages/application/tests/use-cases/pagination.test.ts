import { describe, expect, it } from "vitest";
import { collectPortPages } from "../../src/use-cases/use-case-support.js";

describe("use-case pagination", () => {
  it("collects every page without silently truncating authoritative evaluation input", async () => {
    const values = await collectPortPages(async (cursor) => cursor === undefined
      ? { items: [1, 2], nextCursor: "page-2" }
      : { items: [3] });
    expect(values).toEqual([1, 2, 3]);
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("rejects repeated cursors instead of looping or duplicating records", async () => {
    await expect(collectPortPages(async () => ({ items: [1], nextCursor: "same" }))).rejects.toThrow();
  });
});
