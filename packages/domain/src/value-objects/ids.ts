import { assertDomain } from "../domain-errors.js";

export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type ProjectId = Brand<string, "ProjectId">;
export type MissionId = Brand<string, "MissionId">;
export type RequirementId = Brand<string, "RequirementId">;
export type JobId = Brand<string, "JobId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type ClaimId = Brand<string, "ClaimId">;
export type TwinNodeId = Brand<string, "TwinNodeId">;
export type TwinEdgeId = Brand<string, "TwinEdgeId">;
export type CandidateId = Brand<string, "CandidateId">;
export type VerificationPlanId = Brand<string, "VerificationPlanId">;
export type VerificationResultId = Brand<string, "VerificationResultId">;
export type IssueId = Brand<string, "IssueId">;
export type RepairId = Brand<string, "RepairId">;
export type ChampionDecisionId = Brand<string, "ChampionDecisionId">;
export type DeliveryReceiptId = Brand<string, "DeliveryReceiptId">;
export type TrainingPacketId = Brand<string, "TrainingPacketId">;
export type CapabilityId = Brand<string, "CapabilityId">;
export type PracticeTaskId = Brand<string, "PracticeTaskId">;
export type PromotionId = Brand<string, "PromotionId">;
export type AvatarId = Brand<string, "AvatarId">;
export type AvatarItemId = Brand<string, "AvatarItemId">;
export type AchievementRuleId = Brand<string, "AchievementRuleId">;
export type PluginId = Brand<string, "PluginId">;
export type AdapterId = Brand<string, "AdapterId">;
export type ModelId = Brand<string, "ModelId">;
export type ToolId = Brand<string, "ToolId">;
export type EventId = Brand<string, "EventId">;
export type TaskId = Brand<string, "TaskId">;
export type SandboxId = Brand<string, "SandboxId">;
export type LedgerEntryId = Brand<string, "LedgerEntryId">;
export type SkillId = Brand<string, "SkillId">;
export type MemoryId = Brand<string, "MemoryId">;

type DurableId =
  | ProjectId
  | MissionId
  | RequirementId
  | JobId
  | CheckpointId
  | ArtifactId
  | EvidenceId
  | ClaimId
  | TwinNodeId
  | TwinEdgeId
  | CandidateId
  | VerificationPlanId
  | VerificationResultId
  | IssueId
  | RepairId
  | ChampionDecisionId
  | DeliveryReceiptId
  | TrainingPacketId
  | CapabilityId
  | PracticeTaskId
  | PromotionId
  | AvatarId
  | AvatarItemId
  | AchievementRuleId
  | PluginId
  | AdapterId
  | ModelId
  | ToolId
  | EventId
  | TaskId
  | SandboxId
  | LedgerEntryId
  | SkillId
  | MemoryId;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function parseDurableId<TId extends DurableId>(kind: string, value: string): TId {
  assertDomain(typeof value === "string", "INVALID_ID", `${kind} must be a string.`, { kind });
  assertDomain(value.length > 0, "INVALID_ID", `${kind} cannot be empty.`, { kind });
  assertDomain(value === value.trim(), "INVALID_ID", `${kind} cannot contain outer whitespace.`, {
    kind,
    value,
  });
  assertDomain(
    ID_PATTERN.test(value),
    "INVALID_ID",
    `${kind} must begin with an alphanumeric character and contain at most 128 alphanumeric, dot, underscore, colon, or hyphen characters.`,
    { kind, value },
  );
  return value as TId;
}

/**
 * Reports whether a value uses the one canonical durable-ID syntax. Exposed so entities can
 * validate opaque identifiers (workspace, DAG node, decision references) against exactly the
 * same rule the branded parsers use, rather than restating the pattern.
 */
export function isCanonicalDurableId(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && ID_PATTERN.test(value);
}

function createParser<TId extends DurableId>(kind: string) {
  return Object.freeze({
    parse(value: string): TId {
      return parseDurableId<TId>(kind, value);
    },
    is(value: unknown): value is TId {
      return typeof value === "string" && ID_PATTERN.test(value) && value === value.trim();
    },
  });
}

export const ProjectId = createParser<ProjectId>("ProjectId");
export const MissionId = createParser<MissionId>("MissionId");
export const RequirementId = createParser<RequirementId>("RequirementId");
export const JobId = createParser<JobId>("JobId");
export const CheckpointId = createParser<CheckpointId>("CheckpointId");
export const ArtifactId = createParser<ArtifactId>("ArtifactId");
export const EvidenceId = createParser<EvidenceId>("EvidenceId");
export const ClaimId = createParser<ClaimId>("ClaimId");
export const TwinNodeId = createParser<TwinNodeId>("TwinNodeId");
export const TwinEdgeId = createParser<TwinEdgeId>("TwinEdgeId");
export const CandidateId = createParser<CandidateId>("CandidateId");
export const VerificationPlanId = createParser<VerificationPlanId>("VerificationPlanId");
export const VerificationResultId = createParser<VerificationResultId>("VerificationResultId");
export const IssueId = createParser<IssueId>("IssueId");
export const RepairId = createParser<RepairId>("RepairId");
export const ChampionDecisionId = createParser<ChampionDecisionId>("ChampionDecisionId");
export const DeliveryReceiptId = createParser<DeliveryReceiptId>("DeliveryReceiptId");
export const TrainingPacketId = createParser<TrainingPacketId>("TrainingPacketId");
export const CapabilityId = createParser<CapabilityId>("CapabilityId");
export const PracticeTaskId = createParser<PracticeTaskId>("PracticeTaskId");
export const PromotionId = createParser<PromotionId>("PromotionId");
export const AvatarId = createParser<AvatarId>("AvatarId");
export const AvatarItemId = createParser<AvatarItemId>("AvatarItemId");
export const AchievementRuleId = createParser<AchievementRuleId>("AchievementRuleId");
export const PluginId = createParser<PluginId>("PluginId");
export const AdapterId = createParser<AdapterId>("AdapterId");
export const ModelId = createParser<ModelId>("ModelId");
export const ToolId = createParser<ToolId>("ToolId");
export const EventId = createParser<EventId>("EventId");
export const TaskId = createParser<TaskId>("TaskId");
export const SandboxId = createParser<SandboxId>("SandboxId");
export const LedgerEntryId = createParser<LedgerEntryId>("LedgerEntryId");
export const SkillId = createParser<SkillId>("SkillId");
export const MemoryId = createParser<MemoryId>("MemoryId");
