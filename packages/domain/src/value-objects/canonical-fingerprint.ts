import { ContentHash } from "./content-hash.js";

/**
 * Deterministic content fingerprints for durable domain state.
 *
 * A `ContentHash` is a real SHA-256 digest, so this module implements SHA-256 in plain
 * ECMAScript. The domain layer may not import Node APIs, and a fingerprint that gates state
 * transitions must not be a short non-cryptographic hash dressed up as a content hash — a
 * collision there would let two different capsules claim the same identity. The application
 * layer's private FNV `stableFingerprint` is a different tool for a different job (comparing
 * compiled contexts) and is unreachable from here anyway, since domain imports nothing.
 *
 * Everything below is pure: no clock, no randomness, no I/O.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

/**
 * Serializes a JSON-like value with object keys sorted at every depth, so semantically equal
 * values always serialize identically regardless of construction or persistence key order.
 * `undefined` members are omitted, matching what `JSON.stringify` persists.
 */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical serialization requires finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: CanonicalValue | undefined };
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as CanonicalValue)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 of the canonical serialization, as a validated `ContentHash`. */
export function canonicalFingerprint(value: CanonicalValue): ContentHash {
  return ContentHash.parse(sha256Hex(canonicalJson(value)));
}

const ROUND_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** UTF-8 encodes a string without depending on `TextEncoder`, which is a host global. */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** SHA-256 (FIPS 180-4) over the UTF-8 encoding of `input`, returned as lowercase hex. */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  // 64-bit big-endian length; the high word is derived by division to stay exact past 2^32 bits.
  const highLength = Math.floor(bitLength / 0x1_0000_0000);
  const lowLength = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((highLength >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((lowLength >>> shift) & 0xff);

  const state = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      schedule[index] =
        (((bytes[at] as number) << 24) |
          ((bytes[at + 1] as number) << 16) |
          ((bytes[at + 2] as number) << 8) |
          (bytes[at + 3] as number)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = schedule[index - 15] as number;
      const recent = schedule[index - 2] as number;
      const s0 = (rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3)) >>> 0;
      const s1 = (rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10)) >>> 0;
      schedule[index] =
        ((schedule[index - 16] as number) + s0 + (schedule[index - 7] as number) + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 =
        (h + sigma1 + choose + (ROUND_CONSTANTS[index] as number) + (schedule[index] as number)) >>>
        0;
      const sigma0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    const round = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index += 1) {
      state[index] = ((state[index] as number) + (round[index] as number)) >>> 0;
    }
  }

  let digest = "";
  for (const word of state) {
    digest += word.toString(16).padStart(8, "0");
  }
  return digest;
}
