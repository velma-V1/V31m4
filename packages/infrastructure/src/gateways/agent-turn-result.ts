import {
  type AgentTurnInvocationRequest,
  type AgentTurnInvocationResult,
  type AgentTurnProposal,
  ApplicationError,
  type ApplicationJsonObject,
} from "@v31m4/application";
import { containsPrivateReasoningKey, type ModelId } from "@v31m4/domain";

/**
 * Provider-neutral validation of one structured agent turn returned by a supervised adapter.
 *
 * Infrastructure may not import `@v31m4/contracts`, so this is a hand-written strict parser rather
 * than a schema reuse — the same shape the discovery parser in this directory already takes. It is
 * also not a duplicate authority: the runtime revalidates every turn against the canonical
 * contract afterwards. What this boundary owes is narrower and specific to the transport: an
 * adapter's answer must be about the request it answers, must be exactly one well-formed turn,
 * must stay inside the role manifest the runtime offered, and must carry no reasoning trace.
 *
 * Everything ambiguous fails closed as a dependency failure. A gateway that repaired a malformed
 * answer would be inventing model output.
 */
const MAX_TEXT = 2_000;
const MAX_OPERATION = 64;
const OPERATION_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

function fail(reason: string, details: Record<string, string> = {}): never {
  throw new ApplicationError("DEPENDENCY_FAILURE", `The agent turn is invalid: ${reason}`, {
    details,
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} carries an unexpected field.`, { field: key });
  }
}

function boundedText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT ||
    value !== value.trim()
  ) {
    fail(`${label} must be trimmed, non-empty text of at most ${MAX_TEXT} characters.`);
  }
  return value as string;
}

function count(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} must be a count.`);
  return value as number;
}

function parseTurn(value: unknown, allowedOperations: readonly string[]): AgentTurnProposal {
  const turn = record(value, "A turn");
  switch (turn["kind"]) {
    case "tool_call": {
      exactKeys(turn, ["kind", "operation", "parameters"], "A tool_call turn");
      const operation = turn["operation"];
      if (
        typeof operation !== "string" ||
        operation.length > MAX_OPERATION ||
        !OPERATION_PATTERN.test(operation)
      ) {
        fail("A tool_call must name a semantic operation.");
      }
      // The role manifest the runtime offered is the outer bound. An adapter that returns an
      // operation outside it has either mistranslated the request or is answering a different
      // one; either way this must not become a governed effect.
      if (!allowedOperations.includes(operation as string)) {
        fail("A tool_call named an operation outside the role manifest.", {
          operation: operation as string,
        });
      }
      const parameters = record(turn["parameters"], "Tool call parameters");
      return Object.freeze({
        kind: "tool_call" as const,
        operation: operation as string,
        parameters: parameters as ApplicationJsonObject,
      });
    }
    case "finish":
      exactKeys(turn, ["kind", "summary"], "A finish turn");
      return Object.freeze({
        kind: "finish" as const,
        summary: boundedText(turn["summary"], "A finish summary"),
      });
    case "defer":
      exactKeys(turn, ["kind", "reason"], "A defer turn");
      return Object.freeze({
        kind: "defer" as const,
        reason: boundedText(turn["reason"], "A defer reason"),
      });
    default:
      return fail("A turn must be a tool_call, a finish, or a defer.");
  }
}

export function parseAgentTurnResult(
  value: unknown,
  request: AgentTurnInvocationRequest,
): AgentTurnInvocationResult {
  // Before any field is read: a reasoning trace anywhere in the answer is a refusal, not a value
  // to drop. Dropping it silently would let an adapter keep sending one unnoticed.
  if (containsPrivateReasoningKey(value)) {
    fail("An adapter answer must never carry a private reasoning trace.");
  }
  const result = record(value, "An agent invocation result");
  exactKeys(
    result,
    ["invocationId", "modelId", "outputContractVersion", "turn", "usage", "metadata"],
    "An agent invocation result",
  );
  if (result["invocationId"] !== request.invocationId) {
    fail("The answer names a different invocation than the request.");
  }
  if (result["modelId"] !== request.modelId) {
    fail("The answer names a different model than the request.");
  }
  if (result["outputContractVersion"] !== request.outputContractVersion) {
    fail("The answer declares a different agent-turn output contract than the request.", {
      expected: request.outputContractVersion,
      declared: String(result["outputContractVersion"]),
    });
  }
  const usage = record(result["usage"], "Usage");
  exactKeys(usage, ["inputTokens", "outputTokens", "wallClockMs"], "Usage");
  const wallClockMs = count(usage["wallClockMs"], "Wall clock");
  if (wallClockMs === undefined) fail("Usage must report wall-clock time.");
  const inputTokens = count(usage["inputTokens"], "Input tokens");
  const outputTokens = count(usage["outputTokens"], "Output tokens");
  return Object.freeze({
    invocationId: request.invocationId,
    modelId: request.modelId as ModelId,
    outputContractVersion: request.outputContractVersion,
    turn: parseTurn(result["turn"], request.allowedOperations),
    usage: Object.freeze({
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      wallClockMs,
    }),
    metadata: record(result["metadata"], "Metadata") as ApplicationJsonObject,
  });
}
