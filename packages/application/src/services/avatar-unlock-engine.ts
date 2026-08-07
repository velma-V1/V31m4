import { AvatarState, type AchievementRule, type AvatarState as AvatarStateType, type CapabilityProfile, type EvidenceRecord } from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";

export interface AvatarUnlockEvaluationInput {
  readonly state: AvatarStateType;
  readonly rules: readonly AchievementRule[];
  readonly capabilities: readonly CapabilityProfile[];
  readonly evidence: readonly EvidenceRecord[];
  readonly evaluatedAt: string;
}

export interface AvatarUnlockEvaluation {
  readonly state: AvatarStateType;
  readonly unlockedItemIds: readonly string[];
  readonly rejectedRuleIds: readonly string[];
}

export function evaluateAvatarUnlocks(input: AvatarUnlockEvaluationInput): AvatarUnlockEvaluation {
  const capabilityById = new Map(input.capabilities.map((profile) => [String(profile.capabilityId), profile]));
  const evidenceById = new Map(input.evidence.map((record) => [String(record.id), record]));
  assertApplication(evidenceById.size === input.evidence.length, "INTEGRITY_FAILURE", "Evidence IDs must be unique during avatar evaluation.");
  let state = input.state;
  const unlocked: string[] = [];
  const rejected: string[] = [];
  const orderedRules = [...input.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)));

  for (const rule of orderedRules) {
    if (state.unlockedItemIds.includes(rule.unlockItemId)) continue;
    const capabilitySatisfied = rule.requiredCapabilityIds.every((capabilityId) => {
      const profile = capabilityById.get(String(capabilityId));
      const minimum = rule.minimumScores[String(capabilityId)];
      return profile !== undefined && minimum !== undefined && profile.current.score >= minimum;
    });
    const uniqueEvidence = rule.requiredCapabilityIds.flatMap((capabilityId) => {
      const evidenceIds = capabilityById.get(String(capabilityId))?.current.evidenceIds ?? [];
      return [...new Set(evidenceIds.map(String))]
        .map((id) => evidenceById.get(id))
        .filter(
          (record): record is EvidenceRecord =>
            record !== undefined &&
            record.status === "passed" &&
            record.subjectType === "capability" &&
            record.subjectId === String(capabilityId),
        );
    });
    const kinds = new Set(uniqueEvidence.map((record) => record.kind));
    const verifiers = new Set(uniqueEvidence.map((record) => record.verifierId));
    const sourceAllowed = uniqueEvidence.every((record) => !rule.forbiddenEvidenceSources.includes(record.verifierId));
    const evidenceSatisfied = rule.requiredEvidenceKinds.every((kind) => kinds.has(kind)) &&
      verifiers.size >= rule.minimumIndependentVerifiers && sourceAllowed && uniqueEvidence.length > 0;
    if (!capabilitySatisfied || !evidenceSatisfied) {
      rejected.push(String(rule.id));
      continue;
    }
    state = AvatarState.unlock(state, {
      itemId: rule.unlockItemId,
      achievementRuleId: rule.id,
      evidenceIds: uniqueEvidence.map((record) => String(record.id)),
      unlockedAt: input.evaluatedAt,
    });
    unlocked.push(String(rule.unlockItemId));
  }
  return Object.freeze({ state, unlockedItemIds: Object.freeze(unlocked), rejectedRuleIds: Object.freeze(rejected) });
}
