import type {
  AgentModelGatewayPort,
  AgentReasoningPolicy,
  AgentTurnProposal,
  ExecutionLedgerRepositoryPort,
  LedgerProjection,
  ModelInvocationUsage,
  OperationContext,
  SandboxHandle,
  UnitOfWorkPort,
  WorkspaceHandle,
} from "@v31m4/application";
import type {
  ArtifactId,
  ContentHash,
  JobId,
  ModelId,
  ResourceBudget,
  TaskCapsule,
  TaskId,
} from "@v31m4/domain";
import type { EffectReconciler, GovernedExecutionSurface } from "./effect-reconciler.js";
import type { EffectOutcomeKind, EffectPostStateProbe } from "./effect-reconciler-contracts.js";
import type { SemanticOperationId, SemanticOperationRole } from "./semantic-operation-catalog.js";
import type { TaskManager } from "./task-manager.js";

/**
 * The contracts of the governed agent-turn loop.
 *
 * Split from `agent-turn-loop.ts` so the loop itself stays within the frozen source-size rule and
 * so the shapes a caller must satisfy are legible on their own. Everything here describes what the
 * runtime asks of a model and what it will say afterwards; nothing here executes.
 */

/**
 * Every bound one loop run operates under.
 *
 * All seven are hard ceilings, and none of them is negotiable by the model. `maxPromptBytes` and
 * `maxPromptTokens` answer different questions — what the transport can carry and what the model
 * can attend to — and exceeding either ends the run rather than shortening the context, because a
 * truncated context silently changes the task the model was given.
 */
export interface AgentTurnBudget {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  /** How many times the model may say it cannot proceed before the run ends. */
  readonly maxDefers: number;
  /** Malformed, unknown, disallowed, or unauthorizable turns tolerated before the run ends. */
  readonly maxRefusedTurns: number;
  /** Repeats of an already-recorded intent tolerated before the run ends as a cycle. */
  readonly maxNoProgressTurns: number;
  readonly maxPromptBytes: number;
  readonly maxPromptTokens: number;
}

/** One assembled context, measured. The loop never inspects its content. */
export interface AgentTurnContext {
  readonly promptArtifactId: ArtifactId;
  readonly promptBytes: number;
  readonly promptTokens: number;
  /** Identifies the authoritative state this context was built from. Persisted with the turn. */
  readonly contextFingerprint: ContentHash;
}

/**
 * What a context source is given: the authoritative capsule and the folded Execution Ledger, both
 * re-read immediately before this turn, plus what the previous governed operation observed.
 * Conversation history is deliberately absent — it is never authoritative state.
 */
export interface AgentContextRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly turnIndex: number;
  readonly capsule: TaskCapsule;
  readonly projection: LedgerProjection;
  readonly lastObservation: AgentObservation | null;
}

export type AgentContextSource = (
  request: AgentContextRequest,
  context: OperationContext,
) => Promise<AgentTurnContext>;

/** What the previous governed operation established, as durable history recorded it. */
export interface AgentObservation {
  readonly operation: SemanticOperationId;
  readonly attemptEntryId: string;
  readonly outcomeEntryId: string;
  readonly outcomeKind: EffectOutcomeKind;
}

/** Why the runtime refused a turn. Every one of these happens before anything is executed. */
export type AgentTurnRefusalCode =
  | "MALFORMED_TURN"
  /** The adapter itself deterministically refused the model's answer before the runtime saw it. */
  | "ADAPTER_REJECTED_TURN"
  | "OUTPUT_CONTRACT_MISMATCH"
  | "UNKNOWN_OPERATION"
  | "OPERATION_NOT_ALLOWED"
  | "AUTHORIZATION_REFUSED"
  | "NO_NEW_EVIDENCE";

export type AgentLoopStopCode =
  | "TURN_BUDGET_EXHAUSTED"
  | "TOOL_BUDGET_EXHAUSTED"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "REFUSED_TURN_BUDGET_EXHAUSTED"
  | "NO_PROGRESS";

/**
 * One turn as the runtime will persist it: the structured proposal, what the runtime decided, what
 * the governed operation observed, the usage, and the fingerprint of the context it answered.
 *
 * There is no field for reasoning, and none for raw model text. That is the whole persistence
 * contract for a turn.
 */
export interface AgentTurnRecord {
  readonly index: number;
  readonly contextFingerprint: ContentHash;
  readonly kind: AgentTurnProposal["kind"] | "malformed";
  readonly operation: SemanticOperationId | null;
  readonly accepted: boolean;
  readonly refusal: AgentTurnRefusalCode | null;
  readonly detail: string;
  readonly attemptEntryId: string | null;
  readonly outcomeEntryId: string | null;
  readonly outcomeKind: EffectOutcomeKind | null;
  readonly usage: ModelInvocationUsage;
}

/**
 * How a run ended.
 *
 * `ready_for_verification` is the strongest thing a model can produce and it is not success: it
 * says the bounded task is ready for independent verification. There is deliberately no
 * `succeeded`, no `accepted`, and no score — a model never certifies its own work.
 */
export type AgentLoopOutcome =
  | Readonly<{
      kind: "ready_for_verification";
      summary: string;
      turns: readonly AgentTurnRecord[];
    }>
  | Readonly<{ kind: "deferred"; reason: string; turns: readonly AgentTurnRecord[] }>
  | Readonly<{
      kind: "stopped";
      code: AgentLoopStopCode;
      detail: string;
      turns: readonly AgentTurnRecord[];
    }>;

export interface AgentTurnLoopDependencies {
  /** Provider-neutral. The loop never learns which provider is behind it. */
  readonly gateway: AgentModelGatewayPort;
  readonly surface: GovernedExecutionSurface;
  readonly reconciler: EffectReconciler;
  readonly tasks: TaskManager;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly unitOfWork: UnitOfWorkPort;
  readonly buildContext: AgentContextSource;
  /**
   * What the assigned workspace and its observed resources currently fingerprint to.
   *
   * The evidence precondition can only tell a current fact from a stale one against something, and
   * a model may not be that something. This is the caller's observation of reality — the sibling of
   * `probe`, which proves what an effect did — and it is required rather than optional because a
   * missing observation is read as "nothing is current", which denies every gated effect.
   */
  readonly observeResources: (
    taskId: TaskId,
    workspace: WorkspaceHandle,
    context: OperationContext,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly generateEntryId: () => string;
  readonly generateInvocationId: (turnIndex: number) => string;
  readonly now: () => string;
}

export interface AgentTurnLoopRequest {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly modelId: ModelId;
  readonly role: SemanticOperationRole;
  /** The role manifest for this run. The model may be offered nothing outside it. */
  readonly allowedOperations: readonly SemanticOperationId[];
  readonly reasoningPolicy: AgentReasoningPolicy;
  readonly budget: AgentTurnBudget;
  readonly resourceBudget: ResourceBudget;
  readonly workspace: WorkspaceHandle;
  readonly sandbox: SandboxHandle;
  /** How this caller proves whether its own effect landed. Supplied per run, never by a model. */
  readonly probe: EffectPostStateProbe;
}
