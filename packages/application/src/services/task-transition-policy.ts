import {
  type EvidenceRecord,
  isCanonicalDurableId,
  type TaskCapsule,
  type TaskPhase,
} from "@v31m4/domain";

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

/** Why the evidence authority refused to treat a cited record as proof for this transition. */
export type TaskEvidenceRejectionReason =
  | "unknown"
  | "not_passed"
  | "wrong_project"
  | "wrong_job"
  | "wrong_subject";

export interface TaskEvidenceRejection {
  readonly evidenceId: string;
  readonly reason: TaskEvidenceRejectionReason;
}

/**
 * The result of resolving cited evidence against the authoritative evidence layer.
 *
 * `verifiedEvidenceIds` holds only references an `EvidenceRepositoryPort` actually returned and
 * that passed every scope predicate below. A caller cannot construct one of these from its own
 * assertion and have it mean anything: the policy compares the cited IDs against this set, so an
 * identifier that no `EvidenceRecord` backs simply is not in it.
 */
export interface TaskEvidenceAssessment {
  readonly verifiedEvidenceIds: ReadonlySet<string>;
  readonly rejections: readonly TaskEvidenceRejection[];
}

/**
 * Subjects a task's evidence may be about, and how each one is tied back to this exact capsule.
 * Evidence about some other project's candidate is not proof about this task, however real the
 * record is — that is the wrong-scope hole this closes.
 */
function subjectInScope(capsule: TaskCapsule, record: EvidenceRecord): boolean {
  switch (record.subjectType) {
    case "task":
      return record.subjectId === capsule.taskId;
    case "acceptance_criterion":
    case "requirement":
      return (capsule.acceptanceCriterionIds as readonly string[]).includes(record.subjectId);
    case "artifact":
      return (capsule.changeArtifactIds as readonly string[]).includes(record.subjectId);
    default:
      return false;
  }
}

/**
 * Deterministically decides which resolved evidence records may back a transition of this capsule.
 *
 * This is a pure predicate over records the caller already loaded through the authoritative
 * `EvidenceRepositoryPort`; it performs no I/O and consults no model. A record must exist, have
 * passed, belong to the capsule's project, agree with the capsule's job when it names one, and be
 * about a subject this capsule actually owns.
 */
export function assessTaskEvidence(
  capsule: TaskCapsule,
  citedEvidenceIds: readonly string[],
  resolved: ReadonlyMap<string, EvidenceRecord>,
): TaskEvidenceAssessment {
  const verified = new Set<string>();
  const rejections: TaskEvidenceRejection[] = [];
  const reject = (evidenceId: string, reason: TaskEvidenceRejectionReason): void => {
    rejections.push(Object.freeze({ evidenceId, reason }));
  };

  for (const evidenceId of new Set(citedEvidenceIds)) {
    const record = resolved.get(evidenceId);
    if (record === undefined) {
      reject(evidenceId, "unknown");
      continue;
    }
    if (record.status !== "passed") {
      reject(evidenceId, "not_passed");
      continue;
    }
    if (record.projectId !== capsule.projectId) {
      reject(evidenceId, "wrong_project");
      continue;
    }
    if (record.jobId !== undefined && record.jobId !== capsule.jobId) {
      reject(evidenceId, "wrong_job");
      continue;
    }
    if (!subjectInScope(capsule, record)) {
      reject(evidenceId, "wrong_subject");
      continue;
    }
    verified.add(evidenceId);
  }

  return Object.freeze({
    verifiedEvidenceIds: verified as ReadonlySet<string>,
    rejections: Object.freeze(rejections),
  });
}

const REJECTION_TEXT: Readonly<Record<TaskEvidenceRejectionReason, string>> = Object.freeze({
  unknown: "does not exist in the evidence repository",
  not_passed: "did not pass",
  wrong_project: "belongs to another project",
  wrong_job: "belongs to another job",
  wrong_subject: "is not about a subject this task owns",
});

export const TaskTransitionPolicy = Object.freeze({
  /** How much of the attempt budget entering `phase` consumes. */
  attemptCost(phase: TaskPhase): number {
    return CONSUMES_ATTEMPT.has(phase) ? 1 : 0;
  },

  /**
   * Evaluates a proposal against the current capsule. Every failed predicate is reported, not
   * just the first, so a caller learns everything it must fix rather than one thing at a time.
   *
   * `assessment` is mandatory and must come from the authoritative evidence layer: the policy
   * stays a pure deterministic function, but it is structurally impossible to evaluate a
   * transition without first having resolved the evidence it cites. A syntactically valid
   * identifier is not proof of anything on its own.
   */
  evaluate(
    current: TaskCapsule,
    proposal: TaskTransitionProposal,
    assessment: TaskEvidenceAssessment,
  ): TaskTransitionDecision {
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
    // Every cited reference must be one the evidence authority actually resolved and accepted.
    // The specific reason is reported where it is known, so a caller learns whether the record is
    // missing, failed, inconclusive, or simply about something else.
    const rejectionsById = new Map(
      assessment.rejections.map((rejection) => [rejection.evidenceId, rejection.reason]),
    );
    for (const evidenceId of evidenceIds) {
      if (assessment.verifiedEvidenceIds.has(evidenceId)) continue;
      const reason = rejectionsById.get(evidenceId);
      refuse(
        "INVALID_EVIDENCE",
        reason === undefined
          ? `Evidence ${evidenceId} was not validated by the evidence authority.`
          : `Evidence ${evidenceId} ${REJECTION_TEXT[reason]}.`,
      );
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
