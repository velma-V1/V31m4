import {
  AchievementRuleId,
  type AchievementRuleId as AchievementRuleIdType,
  AdapterId,
  type AdapterId as AdapterIdType,
  ArtifactId,
  type ArtifactId as ArtifactIdType,
  AvatarId,
  type AvatarId as AvatarIdType,
  AvatarItemId,
  type AvatarItemId as AvatarItemIdType,
  CandidateId,
  type CandidateId as CandidateIdType,
  CapabilityId,
  type CapabilityId as CapabilityIdType,
  ChampionDecisionId,
  type ChampionDecisionId as ChampionDecisionIdType,
  CheckpointId,
  type CheckpointId as CheckpointIdType,
  ClaimId,
  type ClaimId as ClaimIdType,
  ContentHash,
  type ContentHash as ContentHashType,
  DeliveryReceiptId,
  type DeliveryReceiptId as DeliveryReceiptIdType,
  EventId,
  type EventId as EventIdType,
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  IssueId,
  type IssueId as IssueIdType,
  JobId,
  type JobId as JobIdType,
  MissionId,
  type MissionId as MissionIdType,
  ModelId,
  type ModelId as ModelIdType,
  PluginId,
  type PluginId as PluginIdType,
  PracticeTaskId,
  type PracticeTaskId as PracticeTaskIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
  PromotionId,
  type PromotionId as PromotionIdType,
  RepairId,
  type RepairId as RepairIdType,
  RequirementId,
  type RequirementId as RequirementIdType,
  ResourceBudget,
  type ResourceBudget as ResourceBudgetType,
  SafePath,
  type SafePath as SafePathType,
  Score,
  type Score as ScoreType,
  ToolId,
  type ToolId as ToolIdType,
  TrainingPacketId,
  type TrainingPacketId as TrainingPacketIdType,
  TwinEdgeId,
  type TwinEdgeId as TwinEdgeIdType,
  TwinNodeId,
  type TwinNodeId as TwinNodeIdType,
  VerificationPlanId,
  type VerificationPlanId as VerificationPlanIdType,
  VerificationResultId,
  type VerificationResultId as VerificationResultIdType,
} from "@v31m4/domain";
import { z } from "zod";
import { FORBIDDEN_JSON_KEYS } from "./forbidden-key-guard.js";

export { guardForbiddenKeys } from "./forbidden-key-guard.js";

export const CONTRACT_SCHEMA_VERSION = "1.0.0" as const;
export const ADAPTER_PROTOCOL_VERSION = "1.0.0" as const;

const CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const EVENT_OR_METHOD_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type SafeJsonPrimitive = string | number | boolean | null;
export type SafeJsonValue = SafeJsonPrimitive | SafeJsonArray | SafeJsonObject;
export interface SafeJsonArray extends ReadonlyArray<SafeJsonValue> {}
export interface SafeJsonObject {
  readonly [key: string]: SafeJsonValue;
}

export interface ContractRefinementContext {
  addIssue(issue: {
    readonly code: "custom";
    readonly message: string;
    readonly path?: (string | number)[];
  }): void;
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_TIME_PATTERN.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isDomainValue<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T {
  return predicate(value);
}

function createDomainValueSchema<T>(
  predicate: (candidate: unknown) => candidate is T,
  message: string,
) {
  return z.custom<T>((value) => isDomainValue(value, predicate), { message });
}

function isSafeJsonValueInternal(value: unknown, active: Set<object>): value is SafeJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (active.has(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    return false;
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isSafeJsonValueInternal(item, active));
    }
    for (const [key, nested] of Object.entries(value)) {
      if (
        key.length === 0 ||
        key.length > 256 ||
        key !== key.trim() ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        return false;
      }
      if (!isSafeJsonValueInternal(nested, active)) {
        return false;
      }
    }
    return true;
  } finally {
    active.delete(value);
  }
}

function cloneAndFreezeSafeJson(value: SafeJsonValue): SafeJsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreezeSafeJson(item)));
  }
  const copied = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneAndFreezeSafeJson(nested)]),
  ) as SafeJsonObject;
  return Object.freeze(copied);
}

export const contractVersionSchema = z.literal(CONTRACT_SCHEMA_VERSION);
export const adapterProtocolVersionSchema = z.literal(ADAPTER_PROTOCOL_VERSION);
export const semanticVersionSchema = z
  .string()
  .min(5)
  .max(128)
  .regex(SEMANTIC_VERSION_PATTERN, "Version must be canonical semantic version syntax.");
