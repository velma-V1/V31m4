import type { ContentHash, EvidenceRecord, ExecutionLedgerEntry, TaskCapsule } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type { ExecutionLedgerRepositoryPort } from "../ports/execution-ledger-repository.port.js";
import {
  assertEntryAcceptanceContract,
  detectAcceptanceWeakening,
  type EntryAcceptanceSnapshot,
  freezeEntryAcceptanceSnapshot,
} from "../services/entry-acceptance-snapshot.js";
import { assessTaskEvidence, TaskEvidenceScope } from "../services/task-transition-policy.js";
import {
  isEntryStillValid,
  type LedgerProjection,
  projectLedger,
  scanTaskLedger,
} from "./reconcile-execution-effect.js";
import { resolveTaskEvidence } from "./task-evidence.js";

/**
 * The Auditor: an independent, deterministic judgement of one bounded result against the contract
 * that was frozen before the work began.
 *
 * Three properties matter and each is structural rather than a matter of discipline.
 *
 * First, it judges the *frozen* contract. The fingerprint it was dispatched with is checked before
 * anything else, and the contract is recompiled from the current capsule and the workspace as
 * observed now, so a task that quietly dropped a criterion or a prohibition after the
 * implementation was seen — or moved the work into a different workspace — is a rejection rather
 * than an easier pass.
 *
 * Second, it never reads model output. There is no field on this command through which an
 * Executor's summary, transcript, or reasoning could arrive — only the capsule, the frozen
 * contract, the authoritative Evidence store, and the Execution Ledger.
 *
 * Third, it writes nothing. An audit is a verdict; recording its consequence is a separate governed
 * transition that a caller performs afterwards, under the existing transition policy.
 */
export interface AuditTaskResultDependencies {
  readonly evidence: EvidenceRepositoryPort;
  readonly ledger: ExecutionLedgerRepositoryPort;
}

export interface AuditTaskResultCommand {
  readonly snapshot: EntryAcceptanceSnapshot;
  /** What the Auditor was dispatched against; proves the contract was not swapped. */
  readonly expectedContractFingerprint: ContentHash;
  /** The current authoritative revision, which may have advanced during execution. */
  readonly capsule: TaskCapsule;
  /**
   * The workspace the audited result actually lives in, observed now.
   *
   * Its identity is part of the frozen contract and may not be rebound; its contents are expected
   * to differ, because that is what the Executor was for.
   */
  readonly workspace: AuditedWorkspace;
  readonly currentFingerprints: Readonly<Record<string, string>>;
  /** Workspace-relative paths the change touched, for the forbidden-change prohibition. */
  readonly changedPaths: readonly string[];
  /**
   * How the Executor's run ended. Deliberately the *outcome kind* and nothing else: `finish` is a
   * claim of readiness, never of success, and no summary text accompanies it here.
   */
  readonly executorOutcome: "ready_for_verification" | "deferred" | "stopped";
}

export interface AuditedWorkspace {
  readonly workspaceId: string | null;
  readonly workspaceFingerprint: ContentHash | null;
}

export type AuditVerdict = Readonly<{
  kind: "accepted" | "rejected";
  contractFingerprint: ContentHash;
  reasons: readonly string[];
}>;

const MAX_REASONS = 64;

function latestValidCheck(
  history: readonly ExecutionLedgerEntry[],
  projection: LedgerProjection,
  checkName: string,
  currentFingerprints: Readonly<Record<string, string>>,
): ExecutionLedgerEntry | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry === undefined || entry.kind !== "check_result" || entry.checkName !== checkName) {
      continue;
    }
    if (isEntryStillValid(projection, entry, currentFingerprints)) return entry;
  }
  return null;
}

function auditChecks(
  snapshot: EntryAcceptanceSnapshot,
  history: readonly ExecutionLedgerEntry[],
  projection: LedgerProjection,
  currentFingerprints: Readonly<Record<string, string>>,
  reasons: string[],
): void {
  for (const checkName of snapshot.requiredChecks) {
    const result = latestValidCheck(history, projection, checkName, currentFingerprints);
    if (result === null) {
      reasons.push(`required check ${checkName} has no current result`);
      continue;
    }
    if (result.kind === "check_result" && !result.passed) {
      reasons.push(`required check ${checkName} failed`);
    }
  }
}

