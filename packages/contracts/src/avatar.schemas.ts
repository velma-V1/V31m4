import { z } from "zod";
import {
  achievementRuleIdSchema,
  addDuplicateStringIssue,
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  avatarIdSchema,
  avatarItemIdSchema,
  canonicalNameSchema,
  capabilityIdSchema,
  evidenceIdSchema,
  isoDateTimeSchema,
  scoreSchema,
} from "./common.schemas.js";
import { evidenceKindSchema } from "./evidence.schemas.js";

export const avatarUnlockSchema = z
  .object({
    itemId: avatarItemIdSchema,
    achievementRuleId: achievementRuleIdSchema,
    evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
    unlockedAt: isoDateTimeSchema,
    permanent: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(value.evidenceIds, context, ["evidenceIds"], "Unlock evidence IDs");
  });

export const achievementRuleSchema = z
  .object({
    id: achievementRuleIdSchema,
    title: canonicalNameSchema,
    requiredCapabilityIds: z.array(capabilityIdSchema).min(1).max(1_000),
    minimumScores: z.record(capabilityIdSchema, scoreSchema),
    requiredEvidenceKinds: z.array(evidenceKindSchema).min(1).max(32),
    minimumIndependentVerifiers: z.number().int().min(1).max(1_000),
    forbiddenEvidenceSources: z.array(z.string().min(1).max(255)).max(1_000),
    unlockItemId: avatarItemIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.requiredCapabilityIds,
      context,
      ["requiredCapabilityIds"],
      "Required capability IDs",
    );
    addDuplicateStringIssue(
      value.requiredEvidenceKinds,
      context,
      ["requiredEvidenceKinds"],
      "Required evidence kinds",
    );
    addDuplicateStringIssue(
      value.forbiddenEvidenceSources,
      context,
      ["forbiddenEvidenceSources"],
      "Forbidden evidence sources",
    );
    const scoreIds = Object.keys(value.minimumScores);
    const required = new Set<string>(value.requiredCapabilityIds);
    if (scoreIds.some((capabilityId) => !required.has(capabilityId))) {
      context.addIssue({
        code: "custom",
        message: "Minimum scores may reference only required capabilities.",
        path: ["minimumScores"],
      });
    }
    if (
      value.requiredCapabilityIds.some(
        (capabilityId) => value.minimumScores[capabilityId] === undefined,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Every required capability needs a minimum score.",
        path: ["minimumScores"],
      });
    }
  });

export const avatarStateSchema = z
  .object({
    avatarId: avatarIdSchema,
    unlockedItemIds: z.array(avatarItemIdSchema).max(10_000),
    equippedItemIds: z.array(avatarItemIdSchema).max(10_000),
    evolutionStage: z.number().int().nonnegative().max(1_000_000),
    unlockHistory: z.array(avatarUnlockSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateStringIssue(
      value.unlockedItemIds,
      context,
      ["unlockedItemIds"],
      "Unlocked item IDs",
    );
    addDuplicateStringIssue(
      value.equippedItemIds,
      context,
      ["equippedItemIds"],
      "Equipped item IDs",
    );
    addDuplicateStringIssue(
      value.unlockHistory.map((unlock) => unlock.itemId),
      context,
      ["unlockHistory"],
      "Unlock history item IDs",
    );
    const unlocked = new Set(value.unlockedItemIds);
    if (value.equippedItemIds.some((itemId) => !unlocked.has(itemId))) {
      context.addIssue({
        code: "custom",
        message: "Only unlocked avatar items may be equipped.",
        path: ["equippedItemIds"],
      });
    }
    const historyIds = new Set(value.unlockHistory.map((unlock) => unlock.itemId));
    if (value.unlockedItemIds.some((itemId) => !historyIds.has(itemId))) {
      context.addIssue({
        code: "custom",
        message: "Every unlocked item requires an evidence-linked history record.",
        path: ["unlockHistory"],
      });
    }
  });

export const getAvatarRequestSchema = z.object({ ...apiRequestMetadataShape }).strict();
export const getAvatarResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    avatar: avatarStateSchema,
  })
  .strict();

export const equipAvatarItemRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    itemId: avatarItemIdSchema,
  })
  .strict();

export type AvatarUnlockPayload = z.infer<typeof avatarUnlockSchema>;
export type AchievementRulePayload = z.infer<typeof achievementRuleSchema>;
export type AvatarStatePayload = z.infer<typeof avatarStateSchema>;
export type GetAvatarResponse = z.infer<typeof getAvatarResponseSchema>;
export type EquipAvatarItemRequest = z.infer<typeof equipAvatarItemRequestSchema>;
