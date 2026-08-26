import { assertDomain } from "../domain-errors.js";
import {
  type CanonicalValue,
  canonicalFingerprint,
} from "../value-objects/canonical-fingerprint.js";
import { ContentHash } from "../value-objects/content-hash.js";
import {
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  CheckpointId,
  type CheckpointId as CheckpointIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  isCanonicalDurableId,
  JobId,
  type JobId as JobIdType,
  LedgerEntryId,
  type LedgerEntryId as LedgerEntryIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
  RequirementId,
  type RequirementId as RequirementIdType,
  SandboxId,
  type SandboxId as SandboxIdType,
  TaskId,
  type TaskId as TaskIdType,
} from "../value-objects/ids.js";

/**
 * The Task Capsule: one task's bounded, durable, self-describing state.
 *
 * Two ideas must never be confused. `capsuleRevision` is the capsule's own **logical** revision,
 * owned by the domain and chained through `previousFingerprint`. The record store's
 * `Versioned<T>.revision` is an entirely separate optimistic-concurrency counter owned by
 * persistence. A capsule therefore carries no store revision at all.
 *
 * The capsule is deliberately bounded and referential. Long histories live in the Execution
 * Ledger, the evidence store, and the artifact store; the capsule holds identifiers pointing at
 * them. It is current state, never a transcript.
 */
export type TaskPhase =
  | "investigate"
  | "plan"
  | "execute"
  | "verify"
  | "repair"
  | "blocked"
  | "complete";

const PHASES: ReadonlySet<string> = new Set<TaskPhase>([
  "investigate",
  "plan",
  "execute",
  "verify",
  "repair",
  "blocked",
  "complete",
]);

export const TASK_CAPSULE_LIMITS = Object.freeze({
  maxDagNodes: 64,
  maxDependenciesPerNode: 16,
  maxTotalDependencies: 256,
  maxHypotheses: 16,
  maxRisks: 16,
  maxPlanSteps: 32,
  maxConstraints: 32,
  maxAcceptanceCriteria: 64,
  maxEvidenceReferences: 128,
  maxDecisionReferences: 64,
  maxCheckpointReferences: 64,
  maxArtifactReferences: 64,
  maxLedgerReferences: 256,
  maxActiveFingerprints: 32,
  maxTextLength: 2_000,
  maxAttemptCeiling: 100,
});

export interface TaskDagNode {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly blocked: boolean;
}

export interface TaskDagNodeInput {
  readonly id: string;
  readonly title: string;
  readonly dependsOn?: readonly string[];
  readonly blocked?: boolean;
}

export interface TaskCapsule {
  readonly taskId: TaskIdType;
  readonly jobId: JobIdType;
  readonly projectId: ProjectIdType;
  readonly parentTaskId: TaskIdType | null;
  readonly capsuleRevision: number;
  readonly previousFingerprint: ContentHash | null;
  readonly fingerprint: ContentHash;
  readonly phase: TaskPhase;
  readonly objective: string;
  readonly acceptanceCriterionIds: readonly RequirementIdType[];
  readonly constraints: readonly string[];
  readonly forbiddenChanges: readonly string[];
  readonly dagNodes: readonly TaskDagNode[];
  readonly planSteps: readonly string[];
  readonly nextAction: string | null;
  readonly verifiedEvidenceIds: readonly EvidenceIdType[];
  readonly hypotheses: readonly string[];
  readonly risks: readonly string[];
  readonly decisionIds: readonly string[];
  readonly workspaceId: string | null;
  readonly sandboxId: SandboxIdType | null;
  readonly checkpointIds: readonly CheckpointIdType[];
  readonly changeArtifactIds: readonly ArtifactIdType[];
  readonly ledgerEntryIds: readonly LedgerEntryIdType[];
  readonly activeFingerprints: Readonly<Record<string, ContentHash>>;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly escalations: number;
  readonly stopCondition: string;
  readonly updatedAt: string;
}

