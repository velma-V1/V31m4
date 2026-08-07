import { describe, expect, it } from "vitest";
import { ContentHash } from "../src/value-objects/content-hash.js";

const VALID_HASH = "a".repeat(64);

describe("ContentHash", () => {
  it("accepts canonical lowercase SHA-256 hexadecimal content", () => {
    const hash = ContentHash.parse(VALID_HASH);

    expect(hash).toBe(VALID_HASH);
    expect(ContentHash.is(hash)).toBe(true);
    expect(ContentHash.equals(hash, ContentHash.parse(VALID_HASH))).toBe(true);
  });

  it.each(["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), ` ${VALID_HASH}`])(
    "rejects non-canonical SHA-256 content %j",
    (value) => {
      expect(() => ContentHash.parse(value)).toThrow();
      expect(ContentHash.is(value)).toBe(false);
    },
  );
});
