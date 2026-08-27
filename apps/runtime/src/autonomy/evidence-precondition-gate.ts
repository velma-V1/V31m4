import {
  ApplicationError,
  assertEvidencePreconditionSatisfied,
  assessTaskEvidence,
  type EvidenceRepositoryPort,
  type ExecutionLedgerRepositoryPort,
  evaluateEvidencePrecondition,
  type OperationContext,
  projectLedger,
  resolveTaskEvidence,
  scanTaskLedger,
  type TaskCapsuleRepositoryPort,
  TaskEvidenceScope,
} from "@v31m4/application";
import type { EvidenceRecord, ExecutionLedgerEntry, JobId, TaskId } from "@v31m4/domain";
import { resolveEvidencePrecondition } from "./evidence-precondition-catalog.js";
import type { SemanticOperationDefinition } from "./semantic-operation-catalog.js";

/**
 * The runtime half of evidence-conditioned effects: read authoritative state, evaluate the
 * deterministic predicate, and refuse before any authority is minted.
 *
 * It reads only what already decides things — the Task Capsule for the task class, the Execution
 * Ledger for observations and check results, and the Evidence store for immutable verdicts — and
 * it writes nothing at all. A gate that recorded its own conclusions would become a second
 * evidence authority, which is exactly what the architecture forbids.
 *
 * Fail-closed in both directions. An operation whose task has no capsule is refused rather than
 * treated as unconstrained, and an observation whose locator is absent from the caller's observed
 * fingerprints is not current — so an unobserved world denies instead of quietly satisfying.
 */
export interface EvidencePreconditionSources {
  readonly capsules: TaskCapsuleRepositoryPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
}

export interface EvidencePreconditionRequest {
  /** Read from the closed catalog by the authorization boundary, never from the caller. */
  readonly definition: SemanticOperationDefinition;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  /** Fingerprints of resources as observed now; anything absent is treated as not current. */
  readonly currentFingerprints: Readonly<Record<string, string>>;
}

export type EvidencePreconditionGate = (
  request: EvidencePreconditionRequest,
  context: OperationContext,
) => Promise<void>;

/**
 * True when no task class could ever add a requirement to this operation.
 *
 * Reads carry no base requirement and are excluded from the repair rule, so their verdict is known
 * without touching the database. That matters: every governed read passes through this gate, and
 * making the investigation path pay for a capsule and ledger scan it cannot fail would be a tax on
 * exactly the work the gate wants to encourage.
 */
function cannotBeGated(definition: SemanticOperationDefinition): boolean {
  return (
    definition.effectClass === "read" &&
    resolveEvidencePrecondition(definition, "execute").requirements.length === 0
  );
}

export function createEvidencePreconditionGate(
  sources: EvidencePreconditionSources,
): EvidencePreconditionGate {
  return async (request, context) => {
    if (cannotBeGated(request.definition)) return;

    const head = await sources.capsules.getHead(request.taskId, context);
    const capsule =
      head === null
        ? null
        : await sources.capsules.getRevision(request.taskId, head.value.capsuleRevision, context);
    if (capsule === null || capsule.fingerprint !== head?.value.fingerprint) {
      throw new ApplicationError(
        "POLICY_REJECTED",
        "There is no current task capsule to condition this effect against.",
        {
          retryable: false,
          details: { operationId: request.definition.operationId, taskId: request.taskId },
        },
      );
    }
    // Current scope binding. The request names a task and a job; the authoritative capsule decides
    // which job that task actually belongs to. A request that pairs a real task with someone else's
    // job would otherwise be gated against facts and evidence from a run it has nothing to do with.
    if (capsule.jobId !== request.jobId) {
      throw new ApplicationError(
        "POLICY_REJECTED",
        "This effect names a job the authoritative task capsule does not belong to.",
        {
          retryable: false,
          details: {
            operationId: request.definition.operationId,
            taskId: request.taskId,
            requestedJobId: request.jobId,
            capsuleJobId: capsule.jobId,
          },
        },
      );
    }

    const policy = resolveEvidencePrecondition(request.definition, capsule.phase);
    if (policy.requirements.length === 0) return;

    const history: ExecutionLedgerEntry[] = [];
    await scanTaskLedger(sources.ledger, request.taskId, context, (page) => {
      history.push(...page);
      return "continue";
    });
    const resolved = await resolveTaskEvidence(
      sources.evidence,
      [...capsule.verifiedEvidenceIds],
      context,
    );
    // The one authoritative evidence assessment, reused rather than restated: a record must exist,
    // have passed, belong to this project and job, and be about a subject this task owns. The same
    // call the transition policy and the Auditor make.
    const assessment = assessTaskEvidence(
      TaskEvidenceScope.of(capsule),
      [...capsule.verifiedEvidenceIds],
      resolved,
    );
    const verified = [...assessment.verifiedEvidenceIds]
      .map((id) => resolved.get(id))
      .filter((record): record is EvidenceRecord => record !== undefined);

    assertEvidencePreconditionSatisfied(
      evaluateEvidencePrecondition(policy, {
        taskId: request.taskId,
        jobId: request.jobId,
        history,
        projection: projectLedger(history),
        evidence: verified,
        currentFingerprints: request.currentFingerprints,
      }),
      request.definition.operationId,
    );
  };
}