export interface TaskCapsuleInput {
  readonly taskId: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly parentTaskId?: string | null;
  readonly phase: TaskPhase;
  readonly objective: string;
  readonly acceptanceCriterionIds?: readonly string[];
  readonly constraints?: readonly string[];
  readonly forbiddenChanges?: readonly string[];
  readonly dagNodes?: readonly TaskDagNodeInput[];
  readonly planSteps?: readonly string[];
  readonly nextAction?: string | null;
  readonly verifiedEvidenceIds?: readonly string[];
  readonly hypotheses?: readonly string[];
  readonly risks?: readonly string[];
  readonly decisionIds?: readonly string[];
  readonly workspaceId?: string | null;
  readonly sandboxId?: string | null;
  readonly checkpointIds?: readonly string[];
  readonly changeArtifactIds?: readonly string[];
  readonly ledgerEntryIds?: readonly string[];
  readonly activeFingerprints?: Readonly<Record<string, string>>;
  readonly attempts?: number;
  readonly maxAttempts: number;
  readonly escalations?: number;
  readonly stopCondition: string;
  readonly updatedAt: string;
}

/** The fields a later revision may change. Identity and the revision chain are not among them. */
export type TaskCapsuleChanges = Partial<
  Omit<
    TaskCapsuleInput,
    "taskId" | "jobId" | "projectId" | "parentTaskId" | "maxAttempts" | "updatedAt"
  >
> & { readonly updatedAt: string };

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function fail(message: string, details: Readonly<Record<string, string | number>> = {}): never {
  assertDomain(false, "INVALID_TASK_CAPSULE", message, details);
}

function text(value: string, label: string, allowEmpty = false): string {
  assertDomain(
    typeof value === "string" &&
      value === value.trim() &&
      (allowEmpty || value.length > 0) &&
      value.length <= TASK_CAPSULE_LIMITS.maxTextLength,
    "INVALID_TASK_CAPSULE",
    `${label} must be canonical text of at most ${TASK_CAPSULE_LIMITS.maxTextLength} characters.`,
    { label },
  );
  return value;
}

function boundedTexts(values: readonly string[], label: string, limit: number): readonly string[] {
  assertDomain(
    Array.isArray(values) && values.length <= limit,
    "INVALID_TASK_CAPSULE",
    `${label} may hold at most ${limit} entries.`,
    { label, count: Array.isArray(values) ? values.length : -1 },
  );
  return Object.freeze(values.map((value) => text(value, label)));
}

function boundedIds<T>(
  values: readonly string[],
  label: string,
  limit: number,
  parse: (value: string) => T,
): readonly T[] {
  assertDomain(
    Array.isArray(values) && values.length <= limit,
    "INVALID_TASK_CAPSULE",
    `${label} may hold at most ${limit} entries.`,
    { label, count: Array.isArray(values) ? values.length : -1 },
  );
  const parsed = values.map((value) => parse(value));
  assertDomain(
    new Set(parsed).size === parsed.length,
    "INVALID_TASK_CAPSULE",
    `${label} must be unique.`,
    { label },
  );
  return Object.freeze(parsed);
}

function integerWithin(value: number, label: string, minimum: number, maximum: number): number {
  assertDomain(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "INVALID_TASK_CAPSULE",
    `${label} must be an integer between ${minimum} and ${maximum}.`,
    { label, value: String(value) },
  );
  return value;
}

function optionalId<T>(value: string | null | undefined, parse: (raw: string) => T): T | null {
  return value === undefined || value === null ? null : parse(value);
}

