import {
  type CanonicalValue,
  type ContentHash,
  canonicalFingerprint,
  type TaskCapsule,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { AgentReasoningPolicy } from "../ports/model-gateway.port.js";
import type { EntryAcceptanceSnapshot } from "./entry-acceptance-snapshot.js";

/**
 * The Manager→role handoff: one immutable, fingerprinted dispatch for one bounded step.
 *
 * The Manager's job is not only "which task next". It is the whole bounded decision: which
 * authoritative capsule revision, which workspace, which frozen acceptance contract, and which
 * role, model, skill set, operation set, and context policy the next role runs under. Without a
 * single carrier for that decision, a role ends up re-accepting an equivalent-looking one from
 * whoever called it — and a caller that can restate the policy is a caller that can widen it.
 *
 * So a role consumes a handoff and verifies its fingerprint; it does not take the parts. The
 * fingerprint is what makes substitution visible: a forged capsule fingerprint, a swapped contract,
 * an extra operation, a different model, or a larger context budget all change it.
 *
 * Everything here is pure: no clock, no randomness, no I/O. The issue time is an input.
 */
export type RoleHandoffKind = "manager_to_executor" | "manager_to_auditor";
export type HandoffRole = "executor" | "auditor";

/**
 * The bounded turn/context policy a role runs under.
 *
 * Structural on purpose. The runtime's `AgentTurnBudget` remains the definition the agent-turn loop
 * enforces; this is the same shape carried across the layer boundary so the Manager can freeze it
 * without the application layer reaching into `apps/runtime`.
 */
export interface RoleContextPolicy {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxDefers: number;
  readonly maxRefusedTurns: number;
  readonly maxNoProgressTurns: number;
  readonly maxPromptBytes: number;
  readonly maxPromptTokens: number;
}

/** What the Manager selects for a role. Operation ids stay opaque here; the runtime catalog is their authority. */
export interface RoleExecutionPolicy {
  readonly modelId: string;
  readonly allowedOperations: readonly string[];
  readonly skillVersions: readonly string[];
  readonly reasoningPolicy: AgentReasoningPolicy;
  readonly harnessVersion: string;
  readonly contextPolicy: RoleContextPolicy;
}

export interface RoleHandoff {
  readonly handoffKind: RoleHandoffKind;
  readonly role: HandoffRole;
  readonly taskId: string;
  readonly jobId: string;
  readonly capsuleRevision: number;
  readonly capsuleFingerprint: ContentHash;
  readonly workspaceId: string | null;
  readonly workspaceFingerprint: ContentHash | null;
  readonly acceptanceContractFingerprint: ContentHash;
  readonly modelId: string;
  readonly allowedOperations: readonly string[];
  readonly skillVersions: readonly string[];
  readonly reasoningPolicy: AgentReasoningPolicy;
  readonly harnessVersion: string;
  readonly contextPolicy: RoleContextPolicy;
  readonly issuedAt: string;
  readonly handoffFingerprint: ContentHash;
}

export interface ExecutorHandoffInput {
  readonly snapshot: EntryAcceptanceSnapshot;
  /** The authoritative revision the contract was frozen from. */
  readonly capsule: TaskCapsule;
  readonly jobId: string;
  readonly policy: RoleExecutionPolicy;
  readonly issuedAt: string;
}

export interface AuditorHandoffInput {
  /** Proves this audit belongs to the execution it follows; nothing else of it is carried over. */
  readonly executorHandoff: RoleHandoff;
  readonly snapshot: EntryAcceptanceSnapshot;
  /** The authoritative capsule as it stands after execution, which may have advanced. */
  readonly capsule: TaskCapsule;
  readonly workspaceFingerprint: ContentHash | null;
  readonly policy: RoleExecutionPolicy;
  readonly issuedAt: string;
}

/** The authoritative state a handoff is checked against at dispatch time. */
export interface AuthoritativeRoleState {
  readonly capsule: TaskCapsule;
  readonly workspaceId: string | null;
  readonly workspaceFingerprint: ContentHash | null;
}

export const HANDOFF_LIMITS = Object.freeze({
  maxAllowedOperations: 32,
  maxSkillVersions: 64,
  maxTextLength: 256,
});

const CONTEXT_POLICY_KEYS = Object.freeze([
  "maxTurns",
  "maxToolCalls",
  "maxDefers",
  "maxRefusedTurns",
  "maxNoProgressTurns",
  "maxPromptBytes",
  "maxPromptTokens",
] as const);

/** `maxDefers` may legitimately be zero: a role that may never defer is a bound, not a mistake. */
const MAY_BE_ZERO: ReadonlySet<string> = new Set(["maxDefers", "maxRefusedTurns"]);

function invalid(message: string, details: Record<string, string | number> = {}): ApplicationError {
  return new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}

function boundedText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`A role handoff must name a non-empty ${label}.`);
  }
  if (value.length > HANDOFF_LIMITS.maxTextLength) {
    throw invalid(`A role handoff ${label} is bounded text.`, { length: value.length });
  }
  return value;
}

