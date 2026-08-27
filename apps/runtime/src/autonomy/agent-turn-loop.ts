import {
  type AgentTurnInvocationResult,
  type AgentTurnProposal,
  ApplicationError,
  decideRetry,
  type LedgerProjection,
  type OperationContext,
} from "@v31m4/application";
import { AGENT_TURN_CONTRACT_VERSION, agentTurnSchema } from "@v31m4/contracts";
import type { TaskCapsule } from "@v31m4/domain";
import type {
  AgentLoopOutcome,
  AgentTurnContext,
  AgentTurnLoopDependencies,
  AgentTurnLoopRequest,
  AgentTurnRefusalCode,
} from "./agent-turn-contracts.js";
import {
  appendLoopFailure,
  describeFailure,
  firstIssue,
  isDeterministicRefusal,
  type LoopState,
  messageOf,
  NO_USAGE,
  record,
  recordRefusal,
  stopped,
} from "./agent-turn-recording.js";
import {
  assertSemanticOperationAllowedForRole,
  isSemanticOperationId,
  type SemanticOperationId,
} from "./semantic-operation-catalog.js";

export * from "./agent-turn-contracts.js";

/**
 * The governed iterative agent loop.
 *
 * ```text
 * authoritative context -> model turn -> runtime validation -> governed operation
 *        ^                                                            |
 *        +--------------- Ledger / evidence -> context rebuild --------+
 * ```
 *
 * The runtime owns every step. A model produces one structured proposal and nothing else: it holds
 * no tool, no shell, no sandbox, and no workspace authority, and there is no path from its answer
 * to the environment that does not pass through `authorize` and `runGovernedEffect` here. Its
 * answer is revalidated against the canonical contract even though the adapter already validated
 * it — adapter-side validation is a courtesy, never the authority.
 *
 * Context is rebuilt from durable state before every turn, from the authoritative Task Capsule and
 * the folded Execution Ledger. Conversation history is never carried forward, so a turn cannot
 * rest on something no longer true.
 *
 * `finish` ends the run as **ready for independent verification**. It is not success and it
 * transitions nothing: acceptance belongs to the verification phase, and a model never certifies
 * its own work.
 */

interface AuthoritativeState {
  readonly capsule: TaskCapsule;
  readonly projection: LedgerProjection;
}

export async function runAgentTurnLoop(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  context: OperationContext,
): Promise<AgentLoopOutcome> {
  assertBudget(request);
  const state: LoopState = {
    turns: [],
    toolCalls: 0,
    defers: 0,
    refused: 0,
    noProgress: 0,
    lastObservation: null,
  };

  for (let turnIndex = 0; ; turnIndex += 1) {
    if (state.turns.length >= request.budget.maxTurns) {
      return stopped(state, "TURN_BUDGET_EXHAUSTED", `after ${state.turns.length} turns`);
    }
    // Re-read before every turn. Not a cache, not the previous turn's copy: the capsule and the
    // ledger are the only things this run treats as true.
    const authoritative = await readAuthoritativeState(dependencies, request, context);
    const built = await dependencies.buildContext(
      {
        taskId: request.taskId,
        jobId: request.jobId,
        turnIndex,
        capsule: authoritative.capsule,
        projection: authoritative.projection,
        lastObservation: state.lastObservation,
      },
      context,
    );
    const oversize = contextOverBudget(built, request);
    if (oversize !== null) {
      // Fail closed. Trimming here would hand the model a different task than the one assembled.
      return stopped(state, "CONTEXT_BUDGET_EXCEEDED", oversize);
    }

    let answer: AgentTurnInvocationResult;
    try {
      answer = await dependencies.gateway.invokeAgentTurn(
        {
          invocationId: dependencies.generateInvocationId(turnIndex),
          jobId: request.jobId,
          taskId: request.taskId,
          modelId: request.modelId,
          promptArtifactId: built.promptArtifactId,
          outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
          allowedOperations: [...request.allowedOperations],
          reasoningPolicy: request.reasoningPolicy,
          contextBudget: {
            maxPromptBytes: request.budget.maxPromptBytes,
            maxPromptTokens: request.budget.maxPromptTokens,
          },
          resourceBudget: request.resourceBudget,
          metadata: { turnIndex, contextFingerprint: built.contextFingerprint },
        },
        context,
      );
    } catch (error) {
      // A deterministic refusal from the gateway or adapter is the model producing an unusable
      // turn — an out-of-manifest operation, a malformed shape, a reasoning trace — and it belongs
      // in this run's refusal budget, not as an exception that ends the run. Anything retryable is
      // infrastructure rather than model output, and propagates untouched.
      if (!isDeterministicRefusal(error)) throw error;
      const refused = await recordRefusal(
        dependencies,
        request,
        state,
        built,
        NO_USAGE,
        turnIndex,
        "ADAPTER_REJECTED_TURN",
        describeFailure(error),
        context,
      );
      if (refused !== null) return refused;
      continue;
    }

    const settled = await applyTurn(
      dependencies,
      request,
      state,
      authoritative,
      built,
      answer,
      turnIndex,
      context,
    );
    if (settled !== null) return settled;
  }
}

