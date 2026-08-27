/**
 * The provider-neutral structured agent-turn protocol, as this adapter speaks it.
 *
 * Adapters are deliberately dependency-free ES modules launched as supervised child processes, so
 * they cannot import `@v31m4/domain` or `@v31m4/contracts`. The reasoning-key list below is
 * therefore a copy of the one frozen in the domain, and a test asserts the two are identical so
 * they cannot drift apart unnoticed.
 *
 * Nothing here decides anything: a turn that parses is still an untrusted proposal, and the
 * runtime revalidates it against the canonical contract before it can reach the environment.
 */

export const AGENT_TURN_CONTRACT_VERSION = "1.0.0";

/** Mirrors `PRIVATE_REASONING_KEYS` in `@v31m4/domain`; parity is asserted by test. */
export const PRIVATE_REASONING_KEYS = Object.freeze([
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

const REASONING_INDEX = new Set(PRIVATE_REASONING_KEYS);
const OPERATION_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const MAX_TEXT = 2_000;
const MAX_OPERATIONS = 64;

export function containsPrivateReasoningKey(value, active = new Set()) {
  if (value === null || typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some((item) => containsPrivateReasoningKey(item, active));
    }
    for (const key of Object.keys(value)) {
      if (REASONING_INDEX.has(key)) return true;
      if (containsPrivateReasoningKey(value[key], active)) return true;
    }
    return false;
  } finally {
    active.delete(value);
  }
}

/**
 * The structured-output schema handed to the provider.
 *
 * Deliberately flat rather than a per-kind `oneOf`: constrained-decoding grammars handle a flat
 * object far more reliably, and correctness does not rest on the grammar anyway — `parseAgentTurn`
 * below accepts only the fields the declared kind owns and refuses anything else.
 */
export function agentTurnResponseSchema() {
  return {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["tool_call", "finish", "defer"] },
      operation: { type: "string" },
      parameters: { type: "object" },
      summary: { type: "string" },
      reason: { type: "string" },
    },
  };
}

/** The instruction block. It never asks for reasoning, and never offers an unlisted operation. */
export function agentInstructions(prompt, allowedOperations) {
  return [
    "Return only JSON matching the supplied schema. Emit exactly one turn and no prose.",
    'Use {"kind":"tool_call","operation":<one allowed operation>,"parameters":{...}} to act.',
    'Use {"kind":"finish","summary":"..."} only to declare the task ready for independent verification; it does not claim success.',
    'Use {"kind":"defer","reason":"..."} when the available evidence does not let you proceed.',
    `The only permitted operations are: ${allowedOperations.join(", ")}.`,
    "Do not include any explanation, analysis, or reasoning field; it will be rejected.",
    prompt,
  ].join("\n\n");
}

/**
 * Translates the provider-neutral reasoning policy into this provider's flag.
 *
 * `disabled` and `enabled` are explicit. `auto` sends no flag at all: the runtime has declined to
 * decide, and inventing a default here would be an assumption about `think` semantics that the
 * architecture says must be measured rather than presumed. `enabled` against a model that does not
 * report the capability is a refusal, because silently running without reasoning would report a
 * mode that never happened.
 */
export function reasoningOptions(policy, capabilities) {
  switch (policy) {
    case "disabled":
      return { think: false };
    case "enabled":
      if (!capabilities.includes("thinking")) {
        throw new Error("The requested model does not report a reasoning capability.");
      }
      return { think: true };
    case "auto":
      return {};
    default:
      throw new Error("Reasoning policy must be disabled, enabled, or auto.");
  }
}

function boundedText(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT ||
    value !== value.trim()
  ) {
    throw new Error(`Agent turn ${label} must be trimmed, non-empty, bounded text.`);
  }
  return value;
}

function exactKeys(turn, allowed) {
  for (const key of Object.keys(turn)) {
    if (!allowed.includes(key)) {
      throw new Error(`Agent turn is malformed: unexpected field ${JSON.stringify(key)}.`);
    }
  }
}

/** Accepts exactly one well-formed turn, inside the manifest, with no reasoning anywhere. */
export function parseAgentTurn(structured, allowedOperations) {
  if (containsPrivateReasoningKey(structured)) {
    throw new Error("An agent turn must not carry private reasoning.");
  }
  if (structured === null || typeof structured !== "object" || Array.isArray(structured)) {
    throw new Error("Agent turn is malformed: a turn must be a JSON object.");
  }
  switch (structured.kind) {
    case "tool_call": {
      exactKeys(structured, ["kind", "operation", "parameters"]);
      const operation = structured.operation;
      if (typeof operation !== "string" || !OPERATION_PATTERN.test(operation)) {
        throw new Error("Agent turn is malformed: a tool_call must name a semantic operation.");
      }
      if (!allowedOperations.includes(operation)) {
        throw new Error("Agent turn named an operation outside the permitted manifest.");
      }
      const parameters = structured.parameters;
      if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw new Error("Agent turn is malformed: tool_call parameters must be a JSON object.");
      }
      return { kind: "tool_call", operation, parameters };
    }
    case "finish":
      exactKeys(structured, ["kind", "summary"]);
      return { kind: "finish", summary: boundedText(structured.summary, "summary") };
    case "defer":
      exactKeys(structured, ["kind", "reason"]);
      return { kind: "defer", reason: boundedText(structured.reason, "reason") };
    default:
      throw new Error("Agent turn is malformed: kind must be tool_call, finish, or defer.");
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

/** Strict adapter-side validation of the 1.1 agent invocation parameters. */
export function requireAgentInvocation(params) {
  if (params.outputContractVersion !== AGENT_TURN_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported agent-turn output contract ${JSON.stringify(params.outputContractVersion)}.`,
    );
  }
  const operations = params.allowedOperations;
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > MAX_OPERATIONS ||
    new Set(operations).size !== operations.length ||
    !operations.every((entry) => typeof entry === "string" && OPERATION_PATTERN.test(entry))
  ) {
    throw new Error("Allowed operations must be a bounded, unique list of semantic operation IDs.");
  }
  const contextBudget = params.contextBudget;
  if (contextBudget === null || typeof contextBudget !== "object" || Array.isArray(contextBudget)) {
    throw new Error("An agent invocation requires an explicit context budget.");
  }
  return {
    allowedOperations: Object.freeze([...operations]),
    maxPromptBytes: positiveInteger(contextBudget.maxPromptBytes, "maxPromptBytes"),
    maxPromptTokens: positiveInteger(contextBudget.maxPromptTokens, "maxPromptTokens"),
    reasoningPolicy: params.reasoningPolicy,
  };
}