/** Validates the DAG: canonical unique nodes, real dependencies, no self-edge, and acyclic. */
function buildDag(inputs: readonly TaskDagNodeInput[]): readonly TaskDagNode[] {
  assertDomain(
    Array.isArray(inputs) && inputs.length <= TASK_CAPSULE_LIMITS.maxDagNodes,
    "INVALID_TASK_CAPSULE",
    `A task DAG may hold at most ${TASK_CAPSULE_LIMITS.maxDagNodes} nodes.`,
    { count: Array.isArray(inputs) ? inputs.length : -1 },
  );

  const nodes = inputs.map((node) => {
    assertDomain(
      isCanonicalDurableId(node.id),
      "INVALID_TASK_CAPSULE",
      "A task DAG node identifier must use canonical durable-ID syntax.",
      { id: String(node.id) },
    );
    const dependsOn = node.dependsOn ?? [];
    assertDomain(
      Array.isArray(dependsOn) && dependsOn.length <= TASK_CAPSULE_LIMITS.maxDependenciesPerNode,
      "INVALID_TASK_CAPSULE",
      `A task DAG node may declare at most ${TASK_CAPSULE_LIMITS.maxDependenciesPerNode} dependencies.`,
      { id: node.id, count: Array.isArray(dependsOn) ? dependsOn.length : -1 },
    );
    assertDomain(
      new Set(dependsOn).size === dependsOn.length,
      "INVALID_TASK_CAPSULE",
      "Task DAG dependencies must be unique within a node.",
      { id: node.id },
    );
    assertDomain(
      !dependsOn.includes(node.id),
      "INVALID_TASK_CAPSULE",
      "A task DAG node cannot depend on itself.",
      { id: node.id },
    );
    return Object.freeze({
      id: node.id,
      title: text(node.title, "task DAG node title"),
      dependsOn: Object.freeze([...dependsOn]),
      blocked: node.blocked === true,
    });
  });

  const ids = nodes.map((node) => node.id);
  assertDomain(
    new Set(ids).size === ids.length,
    "INVALID_TASK_CAPSULE",
    "Task DAG node identifiers must be unique.",
  );
  const known = new Set(ids);
  let totalDependencies = 0;
  for (const node of nodes) {
    totalDependencies += node.dependsOn.length;
    for (const dependency of node.dependsOn) {
      assertDomain(
        known.has(dependency),
        "INVALID_TASK_CAPSULE",
        "A task DAG dependency must reference a node that exists.",
        { id: node.id, dependency },
      );
    }
  }
  assertDomain(
    totalDependencies <= TASK_CAPSULE_LIMITS.maxTotalDependencies,
    "INVALID_TASK_CAPSULE",
    `A task DAG may hold at most ${TASK_CAPSULE_LIMITS.maxTotalDependencies} dependencies.`,
    { totalDependencies },
  );
  assertAcyclic(nodes);
  return Object.freeze(nodes);
}