function auditEvidence(
  snapshot: EntryAcceptanceSnapshot,
  capsule: TaskCapsule,
  resolved: ReadonlyMap<string, EvidenceRecord>,
  reasons: string[],
): void {
  // The one authoritative evidence assessment, reused rather than restated: a record must exist,
  // have passed, belong to this project and job, and be about a subject this task owns.
  const assessment = assessTaskEvidence(
    TaskEvidenceScope.of(capsule),
    [...capsule.verifiedEvidenceIds],
    resolved,
  );
  const verified = [...assessment.verifiedEvidenceIds]
    .map((id) => resolved.get(id))
    .filter((record): record is EvidenceRecord => record !== undefined);

  for (const criterionId of snapshot.acceptanceCriterionIds) {
    if (!verified.some((record) => record.subjectId === criterionId)) {
      reasons.push(`acceptance criterion ${criterionId} has no verified passing evidence`);
    }
  }
  for (const kind of snapshot.requiredEvidenceKinds) {
    if (!verified.some((record) => record.kind === kind)) {
      reasons.push(`required evidence kind ${kind} is absent`);
    }
  }
}

/** A change is forbidden when it is, or sits under, a path the contract prohibits. */
function auditForbiddenChanges(
  snapshot: EntryAcceptanceSnapshot,
  changedPaths: readonly string[],
  reasons: string[],
): void {
  for (const changed of changedPaths) {
    for (const forbidden of snapshot.forbiddenChanges) {
      if (changed === forbidden || changed.startsWith(`${forbidden}/`)) {
        reasons.push(`forbidden change touched ${changed}`);
      }
    }
  }
}

export async function auditTaskResult(
  dependencies: AuditTaskResultDependencies,
  command: AuditTaskResultCommand,
  context: OperationContext,
): Promise<AuditVerdict> {
  const { snapshot, capsule } = command;
  // Before any evidence is read: this must be the contract this Auditor was dispatched against.
  assertEntryAcceptanceContract(snapshot, command.expectedContractFingerprint);

  const reasons: string[] = [];

  // Recompiled from the capsule as it stands now, with the contract's own declared requirements.
  // Anything the task gave up after the work was seen shows here.
  const recompiled = freezeEntryAcceptanceSnapshot({
    capsule,
    requiredChecks: snapshot.requiredChecks,
    requiredEvidenceKinds: snapshot.requiredEvidenceKinds,
    riskPolicyIds: snapshot.riskPolicyIds,
    // Observed, never copied from the contract being judged: copying it forward would make
    // workspace drift structurally invisible to the very check meant to catch it.
    workspaceFingerprint: command.workspace.workspaceFingerprint,
    frozenAt: snapshot.frozenAt,
  });
  for (const weakened of detectAcceptanceWeakening(snapshot, recompiled)) {
    reasons.push(`the task was redefined more weakly after the contract was frozen: ${weakened}`);
  }
  if (command.workspace.workspaceId !== snapshot.workspaceId) {
    reasons.push(
      `the audited workspace ${command.workspace.workspaceId ?? "(none)"} is not the workspace the contract was frozen against`,
    );
  }

  if (command.executorOutcome !== "ready_for_verification") {
    reasons.push(`the executor ended as ${command.executorOutcome}, not ready for verification`);
  }

  const history: ExecutionLedgerEntry[] = [];
  await scanTaskLedger(dependencies.ledger, capsule.taskId, context, (page) => {
    history.push(...page);
    return "continue";
  });
  const projection = projectLedger(history);

  for (const attempt of projection.attempts) {
    if (attempt.outcome === "confirmed" || attempt.outcome === "not_applied") continue;
    reasons.push(`effect attempt ${attempt.attemptEntryId} is unreconciled (${attempt.outcome})`);
  }

  auditChecks(snapshot, history, projection, command.currentFingerprints, reasons);
  auditEvidence(
    snapshot,
    capsule,
    await resolveTaskEvidence(dependencies.evidence, [...capsule.verifiedEvidenceIds], context),
    reasons,
  );
  auditForbiddenChanges(snapshot, command.changedPaths, reasons);

  if (reasons.length > MAX_REASONS) {
    reasons.splice(MAX_REASONS, reasons.length - MAX_REASONS, "further findings were elided");
  }
  return Object.freeze({
    kind: reasons.length === 0 ? ("accepted" as const) : ("rejected" as const),
    contractFingerprint: snapshot.contractFingerprint,
    reasons: Object.freeze([...reasons]),
  });
}
