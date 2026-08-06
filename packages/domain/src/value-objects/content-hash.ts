import { assertDomain } from "../domain-errors.js";
import type { Brand } from "./ids.js";

export type ContentHash = Brand<string, "Sha256ContentHash">;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const ContentHash = Object.freeze({
  parse(value: string): ContentHash {
    assertDomain(
      typeof value === "string" && SHA256_PATTERN.test(value),
      "INVALID_CONTENT_HASH",
      "Content hash must be exactly 64 lowercase hexadecimal characters.",
      { value },
    );
    return value as ContentHash;
  },

  is(value: unknown): value is ContentHash {
    return typeof value === "string" && SHA256_PATTERN.test(value);
  },

  equals(left: ContentHash, right: ContentHash): boolean {
    return left === right;
  },
});