/** Sorted and de-duplicated, so two equivalent policies fingerprint identically. */
function canonicalSet(values: readonly string[], limit: number, label: string): readonly string[] {
  if (!Array.isArray(values)) throw invalid(`A role handoff must declare ${label} as a list.`);
  const unique = [...new Set(values)].sort();
  if (unique.length > limit) {
    throw invalid(`A role handoff may declare at most ${limit} ${label}.`, {
      count: unique.length,
    });
  }
  for (const value of unique) boundedText(value, label);
  return Object.freeze(unique);
}

function canonicalContextPolicy(policy: RoleContextPolicy): RoleContextPolicy {
  const canonical: Record<string, number> = {};
  for (const key of CONTEXT_POLICY_KEYS) {
    const value = policy?.[key];
    const floor = MAY_BE_ZERO.has(key) ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < floor) {
      throw invalid(`A role handoff context policy needs an integer ${key} of at least ${floor}.`, {
        [key]: typeof value === "number" ? value : -1,
      });
    }
    canonical[key] = value;
  }
  return Object.freeze(canonical as unknown as RoleContextPolicy);
}

function canonicalPolicy(policy: RoleExecutionPolicy): RoleExecutionPolicy {
  const allowedOperations = canonicalSet(
    policy?.allowedOperations ?? [],
    HANDOFF_LIMITS.maxAllowedOperations,
    "allowed operations",
  );
  if (allowedOperations.length === 0) {
    throw invalid("A role handoff must offer at least one semantic operation.");
  }
  return Object.freeze({
    modelId: boundedText(policy.modelId, "model id"),
    allowedOperations,
    skillVersions: canonicalSet(
      policy?.skillVersions ?? [],
      HANDOFF_LIMITS.maxSkillVersions,
      "skill versions",
    ),
    reasoningPolicy: policy.reasoningPolicy,
    harnessVersion: boundedText(policy.harnessVersion, "harness version"),
    contextPolicy: canonicalContextPolicy(policy.contextPolicy),
  });
}

/** The part of the handoff the fingerprint covers: everything except the fingerprint itself. */
function handoffPayload(state: Omit<RoleHandoff, "handoffFingerprint">): CanonicalValue {
  return {
    ...state,
    allowedOperations: [...state.allowedOperations],
    skillVersions: [...state.skillVersions],
    contextPolicy: { ...state.contextPolicy },
  } as unknown as CanonicalValue;
}

function seal(state: Omit<RoleHandoff, "handoffFingerprint">): RoleHandoff {
  return Object.freeze({
    ...state,
    handoffFingerprint: canonicalFingerprint(handoffPayload(state)),
  });
}

/**
 * Refuses a snapshot that is not this capsule's own frozen contract.
 *
 * The Manager compiles both from the same authoritative revision, so a mismatch means the two were
 * assembled separately — which is exactly the substitution the handoff exists to prevent.
 */
function assertContractDescribes(snapshot: EntryAcceptanceSnapshot, capsule: TaskCapsule): void {
  if (
    snapshot.taskId !== capsule.taskId ||
    snapshot.capsuleRevision !== capsule.capsuleRevision ||
    snapshot.capsuleFingerprint !== capsule.fingerprint
  ) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "The acceptance contract was not frozen from this authoritative task capsule.",
      {
        details: {
          taskId: capsule.taskId,
          capsuleRevision: capsule.capsuleRevision,
          contractRevision: snapshot.capsuleRevision,
        },
      },
    );
  }
}

export function issueExecutorHandoff(input: ExecutorHandoffInput): RoleHandoff {
  const { capsule, snapshot } = input;
  assertContractDescribes(snapshot, capsule);
  const policy = canonicalPolicy(input.policy);
  return seal({
    handoffKind: "manager_to_executor",
    role: "executor",
    taskId: capsule.taskId,
    jobId: boundedText(input.jobId, "job id"),
    capsuleRevision: capsule.capsuleRevision,
    capsuleFingerprint: capsule.fingerprint,
    workspaceId: capsule.workspaceId,
    // The workspace state the Manager froze the contract against, not one supplied here.
    workspaceFingerprint: snapshot.workspaceFingerprint,
    acceptanceContractFingerprint: snapshot.contractFingerprint,
    ...policy,
    issuedAt: boundedText(input.issuedAt, "issue time"),
  });
}