/** Iterative depth-first cycle detection; recursion would make a deep DAG a stack hazard. */
function assertAcyclic(nodes: readonly TaskDagNode[]): void {
  const edges = new Map(nodes.map((node) => [node.id, node.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  for (const start of edges.keys()) {
    if (state.get(start) === "done") continue;
    const stack: { readonly id: string; index: number }[] = [{ id: start, index: 0 }];
    state.set(start, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { readonly id: string; index: number };
      const dependencies = edges.get(frame.id) ?? [];
      if (frame.index >= dependencies.length) {
        state.set(frame.id, "done");
        stack.pop();
        continue;
      }
      const next = dependencies[frame.index] as string;
      frame.index += 1;
      const seen = state.get(next);
      if (seen === "visiting") {
        fail("The task DAG contains a cycle.", { node: frame.id, dependency: next });
      }
      if (seen !== "done") {
        state.set(next, "visiting");
        stack.push({ id: next, index: 0 });
      }
    }
  }
}

function buildActiveFingerprints(
  input: Readonly<Record<string, string>>,
): Readonly<Record<string, ContentHash>> {
  const keys = Object.keys(input);
  assertDomain(
    keys.length <= TASK_CAPSULE_LIMITS.maxActiveFingerprints,
    "INVALID_TASK_CAPSULE",
    `A capsule may hold at most ${TASK_CAPSULE_LIMITS.maxActiveFingerprints} active fingerprints.`,
    { count: keys.length },
  );
  const entries: Record<string, ContentHash> = {};
  for (const key of keys.sort()) {
    assertDomain(
      isCanonicalDurableId(key),
      "INVALID_TASK_CAPSULE",
      "An active fingerprint name must use canonical durable-ID syntax.",
      { key },
    );
    entries[key] = ContentHash.parse(input[key] as string);
  }
  return Object.freeze(entries);
}

/** The logical state a fingerprint covers: everything except the fingerprint itself. */
function fingerprintPayload(capsule: Omit<TaskCapsule, "fingerprint">): CanonicalValue {
  const { fingerprint: _ignored, ...rest } = capsule as TaskCapsule & {
    readonly fingerprint?: unknown;
  };
  return rest as unknown as CanonicalValue;
}

function construct(
  input: TaskCapsuleInput,
  capsuleRevision: number,
  previousFingerprint: ContentHash | null,
): TaskCapsule {
  assertDomain(
    PHASES.has(input.phase),
    "INVALID_TASK_CAPSULE",
    "Task phase is not one of the approved phases.",
    { phase: String(input.phase) },
  );
  assertDomain(
    ISO_PATTERN.test(input.updatedAt) &&
      new Date(Date.parse(input.updatedAt)).toISOString() === input.updatedAt,
    "INVALID_TASK_CAPSULE",
    "Capsule update time must be canonical UTC ISO-8601 with milliseconds.",
  );
  const maxAttempts = integerWithin(
    input.maxAttempts,
    "maxAttempts",
    1,
    TASK_CAPSULE_LIMITS.maxAttemptCeiling,
  );
  const attempts = integerWithin(input.attempts ?? 0, "attempts", 0, maxAttempts);
  const workspaceId = input.workspaceId ?? null;
  if (workspaceId !== null) {
    assertDomain(
      isCanonicalDurableId(workspaceId),
      "INVALID_TASK_CAPSULE",
      "A workspace identifier must use canonical durable-ID syntax.",
      { workspaceId },
    );
  }

  const state: Omit<TaskCapsule, "fingerprint"> = {
    taskId: TaskId.parse(input.taskId),
    jobId: JobId.parse(input.jobId),
    projectId: ProjectId.parse(input.projectId),
    parentTaskId: optionalId(input.parentTaskId, (raw) => TaskId.parse(raw)),
    capsuleRevision,
    previousFingerprint,
    phase: input.phase,
    objective: text(input.objective, "objective"),
    acceptanceCriterionIds: boundedIds(
      input.acceptanceCriterionIds ?? [],
      "acceptanceCriterionIds",
      TASK_CAPSULE_LIMITS.maxAcceptanceCriteria,
      (raw) => RequirementId.parse(raw),
    ),
    constraints: boundedTexts(
      input.constraints ?? [],
      "constraints",
      TASK_CAPSULE_LIMITS.maxConstraints,
    ),
    forbiddenChanges: boundedTexts(
      input.forbiddenChanges ?? [],
      "forbiddenChanges",
      TASK_CAPSULE_LIMITS.maxConstraints,
    ),
    dagNodes: buildDag(input.dagNodes ?? []),
    planSteps: boundedTexts(input.planSteps ?? [], "planSteps", TASK_CAPSULE_LIMITS.maxPlanSteps),
    nextAction:
      input.nextAction === undefined || input.nextAction === null
        ? null
        : text(input.nextAction, "nextAction"),
    verifiedEvidenceIds: boundedIds(
      input.verifiedEvidenceIds ?? [],
      "verifiedEvidenceIds",
      TASK_CAPSULE_LIMITS.maxEvidenceReferences,
      (raw) => EvidenceId.parse(raw),
    ),
    hypotheses: boundedTexts(
      input.hypotheses ?? [],
      "hypotheses",
      TASK_CAPSULE_LIMITS.maxHypotheses,
    ),
    risks: boundedTexts(input.risks ?? [], "risks", TASK_CAPSULE_LIMITS.maxRisks),
    decisionIds: boundedIds(
      input.decisionIds ?? [],
      "decisionIds",
      TASK_CAPSULE_LIMITS.maxDecisionReferences,
      (raw) => {
        assertDomain(
          isCanonicalDurableId(raw),
          "INVALID_TASK_CAPSULE",
          "A decision reference must use canonical durable-ID syntax.",
          { decisionId: String(raw) },
        );
        return raw;
      },
    ),
    workspaceId,
    sandboxId: optionalId(input.sandboxId, (raw) => SandboxId.parse(raw)),
    checkpointIds: boundedIds(
      input.checkpointIds ?? [],
      "checkpointIds",
      TASK_CAPSULE_LIMITS.maxCheckpointReferences,
      (raw) => CheckpointId.parse(raw),
    ),
    changeArtifactIds: boundedIds(
      input.changeArtifactIds ?? [],
      "changeArtifactIds",
      TASK_CAPSULE_LIMITS.maxArtifactReferences,
      (raw) => ArtifactId.parse(raw),
    ),
    ledgerEntryIds: boundedIds(
      input.ledgerEntryIds ?? [],
      "ledgerEntryIds",
      TASK_CAPSULE_LIMITS.maxLedgerReferences,
      (raw) => LedgerEntryId.parse(raw),
    ),
    activeFingerprints: buildActiveFingerprints(input.activeFingerprints ?? {}),
    attempts,
    maxAttempts,
    escalations: integerWithin(
      input.escalations ?? 0,
      "escalations",
      0,
      TASK_CAPSULE_LIMITS.maxAttemptCeiling,
    ),
    stopCondition: text(input.stopCondition, "stopCondition"),
    updatedAt: input.updatedAt,
  };

  return Object.freeze({ ...state, fingerprint: canonicalFingerprint(fingerprintPayload(state)) });
}

/** Recovers the constructor input from an existing capsule, so a revision can be extended. */
function toInput(capsule: TaskCapsule): TaskCapsuleInput {
  return {
    taskId: capsule.taskId,
    jobId: capsule.jobId,
    projectId: capsule.projectId,
    parentTaskId: capsule.parentTaskId,
    phase: capsule.phase,
    objective: capsule.objective,
    acceptanceCriterionIds: capsule.acceptanceCriterionIds,
    constraints: capsule.constraints,
    forbiddenChanges: capsule.forbiddenChanges,
    dagNodes: capsule.dagNodes,
    planSteps: capsule.planSteps,
    nextAction: capsule.nextAction,
    verifiedEvidenceIds: capsule.verifiedEvidenceIds,
    hypotheses: capsule.hypotheses,
    risks: capsule.risks,
    decisionIds: capsule.decisionIds,
    workspaceId: capsule.workspaceId,
    sandboxId: capsule.sandboxId,
    checkpointIds: capsule.checkpointIds,
    changeArtifactIds: capsule.changeArtifactIds,
    ledgerEntryIds: capsule.ledgerEntryIds,
    activeFingerprints: capsule.activeFingerprints,
    attempts: capsule.attempts,
    maxAttempts: capsule.maxAttempts,
    escalations: capsule.escalations,
    stopCondition: capsule.stopCondition,
    updatedAt: capsule.updatedAt,
  };
}

export const TaskCapsule = Object.freeze({
  /** The first logical revision of a task. It has no predecessor. */
  create(input: TaskCapsuleInput): TaskCapsule {
    return construct(input, 1, null);
  },

  /**
   * The next logical revision, chained to its predecessor's fingerprint. The predecessor is not
   * modified — historical revisions are immutable.
   */
  next(current: TaskCapsule, changes: TaskCapsuleChanges): TaskCapsule {
    // The attempt ceiling is fixed at creation. If a later revision could raise its own
    // `maxAttempts`, a task could simply widen the budget it had exhausted, and the bound would
    // mean nothing.
    const next = construct(
      { ...toInput(current), ...changes, maxAttempts: current.maxAttempts },
      current.capsuleRevision + 1,
      current.fingerprint,
    );
    // Attempt and escalation counters are monotonic for the same reason: winding them back is
    // indistinguishable from raising the ceiling.
    assertDomain(
      next.attempts >= current.attempts,
      "INVALID_TASK_CAPSULE",
      "The attempt counter cannot decrease.",
      { from: current.attempts, to: next.attempts },
    );
    assertDomain(
      next.escalations >= current.escalations,
      "INVALID_TASK_CAPSULE",
      "The escalation counter cannot decrease.",
      { from: current.escalations, to: next.escalations },
    );
    return next;
  },

  /** Recomputes the fingerprint a capsule's logical state should carry. */
  fingerprintOf(capsule: TaskCapsule): ContentHash {
    return canonicalFingerprint(fingerprintPayload(capsule));
  },

  /**
   * Rebuilds a capsule from persisted JSON and proves it was not altered in storage. A body
   * whose content no longer matches its recorded fingerprint is rejected rather than trusted.
   */
  rehydrate(value: unknown): TaskCapsule {
    assertDomain(
      typeof value === "object" && value !== null && !Array.isArray(value),
      "INVALID_TASK_CAPSULE",
      "A persisted task capsule must be a JSON object.",
    );
    const body = value as Record<string, unknown>;
    const capsuleRevision = integerWithin(
      body["capsuleRevision"] as number,
      "capsuleRevision",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const rawPrevious = body["previousFingerprint"];
    const previousFingerprint =
      rawPrevious === null || rawPrevious === undefined
        ? null
        : ContentHash.parse(rawPrevious as string);
    assertDomain(
      (capsuleRevision === 1) === (previousFingerprint === null),
      "INVALID_TASK_CAPSULE",
      "Only the first capsule revision may lack a previous fingerprint.",
      { capsuleRevision },
    );
    const rebuilt = construct(
      body as unknown as TaskCapsuleInput,
      capsuleRevision,
      previousFingerprint,
    );
    assertDomain(
      typeof body["fingerprint"] === "string" && body["fingerprint"] === rebuilt.fingerprint,
      "INVALID_TASK_CAPSULE",
      "The persisted capsule fingerprint does not match its content.",
      { capsuleRevision },
    );
    return rebuilt;
  },
});
