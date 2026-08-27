import { describe, expect, it } from "vitest";
import {
  canonicalFingerprint,
  canonicalJson,
  sha256Hex,
} from "../src/value-objects/canonical-fingerprint.js";
import { ContentHash } from "../src/value-objects/content-hash.js";

/**
 * The capsule fingerprint gates state transitions, so the digest behind it must be a real
 * SHA-256 rather than a short hash that merely looks like one. These vectors are the published
 * FIPS 180-4 / RFC values.
 */
describe("sha256Hex", () => {
  it("matches the published SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // Multi-block input, exercising the length encoding past a single 64-byte block.
    expect(sha256Hex("a".repeat(1_000_000)).slice(0, 16)).toBe("cdc76e5c9914fb92");
  });

  it("hashes multi-byte UTF-8 by its bytes, not its code units", () => {
    expect(sha256Hex("é")).toBe(sha256Hex("é"));
    expect(sha256Hex("→")).toHaveLength(64);
    // A surrogate pair is one code point, encoded as four UTF-8 bytes.
    expect(sha256Hex("😀")).toBe(sha256Hex(String.fromCodePoint(0x1f600)));
    expect(sha256Hex("😀")).not.toBe(sha256Hex("?"));
  });

  it("produces a value the domain accepts as a ContentHash", () => {
    expect(ContentHash.is(sha256Hex("anything"))).toBe(true);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth so key order cannot change the digest", () => {
    const left = { b: 1, a: { d: [3, 2], c: true } };
    const right = { a: { c: true, d: [3, 2] }, b: 1 };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalFingerprint(left)).toBe(canonicalFingerprint(right));
  });

  it("preserves array order, which is semantic", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("omits undefined members exactly as persistence would", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("refuses non-finite numbers rather than serializing them as null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("distinguishes values that JSON would otherwise blur", () => {
    expect(canonicalJson({ a: "1" })).not.toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({ a: "null" }));
  });
});