/** One turn, from untrusted answer to either a recorded outcome or the end of the run. */
async function applyTurn(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  state: LoopState,
  authoritative: AuthoritativeState,
  built: AgentTurnContext,
  answer: AgentTurnInvocationResult,
  turnIndex: number,
  context: OperationContext,
): Promise<AgentLoopOutcome | null> {
  const refuse = (code: AgentTurnRefusalCode, detail: string) =>
    recordRefusal(
      dependencies,
      request,
      state,
      built,
      answer.usage,
      turnIndex,
      code,
      detail,
      context,
    );

  if (answer.outputContractVersion !== AGENT_TURN_CONTRACT_VERSION) {
    return refuse(
      "OUTPUT_CONTRACT_MISMATCH",
      `the adapter answered with output contract ${answer.outputContractVersion}`,
    );
  }
  // Revalidated here regardless of what the adapter reported. This is the boundary that decides.
  const parsed = agentTurnSchema.safeParse(answer.turn);
  if (!parsed.success) {
    return refuse("MALFORMED_TURN", firstIssue(parsed.error));
  }
  const turn = parsed.data as AgentTurnProposal;

  if (turn.kind === "finish") {
    state.turns.push(
      record(turnIndex, built, answer.usage, "finish", null, true, null, turn.summary),
    );
    return Object.freeze({
      kind: "ready_for_verification" as const,
      summary: turn.summary,
      turns: Object.freeze([...state.turns]),
    });
  }

  if (turn.kind === "defer") {
    state.turns.push(
      record(turnIndex, built, answer.usage, "defer", null, true, null, turn.reason),
    );
    state.defers += 1;
    // A deferral is recorded so the next rebuilt context can see that this run already tried and
    // could not proceed; that is what stops the same dead end being re-entered silently.
    await appendLoopFailure(dependencies, request, `the model deferred: ${turn.reason}`, context);
    if (state.defers >= request.budget.maxDefers) {
      return Object.freeze({
        kind: "deferred" as const,
        reason: turn.reason,
        turns: Object.freeze([...state.turns]),
      });
    }
    return null;
  }

  return applyToolCall(
    dependencies,
    request,
    state,
    authoritative,
    built,
    answer,
    turn,
    turnIndex,
    refuse,
    context,
  );
}

