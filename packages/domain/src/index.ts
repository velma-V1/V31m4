export {
  DomainError,
  assertDomain,
  isDomainError,
  type DomainErrorCode,
  type DomainErrorDetails,
} from "./domain-errors.js";
export {
  createDomainEvent,
  type CreateDomainEventInput,
  type DomainEvent,
  type DomainEventValue,
} from "./domain-events.js";
export {
  AchievementRuleId,
  AdapterId,
  ArtifactId,
  AvatarId,
  AvatarItemId,
  CandidateId,
  CapabilityId,
  ChampionDecisionId,
  CheckpointId,
  ClaimId,
  DeliveryReceiptId,
  EventId,
  EvidenceId,
  IssueId,
  JobId,
  MissionId,
  ModelId,
  PluginId,
  PracticeTaskId,
  ProjectId,
  PromotionId,
  RepairId,
  RequirementId,
  ToolId,
  TrainingPacketId,
  TwinEdgeId,
  TwinNodeId,
  VerificationPlanId,
  VerificationResultId,
  type Brand,
} from "./value-objects/ids.js";
export { ContentHash } from "./value-objects/content-hash.js";
export { SafePath } from "./value-objects/safe-path.js";
export { Score } from "./value-objects/score.js";
export { ResourceBudget } from "./value-objects/resource-budget.js";
export {
  Project,
  type CreateProjectInput,
  type ProjectStatus,
} from "./entities/project.js";
export {
  Requirement,
  type CreateRequirementInput,
  type RequirementPriority,
  type RequirementSource,
} from "./entities/requirement.js";
export {
  MissionContract,
  type AcceptanceCriterion,
  type CreateMissionContractInput,
  type EvidenceRequirement,
  type ForbiddenChange,
  type MissionConstraint,
  type RequiredOutput,
} from "./entities/mission-contract.js";
export {
  Job,
  type CreateJobInput,
  type JobStatus,
  type JobTransitionContext,
  type JobTransitionResult,
} from "./entities/job.js";
export { Checkpoint, type CreateCheckpointInput } from "./entities/checkpoint.js";
export {
  Artifact,
  type ArtifactKind,
  type CreateArtifactInput,
} from "./entities/artifact.js";
export {
  EvidenceRecord,
  type CreateEvidenceRecordInput,
  type EvidenceKind,
  type EvidenceStatus,
} from "./entities/evidence-record.js";
export { Claim, type ClaimStatus, type CreateClaimInput } from "./entities/claim.js";
export {
  ProductionTwin,
  type ProductionTwinEdge,
  type ProductionTwinNode,
  type TwinEdgeKind,
  type TwinNodeKind,
} from "./entities/production-twin.js";
export {
  CapabilityProfile,
  type CapabilityScore,
} from "./entities/capability-profile.js";
export {
  ModelProfile,
  type ProfileAvailability,
} from "./entities/model-profile.js";
export {
  ToolProfile,
  type ToolAutomationMethod,
} from "./entities/tool-profile.js";
export {
  PluginProfile,
  type PluginStatus,
} from "./entities/plugin-profile.js";
export {
  SolverCandidate,
  type CreateCandidateInput,
  type SolverConfiguration,
  type SolverConfigurationInput,
  type SolverStrategy,
} from "./entities/solver-candidate.js";
export {
  VerificationResult,
  type CompletedVerificationCheck,
  type VerificationCheck,
  type VerificationPlan,
} from "./entities/verification-result.js";
export {
  IssueRecord,
  type IssueSeverity,
  type IssueStatus,
} from "./entities/issue-record.js";
export { RepairRecord, type RepairStatus } from "./entities/repair-record.js";
export {
  ChampionDecision,
  type DecisionDimension,
  type DecisionReason,
} from "./entities/champion-decision.js";
export { DeliveryReceipt } from "./entities/delivery-receipt.js";
export {
  TrainingPacket,
  type TrainingPacketStatus,
  type TrainingView,
  type TrainingViewKind,
} from "./entities/training-packet.js";
export {
  PracticeTask,
  type PracticeTaskStatus,
} from "./entities/practice-task.js";
export {
  PromotionRecord,
  type PromotionDecision,
} from "./entities/promotion-record.js";
export {
  AvatarState,
  type AchievementRule,
  type AvatarUnlock,
} from "./entities/avatar-state.js";