export const isoDateTimeSchema = z.custom<string>(isCanonicalIsoDateTime, {
  message: "Timestamp must be canonical UTC ISO-8601 with milliseconds.",
});
export const canonicalIdSchema = z
  .string()
  .regex(CANONICAL_ID_PATTERN, "Identifier must use the canonical durable-ID syntax.");
export const requestIdSchema = canonicalIdSchema;
export const runtimeIdSchema = canonicalIdSchema;
export const invocationIdSchema = canonicalIdSchema;
export const workflowIdSchema = canonicalIdSchema;
export const verifierIdSchema = canonicalIdSchema;
export const capabilityPackageIdSchema = canonicalIdSchema;
export const commandNameSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(EVENT_OR_METHOD_PATTERN, "Name must use lowercase separated tokens.");
export const canonicalNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), "Name cannot contain outer whitespace.");
export const canonicalStatementSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value === value.trim(), "Text cannot contain outer whitespace.");
export const canonicalSummarySchema = z
  .string()
  .min(1)
  .max(8_000)
  .refine((value) => value === value.trim(), "Summary cannot contain outer whitespace.");
export const mediaTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(MEDIA_TYPE_PATTERN, "Media type must use canonical type/subtype syntax.");
export const schemaReferenceSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value === value.trim() && !/\s/u.test(value), {
    message: "Schema reference must be canonical and contain no whitespace.",
  });

export const projectIdSchema = createDomainValueSchema<ProjectIdType>(
  ProjectId.is,
  "Invalid ProjectId.",
);
export const missionIdSchema = createDomainValueSchema<MissionIdType>(
  MissionId.is,
  "Invalid MissionId.",
);
export const jobIdSchema = createDomainValueSchema<JobIdType>(JobId.is, "Invalid JobId.");
export const checkpointIdSchema = createDomainValueSchema<CheckpointIdType>(
  CheckpointId.is,
  "Invalid CheckpointId.",
);
export const artifactIdSchema = createDomainValueSchema<ArtifactIdType>(
  ArtifactId.is,
  "Invalid ArtifactId.",
);
export const evidenceIdSchema = createDomainValueSchema<EvidenceIdType>(
  EvidenceId.is,
  "Invalid EvidenceId.",
);
export const candidateIdSchema = createDomainValueSchema<CandidateIdType>(
  CandidateId.is,
  "Invalid CandidateId.",
);
export const issueIdSchema = createDomainValueSchema<IssueIdType>(IssueId.is, "Invalid IssueId.");
export const capabilityIdSchema = createDomainValueSchema<CapabilityIdType>(
  CapabilityId.is,
  "Invalid CapabilityId.",
);
export const pluginIdSchema = createDomainValueSchema<PluginIdType>(
  PluginId.is,
  "Invalid PluginId.",
);
export const adapterIdSchema = createDomainValueSchema<AdapterIdType>(
  AdapterId.is,
  "Invalid AdapterId.",
);
export const modelIdSchema = createDomainValueSchema<ModelIdType>(ModelId.is, "Invalid ModelId.");
export const toolIdSchema = createDomainValueSchema<ToolIdType>(ToolId.is, "Invalid ToolId.");
export const eventIdSchema = createDomainValueSchema<EventIdType>(EventId.is, "Invalid EventId.");
export const requirementIdSchema = createDomainValueSchema<RequirementIdType>(
  RequirementId.is,
  "Invalid RequirementId.",
);
export const claimIdSchema = createDomainValueSchema<ClaimIdType>(ClaimId.is, "Invalid ClaimId.");
export const twinNodeIdSchema = createDomainValueSchema<TwinNodeIdType>(
  TwinNodeId.is,
  "Invalid TwinNodeId.",
);
export const twinEdgeIdSchema = createDomainValueSchema<TwinEdgeIdType>(
  TwinEdgeId.is,
  "Invalid TwinEdgeId.",
);
export const verificationPlanIdSchema = createDomainValueSchema<VerificationPlanIdType>(
  VerificationPlanId.is,
  "Invalid VerificationPlanId.",
);
export const verificationResultIdSchema = createDomainValueSchema<VerificationResultIdType>(
  VerificationResultId.is,
  "Invalid VerificationResultId.",
);
export const repairIdSchema = createDomainValueSchema<RepairIdType>(
  RepairId.is,
  "Invalid RepairId.",
);
export const championDecisionIdSchema = createDomainValueSchema<ChampionDecisionIdType>(
  ChampionDecisionId.is,
  "Invalid ChampionDecisionId.",
);
export const deliveryReceiptIdSchema = createDomainValueSchema<DeliveryReceiptIdType>(
  DeliveryReceiptId.is,
  "Invalid DeliveryReceiptId.",
);
export const trainingPacketIdSchema = createDomainValueSchema<TrainingPacketIdType>(
  TrainingPacketId.is,
  "Invalid TrainingPacketId.",
);
export const practiceTaskIdSchema = createDomainValueSchema<PracticeTaskIdType>(
  PracticeTaskId.is,
  "Invalid PracticeTaskId.",
);
export const promotionIdSchema = createDomainValueSchema<PromotionIdType>(
  PromotionId.is,
  "Invalid PromotionId.",
);
export const avatarIdSchema = createDomainValueSchema<AvatarIdType>(
  AvatarId.is,
  "Invalid AvatarId.",
);
export const avatarItemIdSchema = createDomainValueSchema<AvatarItemIdType>(
  AvatarItemId.is,
  "Invalid AvatarItemId.",
);
export const achievementRuleIdSchema = createDomainValueSchema<AchievementRuleIdType>(
  AchievementRuleId.is,
  "Invalid AchievementRuleId.",
);
export const contentHashSchema = createDomainValueSchema<ContentHashType>(
  ContentHash.is,
  "Invalid SHA-256 content hash.",
);
export const safePathSchema = createDomainValueSchema<SafePathType>(
  SafePath.is,
  "Invalid project-relative safe path.",
);
export const scoreSchema = createDomainValueSchema<ScoreType>(
  (value): value is ScoreType =>
    typeof value === "number" &&
    (() => {
      try {
        Score.parse(value);
        return true;
      } catch {
        return false;
      }
    })(),
  "Score must be a finite number between 0 and 1.",
);

