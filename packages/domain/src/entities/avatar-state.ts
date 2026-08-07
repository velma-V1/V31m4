import { assertDomain } from "../domain-errors.js";
import {
  AchievementRuleId,
  type AchievementRuleId as AchievementRuleIdType,
  AvatarId,
  type AvatarId as AvatarIdType,
  AvatarItemId,
  type AvatarItemId as AvatarItemIdType,
  CapabilityId,
  type CapabilityId as CapabilityIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
} from "../value-objects/ids.js";
import type { EvidenceKind } from "./evidence-record.js";

export interface AvatarUnlock {
  readonly itemId: AvatarItemIdType;
  readonly achievementRuleId: AchievementRuleIdType;
  readonly evidenceIds: readonly EvidenceIdType[];
  readonly unlockedAt: string;
  readonly permanent: true;
}

export interface AvatarState {
  readonly avatarId: AvatarIdType;
  readonly unlockedItemIds: readonly AvatarItemIdType[];
  readonly equippedItemIds: readonly AvatarItemIdType[];
  readonly evolutionStage: number;
  readonly unlockHistory: readonly AvatarUnlock[];
}

export interface AchievementRule {
  readonly id: AchievementRuleIdType;
  readonly title: string;
  readonly requiredCapabilityIds: readonly CapabilityIdType[];
  readonly minimumScores: Readonly<Record<string, number>>;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly minimumIndependentVerifiers: number;
  readonly forbiddenEvidenceSources: readonly string[];
  readonly unlockItemId: AvatarItemIdType;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const AvatarState = Object.freeze({
  create(avatarId: string): AvatarState {
    return Object.freeze({
      avatarId: AvatarId.parse(avatarId),
      unlockedItemIds: Object.freeze([]),
      equippedItemIds: Object.freeze([]),
      evolutionStage: 0,
      unlockHistory: Object.freeze([]),
    });
  },

  createRule(input: {
    readonly id: string;
    readonly title: string;
    readonly requiredCapabilityIds: readonly string[];
    readonly minimumScores: Readonly<Record<string, number>>;
    readonly requiredEvidenceKinds: readonly EvidenceKind[];
    readonly minimumIndependentVerifiers: number;
    readonly forbiddenEvidenceSources?: readonly string[];
    readonly unlockItemId: string;
  }): AchievementRule {
    assertDomain(
      input.title.length > 0 && input.title === input.title.trim() && input.title.length <= 240,
      "INVALID_AVATAR_STATE",
      "Achievement rule title must be canonical.",
    );
    const capabilities = input.requiredCapabilityIds.map((id) => CapabilityId.parse(id));
    assertDomain(
      capabilities.length > 0 && new Set(capabilities).size === capabilities.length,
      "INVALID_AVATAR_STATE",
      "Achievement rules require unique capabilities.",
    );
    const scores = { ...input.minimumScores };
    assertDomain(
      Object.keys(scores).length > 0 &&
        Object.entries(scores).every(
          ([id, score]) =>
            capabilities.includes(CapabilityId.parse(id)) &&
            Number.isFinite(score) &&
            score >= 0 &&
            score <= 1,
        ),
      "INVALID_AVATAR_STATE",
      "Achievement minimum scores must map required capabilities to values between 0 and 1.",
    );
    assertDomain(
      input.requiredEvidenceKinds.length > 0 &&
        new Set(input.requiredEvidenceKinds).size === input.requiredEvidenceKinds.length,
      "INVALID_AVATAR_STATE",
      "Achievement rules require unique evidence kinds.",
    );
    assertDomain(
      Number.isSafeInteger(input.minimumIndependentVerifiers) &&
        input.minimumIndependentVerifiers > 0,
      "INVALID_AVATAR_STATE",
      "Achievement rules require at least one independent verifier.",
    );
    const forbidden = (input.forbiddenEvidenceSources ?? []).map((value) => value.trim());
    assertDomain(
      forbidden.every((value) => value.length > 0) && new Set(forbidden).size === forbidden.length,
      "INVALID_AVATAR_STATE",
      "Forbidden evidence sources must be unique canonical strings.",
    );
    return Object.freeze({
      id: AchievementRuleId.parse(input.id),
      title: input.title,
      requiredCapabilityIds: Object.freeze(capabilities),
      minimumScores: Object.freeze(scores),
      requiredEvidenceKinds: Object.freeze([...input.requiredEvidenceKinds]),
      minimumIndependentVerifiers: input.minimumIndependentVerifiers,
      forbiddenEvidenceSources: Object.freeze(forbidden),
      unlockItemId: AvatarItemId.parse(input.unlockItemId),
    });
  },

  unlock(
    state: AvatarState,
    input: {
      readonly itemId: string;
      readonly achievementRuleId: string;
      readonly evidenceIds: readonly string[];
      readonly unlockedAt: string;
    },
  ): AvatarState {
    const parsed = Date.parse(input.unlockedAt);
    assertDomain(
      ISO_PATTERN.test(input.unlockedAt) &&
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString() === input.unlockedAt,
      "INVALID_AVATAR_STATE",
      "Avatar unlock time must be canonical UTC ISO-8601 with milliseconds.",
    );
    const itemId = AvatarItemId.parse(input.itemId);
    assertDomain(
      !state.unlockedItemIds.includes(itemId),
      "INVALID_STATE_TRANSITION",
      "Avatar item is already unlocked.",
    );
    const evidenceIds = input.evidenceIds.map((id) => EvidenceId.parse(id));
    assertDomain(
      evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_AVATAR_STATE",
      "Avatar unlocks require unique evidence.",
    );
    const unlock: AvatarUnlock = Object.freeze({
      itemId,
      achievementRuleId: AchievementRuleId.parse(input.achievementRuleId),
      evidenceIds: Object.freeze(evidenceIds),
      unlockedAt: input.unlockedAt,
      permanent: true as const,
    });
    return Object.freeze({
      ...state,
      unlockedItemIds: Object.freeze([...state.unlockedItemIds, itemId]),
      evolutionStage: state.evolutionStage + 1,
      unlockHistory: Object.freeze([...state.unlockHistory, unlock]),
    });
  },

  equip(state: AvatarState, itemIdInput: string): AvatarState {
    const itemId = AvatarItemId.parse(itemIdInput);
    assertDomain(
      state.unlockedItemIds.includes(itemId),
      "INVALID_STATE_TRANSITION",
      "Only unlocked avatar items can be equipped.",
    );
    if (state.equippedItemIds.includes(itemId)) {
      return state;
    }
    return Object.freeze({
      ...state,
      equippedItemIds: Object.freeze([...state.equippedItemIds, itemId]),
    });
  },

  unequip(state: AvatarState, itemIdInput: string): AvatarState {
    const itemId = AvatarItemId.parse(itemIdInput);
    return Object.freeze({
      ...state,
      equippedItemIds: Object.freeze(state.equippedItemIds.filter((id) => id !== itemId)),
    });
  },
});
