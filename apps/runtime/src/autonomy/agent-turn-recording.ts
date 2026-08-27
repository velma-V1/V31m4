import {
  appendExecutionLedgerEntry,
  isApplicationError,
  type ModelInvocationUsage,
  type OperationContext,
} from "@v31m4/application";
import { ExecutionLedgerEntry } from "@v31m4/domain";
import type {
  AgentLoopOutcome,
  AgentLoopStopCode,
  AgentObservation,
  AgentTurnContext,
  AgentTurnLoopDependencies,
  AgentTurnLoopRequest,
  AgentTurnRecord,
  AgentTurnRefusalCode,
} from "./agent-turn-contracts.js";
import type { SemanticOperationId } from "./semantic-operation-catalog.js";

/**
 * What a run remembers and how it writes it down.
 *
 * Split from `agent-turn-loop.ts` so the loop itself stays within the frozen source-size rule, and
 * along a real seam: everything here is bookkeeping — the running counters, the transcript entry
 * for one turn, and the durable `failure` entry a refusal leaves behind. Nothing here decides
 * whether a turn is acceptable and nothing here executes.
 */

export interface LoopState {
  readonly turns: AgentTurnRecord[];
  toolCalls: number;
  defers: number;
  refused: number;
  noProgress: number;
  lastObservation: AgentObservation | null;
}

export const MAX_DETAIL = 2_000;

/** A turn the adapter refused never reached a model round trip this loop can account for. */
export const NO_USAGE: ModelInvocationUsage = Object.freeze({ wallClockMs: 0 });

/**
 * Records a refused turn in the run transcript and in durable history.
 *
 * The Ledger entry matters as much as the refusal: it is a `failure` naming no attempt, so it adds
 * ordinary history without touching any attempt's outcome state machine, and the next rebuilt
 * context sees that this proposal was already refused. That is what turns a cycle into something
 * the next turn can react to instead of repeating.
 */
export async function recordRefusal(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  state: LoopState,
  built: AgentTurnContext,
  usage: ModelInvocationUsage,
  turnIndex: number,
  code: AgentTurnRefusalCode,
  detail: string,
  context: OperationContext,
  operation: SemanticOperationId | null = null,
  options: { readonly countsAsRefusal?: boolean } = {},
): Promise<AgentLoopOutcome | null> {
  // A refusal about an operation is still a tool_call turn; everything else is a turn the runtime
  // could not read as one of the three kinds at all.
  const kind =
    code === "NO_NEW_EVIDENCE" || code === "OPERATION_NOT_ALLOWED" || code === "UNKNOWN_OPERATION"
      ? "tool_call"
      : "malformed";
  state.turns.push(record(turnIndex, built, usage, kind, operation, false, code, detail));
  await appendLoopFailure(dependencies, request, `${code}: ${detail}`, context);
  if (options.countsAsRefusal === false) return null;
  state.refused += 1;
  return state.refused >= request.budget.maxRefusedTurns
    ? stopped(state, "REFUSED_TURN_BUDGET_EXHAUSTED", `${state.refused} turns were refused`)
    : null;
}

export async function appendLoopFailure(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  reason: string,
  context: OperationContext,
): Promise<void> {
  const bounded = clamp(reason);
  await appendExecutionLedgerEntry(
    { unitOfWork: dependencies.unitOfWork, ledger: dependencies.ledger },
    ExecutionLedgerEntry.create({
      id: dependencies.generateEntryId(),
      taskId: request.taskId,
      jobId: request.jobId,
      recordedAt: dependencies.now(),
      kind: "failure",
      attemptEntryId: null,
      reason: bounded,
      detail: bounded,
    }),
    context,
  );
}

export function record(
  index: number,
  built: AgentTurnContext,
  usage: ModelInvocationUsage,
  kind: AgentTurnRecord["kind"],
  operation: SemanticOperationId | null,
  accepted: boolean,
  refusal: AgentTurnRefusalCode | null,
  detail: string,
): AgentTurnRecord {
  return Object.freeze({
    index,
    contextFingerprint: built.contextFingerprint,
    kind,
    operation,
    accepted,
    refusal,
    detail: clamp(detail),
    attemptEntryId: null,
    outcomeEntryId: null,
    outcomeKind: null,
    usage,
  });
}

export function stopped(
  state: LoopState,
  code: AgentLoopStopCode,
  detail: string,
): AgentLoopOutcome {
  return Object.freeze({
    kind: "stopped" as const,
    code,
    detail,
    turns: Object.freeze([...state.turns]),
  });
}

export function firstIssue(error: {
  readonly issues: readonly { readonly message: string }[];
}): string {
  return error.issues[0]?.message ?? "the turn did not match the agent-turn contract";
}

/**
 * Whether a failure is the adapter deterministically refusing this answer, rather than
 * infrastructure failing. The gateway marks a transport or provider failure retryable and its own
 * strict validation non-retryable, which is exactly the line that matters here.
 */
export function isDeterministicRefusal(error: unknown): boolean {
  return isApplicationError(error) && error.code === "DEPENDENCY_FAILURE" && !error.retryable;
}

/** The failure and the underlying reason the gateway wrapped, which is where the detail lives. */
export function describeFailure(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;
  return causeMessage === undefined ? messageOf(error) : `${messageOf(error)} (${causeMessage})`;
}

export function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the authorization boundary refused the operation";
}

/** Keeps every recorded string inside the Execution Ledger's own text limit. */
export function clamp(value: string): string {
  const trimmed = value.trim();
  const bounded = trimmed.length === 0 ? "no detail was reported" : trimmed;
  return bounded.length > MAX_DETAIL ? bounded.slice(0, MAX_DETAIL) : bounded;
}
