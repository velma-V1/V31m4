import { assertDomain } from "../domain-errors.js";

export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type ProjectId = Brand<string, "ProjectId">;
export type MissionId = Brand<string, "MissionId">;
export type JobId = Brand<string, "JobId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type CandidateId = Brand<string, "CandidateId">;
export type IssueId = Brand<string, "IssueId">;
export type CapabilityId = Brand<string, "CapabilityId">;
export type PluginId = Brand<string, "PluginId">;
export type AdapterId = Brand<string, "AdapterId">;
export type ModelId = Brand<string, "ModelId">;
export type ToolId = Brand<string, "ToolId">;
export type EventId = Brand<string, "EventId">;

type DurableId =
  | ProjectId
  | MissionId
  | JobId
  | CheckpointId
  | ArtifactId
  | EvidenceId
  | CandidateId
  | IssueId
  | CapabilityId
  | PluginId
  | AdapterId
  | ModelId
  | ToolId
  | EventId;

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
export const JobId = createParser<JobId>("JobId");
export const CheckpointId = createParser<CheckpointId>("CheckpointId");
export const ArtifactId = createParser<ArtifactId>("ArtifactId");
export const EvidenceId = createParser<EvidenceId>("EvidenceId");
export const CandidateId = createParser<CandidateId>("CandidateId");
export const IssueId = createParser<IssueId>("IssueId");
export const CapabilityId = createParser<CapabilityId>("CapabilityId");
export const PluginId = createParser<PluginId>("PluginId");
export const AdapterId = createParser<AdapterId>("AdapterId");
export const ModelId = createParser<ModelId>("ModelId");
export const ToolId = createParser<ToolId>("ToolId");
export const EventId = createParser<EventId>("EventId");