/**
 * The Auditor's dispatch, derived from the frozen contract and the authoritative result state.
 *
 * The Executor's handoff is used for one thing only: proving the audit belongs to that execution.
 * No context, transcript, model output, or turn budget crosses over — the Auditor's policy is
 * supplied fresh, and its capsule and workspace identity are read from authoritative state as it
 * stands now.
 */
export function deriveAuditorHandoff(input: AuditorHandoffInput): RoleHandoff {
  const { capsule, snapshot, executorHandoff } = input;
  if (snapshot.contractFingerprint !== executorHandoff.acceptanceContractFingerprint) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "An audit may only be derived from the acceptance contract the execution was dispatched against.",
      { details: { taskId: snapshot.taskId } },
    );
  }
  if (executorHandoff.role !== "executor") {
    throw invalid("An audit handoff is derived from an executor handoff.", {
      role: executorHandoff.role,
    });
  }
  const policy = canonicalPolicy(input.policy);
  return seal({
    handoffKind: "manager_to_auditor",
    role: "auditor",
    taskId: capsule.taskId,
    jobId: executorHandoff.jobId,
    capsuleRevision: capsule.capsuleRevision,
    capsuleFingerprint: capsule.fingerprint,
    workspaceId: capsule.workspaceId,
    workspaceFingerprint: input.workspaceFingerprint,
    acceptanceContractFingerprint: snapshot.contractFingerprint,
    ...policy,
    issuedAt: boundedText(input.issuedAt, "issue time"),
  });
}

/** Proves a handoff is the exact dispatch a role was sent with. */
export function assertRoleHandoff(handoff: RoleHandoff, expected: ContentHash): void {
  const { handoffFingerprint: _claimed, ...state } = handoff;
  const recomputed = canonicalFingerprint(handoffPayload(state));
  if (handoff.handoffFingerprint !== expected || recomputed !== expected) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "The role handoff does not match the dispatch this role was sent with.",
      {
        details: {
          role: String(handoff.role),
          expected,
          observed: String(handoff.handoffFingerprint),
          recomputed,
        },
      },
    );
  }
}

function conflict(drifted: readonly string[], handoff: RoleHandoff): ApplicationError {
  return new ApplicationError(
    "CONFLICT",
    "The authoritative entry state moved after the Manager froze this handoff; the step must be reselected.",
    { retryable: false, details: { role: handoff.role, drifted: drifted.join(", ") } },
  );
}

/**
 * The time-of-check to time-of-use guard, run immediately before a role's first model invocation.
 *
 * Selection reads authoritative state; execution acts on it. Anything that moves in between — a new
 * capsule revision, a rewritten capsule at the same revision, a different workspace, a workspace
 * whose contents changed — means the frozen contract describes a world that no longer exists. There
 * is no safe way to proceed on a stale dispatch, so this fails closed and the Manager must select
 * again.
 */
export function assertHandoffStillCurrent(
  handoff: RoleHandoff,
  authority: AuthoritativeRoleState,
): void {
  const drifted: string[] = [];
  if (handoff.taskId !== authority.capsule.taskId) drifted.push("taskId");
  if (handoff.capsuleRevision !== authority.capsule.capsuleRevision)
    drifted.push("capsuleRevision");
  if (handoff.capsuleFingerprint !== authority.capsule.fingerprint) {
    drifted.push("capsuleFingerprint");
  }
  if (handoff.workspaceId !== authority.workspaceId) drifted.push("workspaceId");
  if (handoff.workspaceFingerprint !== authority.workspaceFingerprint) {
    drifted.push("workspaceFingerprint");
  }
  if (drifted.length > 0) throw conflict(drifted, handoff);
}

/**
 * The same guard for an audit, which judges state the Executor was meant to change.
 *
 * A capsule that advanced is the normal case and is not drift. A capsule that regressed, a
 * different task, or a different workspace is: none of those can be the result of the execution
 * this audit follows.
 */
export function assertHandoffResultStateCompatible(
  handoff: RoleHandoff,
  authority: AuthoritativeRoleState,
): void {
  const drifted: string[] = [];
  if (handoff.taskId !== authority.capsule.taskId) drifted.push("taskId");
  if (authority.capsule.capsuleRevision < handoff.capsuleRevision) drifted.push("capsuleRevision");
  if (handoff.workspaceId !== authority.workspaceId) drifted.push("workspaceId");
  if (drifted.length > 0) throw conflict(drifted, handoff);
}