export const resourceBudgetSchema = z
  .object({
    maxWallClockMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxModelInvocations: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxToolInvocations: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxRepairRounds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxConcurrentWorkers: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxInputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxRamBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxVramBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      ResourceBudget.create(value as ResourceBudgetType);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid resource budget.",
      });
    }
  });

export const safeJsonValueSchema = z
  .custom<SafeJsonValue>((value) => isSafeJsonValueInternal(value, new Set()), {
    message:
      "Value must be finite, acyclic, prototype-safe JSON containing only plain objects, arrays, and JSON primitives.",
  })
  .transform((value) => cloneAndFreezeSafeJson(value));

export const safeJsonObjectSchema = safeJsonValueSchema.refine(
  (value): value is SafeJsonObject =>
    value !== null && typeof value === "object" && !Array.isArray(value),
  "Value must be a safe JSON object.",
);

export const apiRequestMetadataShape = {
  schemaVersion: contractVersionSchema,
  requestId: requestIdSchema,
} as const;

export const apiResponseMetadataShape = {
  schemaVersion: contractVersionSchema,
  requestId: requestIdSchema,
} as const;

export const apiRequestMetadataSchema = z.object(apiRequestMetadataShape).strict();
export const apiResponseMetadataSchema = z.object(apiResponseMetadataShape).strict();

export const paginationRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(500),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    cursor: canonicalIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.offset !== undefined && value.cursor !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Pagination may use offset or cursor, but not both.",
      });
    }
  });

export const paginationResultSchema = z
  .object({
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextCursor: canonicalIdSchema.optional(),
  })
  .strict();

export const runtimeApiErrorSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z][A-Z0-9_]*$/u, "Error code must be uppercase snake case."),
    message: canonicalSummarySchema,
    retryable: z.boolean(),
    details: safeJsonObjectSchema.optional(),
  })
  .strict();

export function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function addDuplicateStringIssue(
  values: readonly string[],
  context: ContractRefinementContext,
  path: readonly (string | number)[],
  label: string,
): void {
  if (!hasUniqueStrings(values)) {
    context.addIssue({ code: "custom", message: `${label} must be unique.`, path: [...path] });
  }
}

export function isContractVersionCompatible(version: string): boolean {
  return version === CONTRACT_SCHEMA_VERSION;
}

export function assertContractVersionCompatible(
  version: string,
): asserts version is typeof CONTRACT_SCHEMA_VERSION {
  if (!isContractVersionCompatible(version)) {
    throw new Error(
      `Unsupported contract version ${JSON.stringify(version)}; expected ${CONTRACT_SCHEMA_VERSION}.`,
    );
  }
}

export type ContractVersion = z.infer<typeof contractVersionSchema>;
export type ApiRequestMetadata = z.infer<typeof apiRequestMetadataSchema>;
export type ApiResponseMetadata = z.infer<typeof apiResponseMetadataSchema>;
export type PaginationRequest = z.infer<typeof paginationRequestSchema>;
export type PaginationResult = z.infer<typeof paginationResultSchema>;
export type RuntimeApiError = z.infer<typeof runtimeApiErrorSchema>;
