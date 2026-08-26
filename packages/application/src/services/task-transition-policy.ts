import { isCanonicalDurableId, type TaskCapsule, type TaskPhase } from "@v31m4/domain";

/**
 * Deterministic checked transitions for the Task Capsule.
 *
 * The model may *propose* a move. This service decides whether it is legal, using only
 * machine-checkable predicates over the current capsule and the proposal: identity, the logical
 * capsule revision, the declared origin phase, the phase graph, evidence requirements, attempt
 * budget, and a bounded reason. No model output is trusted as proof that an invariant held, and
 * nothing here reads a clock, consults randomness, or performs I/O.
 *
 * The expected *store* head revision is deliberately not checked here — that is optimistic
 * concurrency owned by persistence, enforced as a write condition when the revision is appended.
 * Conflating the two is exactly the mistake this design forbids.
 */
export interface TaskTransitionProposal {
  readonly taskId: string;
  /** The store revision of the head the proposer read. Enforced at write time, not here. */
  readonly expectedHeadRevision: string;
  /** The capsule's own logical revision the proposer read. */
  readonly expectedCapsuleRevision: number;
  readonly from: TaskPhase;
  readonly to: TaskPhase;
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export type TaskTransitionRefusalCode =
  | "TASK_MISMATCH"
  | "STALE_CAPSULE_REVISION"
  | "PHASE_MISMATCH"
  | "ILLEGAL_TRANSITION"
  | "MISSING_EVIDENCE"
  | "INVALID_EVIDENCE"
  | "ATTEMPTS_EXHAUSTED"
  | "INVALID_REASON";

export type TaskTransitionDecision =
  | Readonly<{ allowed: true; to: TaskPhase; attemptCost: number }>
  | Readonly<{
      allowed: false;
      code: TaskTransitionRefusalCode;
      reasons: readonly string[];
    }>;

/** The legal phase graph. `complete` is terminal; anything active may become `blocked`. */
const TRANSITIONS: Readonly<Record<TaskPhase, readonly TaskPhase[]>> = Object.freeze({
  investigate: Object.freeze<TaskPhase[]>(["plan", "blocked"]),
  plan: Object.freeze<TaskPhase[]>(["execute", "investigate", "blocked"]),
  execute: Object.freeze<TaskPhase[]>(["verify", "repair", "blocked"]),
  verify: Object.freeze<TaskPhase[]>(["complete", "repair", "blocked"]),
  repair: Object.freeze<TaskPhase[]>(["verify", "execute", "blocked"]),
  blocked: Object.freeze<TaskPhase[]>(["investigate", "plan", "execute", "verify", "repair"]),
  complete: Object.freeze<TaskPhase[]>([]),
});

/**
 * Phases whose entry must be justified by evidence. Completing a task and deciding to repair one
 * are both claims about observed reality, so neither may rest on assertion alone.
 */
const REQUIRES_EVIDENCE: ReadonlySet<TaskPhase> = new Set<TaskPhase>(["complete", "repair"]);

/** Phases whose entry consumes an attempt from the task's budget. */
const CONSUMES_ATTEMPT: ReadonlySet<TaskPhase> = new Set<TaskPhase>(["execute", "repair"]);

const MAX_REASON_LENGTH = 4_000;
const MAX_EVIDENCE_PER_PROPOSAL = 64;

export const TaskTransitionPolicy = Object.freeze({
  /** How much of the attempt budget entering `phase` consumes. */
  attemptCost(phase: TaskPhase): number {
    return CONSUMES_ATTEMPT.has(phase) ? 1 : 0;
  },

  /**
   * Evaluates a proposal against the current capsule. Every failed predicate is reported, not
   * just the first, so a caller learns everything it must fix rather than one thing at a time.
   */
  evaluate(current: TaskCapsule, proposal: TaskTransitionProposal): TaskTransitionDecision {
    const reasons: string[] = [];
    let code: TaskTransitionRefusalCode | undefined;
    const refuse = (candidate: TaskTransitionRefusalCode, reason: string): void => {
      code ??= candidate;
      reasons.push(reason);
    };

    if (proposal.taskId !== current.taskId) {
      refuse("TASK_MISMATCH", `Proposal targets ${proposal.taskId}, not ${current.taskId}.`);
    }
    if (proposal.expectedCapsuleRevision !== current.capsuleRevision) {
      refuse(
        "STALE_CAPSULE_REVISION",
        `Proposal expects logical capsule revision ${proposal.expectedCapsuleRevision}; the capsule is at ${current.capsuleRevision}.`,
      );
    }
    if (proposal.from !== current.phase) {
      refuse(
        "PHASE_MISMATCH",
        `Proposal moves from ${proposal.from}; the capsule is in ${current.phase}.`,
      );
    }

    const allowedTargets = TRANSITIONS[current.phase] ?? [];
    if (!allowedTargets.includes(proposal.to)) {
      refuse(
        "ILLEGAL_TRANSITION",
        `${current.phase} may move to ${allowedTargets.length === 0 ? "no phase (terminal)" : allowedTargets.join(", ")}, not ${proposal.to}.`,
      );
    }

    if (
      typeof proposal.reason !== "string" ||
      proposal.reason.trim().length === 0 ||
      proposal.reason.length > MAX_REASON_LENGTH
    ) {
      refuse(
        "INVALID_REASON",
        `A transition reason must be non-empty and at most ${MAX_REASON_LENGTH} characters.`,
      );
    }

    const evidenceIds = proposal.evidenceIds ?? [];
    if (evidenceIds.length > MAX_EVIDENCE_PER_PROPOSAL) {
      refuse(
        "INVALID_EVIDENCE",
        `A proposal may cite at most ${MAX_EVIDENCE_PER_PROPOSAL} evidence records.`,
      );
    }
    if (!evidenceIds.every((id) => isCanonicalDurableId(id))) {
      refuse("INVALID_EVIDENCE", "Every cited evidence identifier must be a durable ID.");
    }
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      refuse("INVALID_EVIDENCE", "Cited evidence must be unique.");
    }
    if (REQUIRES_EVIDENCE.has(proposal.to) && evidenceIds.length === 0) {
      refuse("MISSING_EVIDENCE", `Entering ${proposal.to} requires at least one evidence record.`);
    }

    // Blocking is always reachable: a task that has run out of attempts must still be able to
    // say so rather than being stranded in an active phase.
    const cost = TaskTransitionPolicy.attemptCost(proposal.to);
    if (cost > 0 && current.attempts + cost > current.maxAttempts) {
      refuse(
        "ATTEMPTS_EXHAUSTED",
        `Entering ${proposal.to} would exceed the attempt budget of ${current.maxAttempts}.`,
      );
    }

    if (code !== undefined) {
      return Object.freeze({ allowed: false as const, code, reasons: Object.freeze(reasons) });
    }
    return Object.freeze({ allowed: true as const, to: proposal.to, attemptCost: cost });
  },
});
