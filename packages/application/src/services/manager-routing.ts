import type { ExecutionLedgerEntry } from "@v31m4/domain";
import {
  isEntryStillValid,
  type LedgerProjection,
} from "../use-cases/reconcile-execution-effect.js";
import type { EntryAcceptanceSnapshot } from "./entry-acceptance-snapshot.js";

/**
 * Deterministic-first Manager routing.
 *
 * Before a model turn is requested, the Manager asks whether the next bounded step is already
 * decided by machinery V31M4 owns: the frozen acceptance contract says which deterministic checks
 * must pass, and the Execution Ledger says which of them currently do. A model is worth spending
 * only where adaptive reasoning materially helps — in practice, diagnosing a check that genuinely
 * failed, or advancing a task whose contract declares no deterministic requirement at all.
 *
 * This introduces no authority. A route says which governed path runs next; it never says what is
 * permitted, and every path it can select is still bounded by policy, role, and evidence gates it
 * has no ability to influence. Deciding differently could waste a model turn; it could not widen
 * what the system may do.
 *
 * Pure: no clock, no randomness, no I/O.
 */
export type ManagerRoute =
  | Readonly<{ kind: "deterministic_check"; checkName: string; reason: string }>
  | Readonly<{ kind: "model_turn"; reason: string }>
  | Readonly<{ kind: "audit"; reason: string }>
  | Readonly<{ kind: "blocked"; reason: string }>;

export interface ManagerRoutingInput {
  readonly snapshot: EntryAcceptanceSnapshot;
  readonly projection: LedgerProjection;
  /**
   * The task's `check_result` entries in append order. Supplied separately because a projection
   * folds validity, not check names and outcomes, and extending it would change what Task 3 froze.
   */
  readonly checkResults: readonly ExecutionLedgerEntry[];
  /** Dependency-ready DAG nodes, already computed from the authoritative capsule. */
  readonly readyNodeIds: readonly string[];
  /** Current fingerprints of observed resources, so a stale check is not read as an answer. */
  readonly currentFingerprints: Readonly<Record<string, string>>;
}

/**
 * The newest still-current result for one check, or `null` when the check has no usable answer.
 *
 * Newest wins because a later run supersedes an earlier one, and currency is decided by the
 * canonical `isEntryStillValid` rule rather than by a second staleness notion: a result whose
 * observed resources moved, or whose premise was invalidated, is not an answer.
 */
function currentResultFor(
  input: ManagerRoutingInput,
  checkName: string,
): ExecutionLedgerEntry | null {
  for (let index = input.checkResults.length - 1; index >= 0; index -= 1) {
    const entry = input.checkResults[index];
    if (entry === undefined || entry.kind !== "check_result" || entry.checkName !== checkName) {
      continue;
    }
    if (isEntryStillValid(input.projection, entry, input.currentFingerprints)) return entry;
  }
  return null;
}

/** An attempt whose effect is not settled blocks further work until it is reconciled. */
function unreconciledAttempt(projection: LedgerProjection): string | null {
  for (const attempt of projection.attempts) {
    if (attempt.outcome === "confirmed" || attempt.outcome === "not_applied") continue;
    return attempt.attemptEntryId;
  }
  return null;
}

export function routeNextStep(input: ManagerRoutingInput): ManagerRoute {
  if (input.readyNodeIds.length === 0) {
    return Object.freeze({
      kind: "blocked" as const,
      reason: "no dependency-ready node is available in this task's DAG",
    });
  }
  // Before anything else: an effect that may or may not have landed makes every later decision
  // unsound, and settling it is deterministic work that no model may pre-empt.
  const unreconciled = unreconciledAttempt(input.projection);
  if (unreconciled !== null) {
    return Object.freeze({
      kind: "blocked" as const,
      reason: `effect attempt ${unreconciled} is unreconciled and must be settled before further work`,
    });
  }

  const { requiredChecks } = input.snapshot;
  if (requiredChecks.length === 0) {
    return Object.freeze({
      kind: "model_turn" as const,
      reason:
        "the acceptance contract declares no required deterministic check, so the next step is not determined by machinery alone",
    });
  }

  const failed: string[] = [];
  for (const checkName of requiredChecks) {
    const result = currentResultFor(input, checkName);
    if (result === null) {
      // Deterministic and sufficient: run it. This is the branch that must win by default.
      return Object.freeze({
        kind: "deterministic_check" as const,
        checkName,
        reason: `required check ${checkName} has no current result and can be answered deterministically`,
      });
    }
    if (result.kind === "check_result" && !result.passed) failed.push(checkName);
  }

  if (failed.length > 0) {
    // Every deterministic answer is in and one of them is a real failure. Diagnosing why is where
    // adaptive reasoning actually earns its turn.
    return Object.freeze({
      kind: "model_turn" as const,
      reason: `required check ${failed.join(", ")} failed and needs diagnosis`,
    });
  }

  return Object.freeze({
    kind: "audit" as const,
    reason: "every required deterministic check currently passes; the result is ready for audit",
  });
}
