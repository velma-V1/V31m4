import type {
  ContentHash,
  EvidenceKind,
  ExecutionLedgerEntry,
  JobId,
  TaskCapsule,
  TaskId,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { ExecutionLedgerRepositoryPort } from "../ports/execution-ledger-repository.port.js";
import type { TaskCapsuleRepositoryPort } from "../ports/task-capsule-repository.port.js";
import {
  type EntryAcceptanceSnapshot,
  freezeEntryAcceptanceSnapshot,
} from "../services/entry-acceptance-snapshot.js";
import { type ManagerRoute, routeNextStep } from "../services/manager-routing.js";
import {
  issueExecutorHandoff,
  type RoleExecutionPolicy,
  type RoleHandoff,
} from "../services/role-handoff.js";
import { projectLedger, scanTaskLedger } from "./reconcile-execution-effect.js";

/**
 * The Manager: choose one dependency-ready bounded step, and freeze what "done" means for it.
 *
 * It reads and decides; it never writes. Selection, the acceptance contract, and the route are all
 * functions of durable state, so the same state selects the same step every time and a restart at
 * the Manager boundary re-derives the identical answer rather than resuming a remembered one.
 *
 * The Manager explicitly **cannot** mark anything complete. It has no repository write, no evidence
 * write, and no transition proposal — completion belongs to the checked transition policy after an
 * independent audit, and giving the selector any part of it would collapse the separation the
 * Manager exists to create.
 */
export interface SelectNextTaskDependencies {
  readonly capsules: TaskCapsuleRepositoryPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
}

export interface SelectNextTaskCommand {
  readonly taskId: TaskId;
  readonly jobId: JobId;
  /** What this class of task requires deterministically; the capsule cannot express it. */
  readonly requiredChecks: readonly string[];
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly riskPolicyIds: readonly string[];
  readonly workspaceFingerprint: ContentHash | null;
  /**
   * The role, model, skill, operation, and context policy the next Executor runs under. The
   * Manager freezes it into the handoff; no later role may restate an equivalent-looking one.
   */
  readonly executorPolicy: RoleExecutionPolicy;
  /** Current fingerprints of observed resources, so a stale check is not read as an answer. */
  readonly currentFingerprints: Readonly<Record<string, string>>;
  readonly frozenAt: string;
}

export interface NextTaskSelection {
  readonly taskId: TaskId;
  readonly capsule: TaskCapsule;
  /** The store revision the head carried when it was read; a caller's write condition. */
  readonly headRevision: string;
  readonly readyNodeIds: readonly string[];
  readonly selectedNodeId: string | null;
  readonly snapshot: EntryAcceptanceSnapshot;
  readonly route: ManagerRoute;
  /**
   * The immutable dispatch for the next Executor, or `null` on a route that calls for no execution.
   * A role consumes this whole; it never assembles the parts itself.
   */
  readonly handoff: RoleHandoff | null;
}

/**
 * DAG nodes that are workable right now: not blocked themselves, and with no blocked node anywhere
 * in their transitive dependencies. Returned in the capsule's own node order so the answer is
 * deterministic, and derived purely from stored state.
 *
 * Task 2's DAG models dependency and *blocker* state, which is what this reads. It deliberately
 * does not model per-node completion.
 */
export function readyDagNodeIds(capsule: TaskCapsule): readonly string[] {
  const nodes = new Map(capsule.dagNodes.map((node) => [node.id, node]));
  const blockedTransitively = new Map<string, boolean>();

  const isBlocked = (id: string): boolean => {
    const cached = blockedTransitively.get(id);
    if (cached !== undefined) return cached;
    const node = nodes.get(id);
    if (node === undefined) return true;
    // Provisionally false so a malformed self-reference cannot loop; the entity already
    // guarantees the DAG is acyclic.
    blockedTransitively.set(id, false);
    const blocked = node.blocked || node.dependsOn.some((dependency) => isBlocked(dependency));
    blockedTransitively.set(id, blocked);
    return blocked;
  };

  return Object.freeze(
    capsule.dagNodes.filter((node) => !isBlocked(node.id)).map((node) => node.id),
  );
}

/** The routes that put an Executor to work; the rest dispatch nothing. */
const EXECUTING_ROUTES: ReadonlySet<ManagerRoute["kind"]> = new Set<ManagerRoute["kind"]>([
  "deterministic_check",
  "model_turn",
]);

/** Every `check_result` in this task's history, in append order, read to exhaustion. */
async function loadHistory(
  dependencies: SelectNextTaskDependencies,
  taskId: TaskId,
  context: OperationContext,
): Promise<readonly ExecutionLedgerEntry[]> {
  const entries: ExecutionLedgerEntry[] = [];
  await scanTaskLedger(dependencies.ledger, taskId, context, (page) => {
    entries.push(...page);
    return "continue";
  });
  return entries;
}

export async function selectNextTask(
  dependencies: SelectNextTaskDependencies,
  command: SelectNextTaskCommand,
  context: OperationContext,
): Promise<NextTaskSelection> {
  const head = await dependencies.capsules.getHead(command.taskId, context);
  if (head === null) {
    throw new ApplicationError("NOT_FOUND", "There is no task capsule to select work from.", {
      details: { taskId: command.taskId },
    });
  }
  const capsule = await dependencies.capsules.getRevision(
    command.taskId,
    head.value.capsuleRevision,
    context,
  );
  if (capsule === null || capsule.fingerprint !== head.value.fingerprint) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "The task capsule head does not resolve to the revision it names.",
      { details: { taskId: command.taskId, capsuleRevision: head.value.capsuleRevision } },
    );
  }

  const history = await loadHistory(dependencies, command.taskId, context);
  const snapshot = freezeEntryAcceptanceSnapshot({
    capsule,
    requiredChecks: command.requiredChecks,
    requiredEvidenceKinds: command.requiredEvidenceKinds,
    riskPolicyIds: command.riskPolicyIds,
    workspaceFingerprint: command.workspaceFingerprint,
    frozenAt: command.frozenAt,
  });
  const readyNodeIds = readyDagNodeIds(capsule);
  const route = routeNextStep({
    snapshot,
    projection: projectLedger(history),
    checkResults: history.filter((entry) => entry.kind === "check_result"),
    readyNodeIds,
    currentFingerprints: command.currentFingerprints,
  });

  return Object.freeze({
    taskId: command.taskId,
    capsule,
    headRevision: head.revision,
    readyNodeIds,
    selectedNodeId: readyNodeIds[0] ?? null,
    snapshot,
    route,
    // Only a route that actually calls for Executor work is dispatched. An audit or a blocked
    // task has no execution to authorise, and minting a handoff anyway would leave a valid
    // dispatch lying around for work nobody selected.
    handoff: EXECUTING_ROUTES.has(route.kind)
      ? issueExecutorHandoff({
          snapshot,
          capsule,
          jobId: command.jobId,
          policy: command.executorPolicy,
          issuedAt: command.frozenAt,
        })
      : null,
  });
}
