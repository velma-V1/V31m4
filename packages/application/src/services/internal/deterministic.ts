/**
 * Deterministic, dependency-free helpers shared by application services.
 *
 * These utilities never read a clock, never call `Math.random`, and never touch
 * infrastructure. They exist so that services can produce stable fingerprints and
 * seeded pseudo-random orderings that are identical for identical inputs.
 */

/**
 * Produces a stable 16-character hexadecimal fingerprint of a string using two
 * independently salted FNV-1a passes. This is a deterministic content fingerprint,
 * not a cryptographic hash; it is used to detect whether two compiled contexts are
 * byte-for-byte identical.
 */
export function stableFingerprint(input: string): string {
  const low = fnv1a(input, 0x811c9dc5);
  const high = fnv1a(input, 0x811c_9dc5 ^ 0x5bd1_e995);
  return low.toString(16).padStart(8, "0") + high.toString(16).padStart(8, "0");
}

function fnv1a(input: string, offset: number): number {
  let hash = offset >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Serializes a JSON-like value into a canonical string with object keys sorted at
 * every depth, so that semantically equal values always serialize identically.
 */
export function canonicalStringify(value: CanonicalValue): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: CanonicalValue };
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key] as CanonicalValue)}`,
  );
  return `{${entries.join(",")}}`;
}

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Creates a deterministic pseudo-random generator (mulberry32) from an unsigned
 * 32-bit seed. Identical seeds always yield identical sequences.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Returns a new array ordered by a stable, deterministic key function. Ties are
 * broken by the original index so the sort is total and reproducible.
 */
export function stableSortBy<T>(items: readonly T[], key: (item: T) => number | string): T[] {
  return items
    .map((item, index) => ({ item, index, sortKey: key(item) }))
    .sort((left, right) => {
      if (left.sortKey < right.sortKey) {
        return -1;
      }
      if (left.sortKey > right.sortKey) {
        return 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}
