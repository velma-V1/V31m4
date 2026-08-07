import { AvatarState, type AchievementRule, type AvatarId, type AvatarState as AvatarStateType } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { CapabilityRepositoryPort } from "../ports/capability-repository.port.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { WriteConditions, type Versioned } from "../port-types.js";
import { collectPortPages } from "./use-case-support.js";
import { evaluateAvatarUnlocks } from "../services/avatar-unlock-engine.js";

export interface EvaluateAvatarUnlocksDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly capabilities: CapabilityRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly clock: ClockPort;
}

export async function evaluateAvatarUnlocksUseCase(
  dependencies: EvaluateAvatarUnlocksDependencies,
  avatarId: AvatarId,
  rules: readonly AchievementRule[],
  context: OperationContext,
): Promise<Versioned<AvatarStateType>> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const stored = await dependencies.capabilities.getAvatar(avatarId, context, transaction);
    const state = stored?.value ?? AvatarState.create(avatarId);
    const profiles = await collectPortPages((cursor) =>
      dependencies.capabilities.listProfiles(cursor === undefined ? { limit: 500 } : { limit: 500, cursor }, context, transaction),
    );
    const evidence = await collectPortPages((cursor) =>
      dependencies.evidence.list(cursor === undefined
        ? { limit: 10_000, statuses: ["passed"] }
        : { limit: 10_000, cursor, statuses: ["passed"] }, context, transaction),
    );
    const evaluated = evaluateAvatarUnlocks({
      state,
      rules,
      capabilities: profiles.map((item) => item.value),
      evidence: evidence.map((item) => item.value),
      evaluatedAt: dependencies.clock.now(),
    });
    return dependencies.capabilities.saveAvatar(
      evaluated.state,
      stored === null ? WriteConditions.mustNotExist() : WriteConditions.matchRevision(stored.revision),
      context,
      transaction,
    );
  });
}