async function applyToolCall(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  state: LoopState,
  authoritative: AuthoritativeState,
  built: AgentTurnContext,
  answer: AgentTurnInvocationResult,
  turn: Extract<AgentTurnProposal, { kind: "tool_call" }>,
  turnIndex: number,
  refuse: (code: AgentTurnRefusalCode, detail: string) => Promise<AgentLoopOutcome | null>,
  context: OperationContext,
): Promise<AgentLoopOutcome | null> {
  // The closed catalog, then this run's role manifest, then the operation's own allowed roles.
  // All three, in that order, before an authorization is even requested.
  if (!isSemanticOperationId(turn.operation)) {
    return refuse("UNKNOWN_OPERATION", `${turn.operation} is not in the operation catalog`);
  }
  const operation: SemanticOperationId = turn.operation;
  if (!request.allowedOperations.includes(operation)) {
    return refuse("OPERATION_NOT_ALLOWED", `${operation} is outside this run's role manifest`);
  }
  try {
    assertSemanticOperationAllowedForRole(operation, request.role);
  } catch {
    return refuse("OPERATION_NOT_ALLOWED", `${operation} is not permitted for ${request.role}`);
  }
  if (state.toolCalls >= request.budget.maxToolCalls) {
    return stopped(state, "TOOL_BUDGET_EXHAUSTED", `after ${state.toolCalls} governed operations`);
  }

  let plan: Awaited<ReturnType<typeof dependencies.surface.authorize>>;
  try {
    // `code.patch` additionally requires the current observed fingerprint of its target, which can
    // only come from a prior governed read. Supplying that from evidence belongs to the
    // evidence-conditioned-effects phase, so until then such a turn is refused here rather than
    // executed without its precondition.
    plan = await dependencies.surface.authorize(
      {
        operationId: operation,
        role: request.role,
        taskId: request.taskId,
        jobId: request.jobId,
        workspace: request.workspace,
        sandbox: request.sandbox,
        parameters: turn.parameters,
      },
      context,
    );
  } catch (error) {
    return refuse("AUTHORIZATION_REFUSED", messageOf(error));
  }

  // No-progress detection is read from recorded intent fingerprints, never from the transcript: an
  // intent whose earlier attempt is unresolved, indeterminate, failed, or already confirmed is
  // refused, so a model that keeps asking for the same thing cannot make the ledger repeat itself.
  const retry = decideRetry(
    authoritative.projection,
    dependencies.reconciler.intentFingerprintFor(plan),
  );
  if (!retry.allowed) {
    const outcome = await recordRefusal(
      dependencies,
      request,
      state,
      built,
      answer.usage,
      turnIndex,
      "NO_NEW_EVIDENCE",
      `${operation} repeats a recorded intent: ${retry.reason}`,
      context,
      operation,
      { countsAsRefusal: false },
    );
    if (outcome !== null) return outcome;
    state.noProgress += 1;
    return state.noProgress >= request.budget.maxNoProgressTurns
      ? stopped(state, "NO_PROGRESS", `${state.noProgress} turns produced no new evidence`)
      : null;
  }

  state.toolCalls += 1;
  const governed = await dependencies.reconciler.runGovernedEffect(
    { taskId: request.taskId, sandbox: request.sandbox, plan, probe: request.probe },
    context,
  );
  state.noProgress = 0;
  state.lastObservation = Object.freeze({
    operation,
    attemptEntryId: governed.attemptEntryId,
    outcomeEntryId: governed.outcomeEntryId,
    outcomeKind: governed.outcomeKind,
  });
  state.turns.push({
    ...record(
      turnIndex,
      built,
      answer.usage,
      "tool_call",
      operation,
      true,
      null,
      `${operation} executed`,
    ),
    attemptEntryId: governed.attemptEntryId,
    outcomeEntryId: governed.outcomeEntryId,
    outcomeKind: governed.outcomeKind,
  });
  return null;
}

async function readAuthoritativeState(
  dependencies: AgentTurnLoopDependencies,
  request: AgentTurnLoopRequest,
  context: OperationContext,
): Promise<AuthoritativeState> {
  const current = await dependencies.tasks.loadCurrent(request.taskId, context);
  if (current === null) {
    throw new ApplicationError(
      "NOT_FOUND",
      "An agent turn loop needs an existing task capsule to rebuild context from.",
      { details: { taskId: request.taskId } },
    );
  }
  return Object.freeze({
    capsule: current.capsule,
    projection: await dependencies.reconciler.projection(request.taskId, context),
  });
}

function contextOverBudget(built: AgentTurnContext, request: AgentTurnLoopRequest): string | null {
  if (built.promptBytes > request.budget.maxPromptBytes) {
    return `the assembled context is ${built.promptBytes} bytes against a ceiling of ${request.budget.maxPromptBytes}`;
  }
  if (built.promptTokens > request.budget.maxPromptTokens) {
    return `the assembled context is ${built.promptTokens} tokens against a budget of ${request.budget.maxPromptTokens}`;
  }
  return null;
}

function assertBudget(request: AgentTurnLoopRequest): void {
  const budget = request.budget;
  const positive = [
    budget.maxTurns,
    budget.maxToolCalls,
    budget.maxDefers,
    budget.maxRefusedTurns,
    budget.maxNoProgressTurns,
    budget.maxPromptBytes,
    budget.maxPromptTokens,
  ];
  if (!positive.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "Every agent-turn budget must be a positive integer; an unbounded loop is not a budget.",
      { details: { ...budget } },
    );
  }
  if (request.allowedOperations.length === 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "An agent turn loop needs at least one permitted semantic operation.",
      {},
    );
  }
}
