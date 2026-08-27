/**
 * The property names that carry a model's private reasoning.
 *
 * A frozen system invariant rather than a wire detail: chain-of-thought is never evidence, never
 * memory, and never persisted, so every boundary that accepts model output — contract parsing,
 * the model gateway, the local adapter, and the runtime agent loop — must refuse the same set.
 * Defining it once here is what keeps those boundaries from drifting apart and leaving a gap.
 *
 * A match is a rejection, never a silent strip. Quietly dropping the field would hide the fact
 * that a model tried to hand back reasoning and would leave the caller believing its guard held.
 *
 * Published as a frozen array rather than a `Set`: `Object.freeze` does not close a `Set`, so an
 * exported frozen `Set` still accepts `add` and this list could be edited at runtime by any
 * caller that imported it. Membership is answered by `isPrivateReasoningKey` over a
 * module-private index.
 */
export const PRIVATE_REASONING_KEYS: readonly string[] = Object.freeze([
  "reasoning",
  "reasoning_content",
  "reasoningContent",
  "thinking",
  "thought",
  "thoughts",
  "chain_of_thought",
  "chainOfThought",
  "scratchpad",
  "inner_monologue",
  "innerMonologue",
  "deliberation",
]);

const INDEX: ReadonlySet<string> = new Set(PRIVATE_REASONING_KEYS);

/** Whether one property name carries private reasoning. */
export function isPrivateReasoningKey(key: string): boolean {
  return INDEX.has(key);
}

function scan(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value !== "object") return false;
  // A cycle cannot introduce a name that is not already reachable, and revisiting would not
  // terminate. External JSON is acyclic anyway; this keeps the function total for in-memory input.
  if (active.has(value)) return false;
  active.add(value);
  try {
    if (Array.isArray(value)) return value.some((item) => scan(item, active));
    for (const key of Object.keys(value)) {
      if (INDEX.has(key)) return true;
      if (scan((value as Record<string, unknown>)[key], active)) return true;
    }
    return false;
  } finally {
    active.delete(value);
  }
}

/**
 * Whether a private-reasoning property name appears anywhere in a value, at any depth.
 *
 * Depth matters: a model-supplied parameter bag is fingerprinted and written into the Execution
 * Ledger, so reasoning smuggled inside one would become durable authoritative history.
 */
export function containsPrivateReasoningKey(value: unknown): boolean {
  return scan(value, new Set());
}
