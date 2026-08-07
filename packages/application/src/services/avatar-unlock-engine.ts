import {
  type AchievementRule,
  AvatarState,
  type AvatarState as AvatarStateType,
  type EvidenceKind,
} from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { stableSortBy } from "./internal/deterministic.js";

/**
 * Avatar Unlock Engine.
 *
 * Evaluates permanent, evidence-backed capability-avatar unlocks against achievement
 * rules. A rule unlocks only when every capability threshold is met and independent,
 * verified, non-revoked evidence covers every required kind. Model claims and
 * unverified practice never unlock. Previous permanent unlocks are preserved, locked
 * items are never equipped, unlock order is deterministic, and evolution stage advances
 * only when an unlock is earned.
 */

export interface UnlockEvidence {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly verifierId: string;
  readonly source: string;
  readonly verified: boolean;
  readonly revoked: boolean;
}

export interface AvatarUnlockEngineInput {
  readonly state: AvatarStateType;
  readonly rules: readonly AchievementRule[];
  readonly capabilityScores: Readonly<Record<string, number>>;
  readonly evidenceByRule: Readonly<Record<string, readonly UnlockEvidence[]>>;
  readonly now: string;
  readonly autoEquipRuleIds?: readonly string[];
}

export type RuleRejectionReason =
  | "already_unlocked"
  | "capability_below_threshold"
  | "no_valid_evidence"
  | "missing_required_evidence_kind"
  | "insufficient_independent_verifiers";

export interface RejectedRule {
  readonly ruleId: string;
  readonly reason: RuleRejectionReason;
  readonly detail: string;
}

export interface AppliedUnlock {
  readonly itemId: string;
  readonly achievementRuleId: string;
  readonly evidenceIds: readonly string[];
  readonly equipped: boolean;
}

export interface AvatarUnlockResult {
  readonly nextState: AvatarStateType;
  readonly unlocked: readonly AppliedUnlock[];
  readonly rejected: readonly RejectedRule[];
  readonly evolutionStage: number;
}

const MODEL_CLAIM_SOURCE = "model_claim";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

interface RuleEvaluation {
  readonly ok: boolean;
  readonly reason?: RuleRejectionReason;
  readonly detail?: string;
  readonly evidenceIds: readonly string[];
}

function dedupeEvidence(evidence: readonly UnlockEvidence[]): UnlockEvidence[] {
  const seen = new Set<string>();
  const unique: UnlockEvidence[] = [];
  for (const record of evidence) {
    if (!seen.has(record.evidenceId)) {
      seen.add(record.evidenceId);
      unique.push(record);
    }
  }
  return unique;
}

function evaluateRule(
  rule: AchievementRule,
  input: AvatarUnlockEngineInput,
  unlockedItemIds: ReadonlySet<string>,
): RuleEvaluation {
  if (unlockedItemIds.has(rule.unlockItemId)) {
    return {
      ok: false,
      reason: "already_unlocked",
      detail: "Item is already permanently unlocked.",
      evidenceIds: [],
    };
  }

  for (const capabilityId of rule.requiredCapabilityIds) {
    const score = input.capabilityScores[capabilityId];
    const minimum = rule.minimumScores[capabilityId] ?? 0;
    if (score === undefined || !Number.isFinite(score) || score < minimum) {
      return {
        ok: false,
        reason: "capability_below_threshold",
        detail: `Capability ${capabilityId} score ${score ?? "missing"} is below the required ${minimum}.`,
        evidenceIds: [],
      };
    }
  }

  const forbidden = new Set(rule.forbiddenEvidenceSources);
  const valid = dedupeEvidence(input.evidenceByRule[rule.id] ?? []).filter(
    (record) =>
      record.verified &&
      !record.revoked &&
      record.source !== MODEL_CLAIM_SOURCE &&
      !forbidden.has(record.source),
  );
  if (valid.length === 0) {
    return {
      ok: false,
      reason: "no_valid_evidence",
      detail: "No verified, non-revoked, permitted evidence.",
      evidenceIds: [],
    };
  }

  const coveredKinds = new Set(valid.map((record) => record.kind));
  const missingKind = rule.requiredEvidenceKinds.find((kind) => !coveredKinds.has(kind));
  if (missingKind !== undefined) {
    return {
      ok: false,
      reason: "missing_required_evidence_kind",
      detail: `Missing required evidence kind ${missingKind}.`,
      evidenceIds: [],
    };
  }

  const distinctVerifiers = new Set(valid.map((record) => record.verifierId));
  if (distinctVerifiers.size < rule.minimumIndependentVerifiers) {
    return {
      ok: false,
      reason: "insufficient_independent_verifiers",
      detail: `Need ${rule.minimumIndependentVerifiers} independent verifiers; found ${distinctVerifiers.size}.`,
      evidenceIds: [],
    };
  }

  return { ok: true, evidenceIds: [...valid.map((record) => record.evidenceId)].sort() };
}

/** Evaluates achievement rules and applies earned permanent unlocks deterministically. */
export function evaluateAvatarUnlocks(input: AvatarUnlockEngineInput): AvatarUnlockResult {
  if (!ISO_PATTERN.test(input.now)) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "now must be canonical UTC ISO-8601 with milliseconds.",
    );
  }
  const ruleIds = new Set<string>();
  for (const rule of input.rules) {
    if (ruleIds.has(rule.id)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Duplicate achievement rule id.", {
        details: { ruleId: rule.id },
      });
    }
    ruleIds.add(rule.id);
  }

  const autoEquip = new Set(input.autoEquipRuleIds ?? []);
  const orderedRules = stableSortBy([...input.rules], (rule) => rule.id);

  let state = input.state;
  const unlocked: AppliedUnlock[] = [];
  const rejected: RejectedRule[] = [];

  for (const rule of orderedRules) {
    const unlockedItemIds = new Set(state.unlockedItemIds);
    const evaluation = evaluateRule(rule, input, unlockedItemIds);
    if (!evaluation.ok) {
      rejected.push(
        Object.freeze({
          ruleId: rule.id,
          reason: evaluation.reason as RuleRejectionReason,
          detail: evaluation.detail ?? "",
        }),
      );
      continue;
    }
    state = AvatarState.unlock(state, {
      itemId: rule.unlockItemId,
      achievementRuleId: rule.id,
      evidenceIds: evaluation.evidenceIds,
      unlockedAt: input.now,
    });
    let equipped = false;
    if (autoEquip.has(rule.id)) {
      state = AvatarState.equip(state, rule.unlockItemId);
      equipped = true;
    }
    unlocked.push(
      Object.freeze({
        itemId: rule.unlockItemId,
        achievementRuleId: rule.id,
        evidenceIds: Object.freeze([...evaluation.evidenceIds]),
        equipped,
      }),
    );
  }

  return Object.freeze({
    nextState: state,
    unlocked: Object.freeze(unlocked),
    rejected: Object.freeze(stableSortBy(rejected, (entry) => entry.ruleId)),
    evolutionStage: state.evolutionStage,
  });
}

export const AvatarUnlockEngine = Object.freeze({ evaluate: evaluateAvatarUnlocks });
