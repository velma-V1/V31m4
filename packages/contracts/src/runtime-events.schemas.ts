import { z } from "zod";
import {
  artifactIdSchema,
  avatarIdSchema,
  avatarItemIdSchema,
  capabilityIdSchema,
  canonicalIdSchema,
  contractVersionSchema,
  contentHashSchema,
  eventIdSchema,
  evidenceIdSchema,
  isoDateTimeSchema,
  jobIdSchema,
  missionIdSchema,
  modelIdSchema,
  pluginIdSchema,
  practiceTaskIdSchema,
  projectIdSchema,
  requestIdSchema,
  scoreSchema,
  toolIdSchema,
} from "./common.schemas.js";
import { evidenceStatusSchema } from "./evidence.schemas.js";
import { jobStatusSchema } from "./jobs.schemas.js";
import { pluginStatusSchema } from "./plugins.schemas.js";
import { practiceTaskStatusSchema } from "./practice.schemas.js";
import { profileAvailabilitySchema } from "./models.schemas.js";

const runtimeEventBaseShape = {
  schemaVersion: contractVersionSchema,
  eventId: eventIdSchema,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  occurredAt: isoDateTimeSchema,
  aggregateType: canonicalIdSchema,
  aggregateId: canonicalIdSchema,
  correlationId: requestIdSchema.optional(),
  causationId: eventIdSchema.optional(),
} as const;

export const projectUpdatedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("project.updated"),
    payload: z
      .object({
        projectId: projectIdSchema,
        status: z.enum(["active", "paused", "archived"]),
        name: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export const missionSubmittedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("mission.submitted"),
    payload: z
      .object({
        missionId: missionIdSchema,
        projectId: projectIdSchema,
        title: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export const jobStatusChangedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("job.status_changed"),
    payload: z
      .object({
        jobId: jobIdSchema,
        previousStatus: jobStatusSchema,
        status: jobStatusSchema,
        stage: z.string().min(1).max(240),
        progress: scoreSchema,
      })
      .strict(),
  })
  .strict();

export const artifactCreatedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("artifact.created"),
    payload: z
      .object({
        artifactId: artifactIdSchema,
        kind: canonicalIdSchema,
        contentHash: contentHashSchema,
      })
      .strict(),
  })
  .strict();

export const evidenceRecordedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("evidence.recorded"),
    payload: z
      .object({
        evidenceId: evidenceIdSchema,
        subjectType: canonicalIdSchema,
        subjectId: canonicalIdSchema,
        status: evidenceStatusSchema,
      })
      .strict(),
  })
  .strict();

export const capabilityUpdatedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("capability.updated"),
    payload: z
      .object({
        capabilityId: capabilityIdSchema,
        previousScore: scoreSchema.optional(),
        score: scoreSchema,
        evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
      })
      .strict(),
  })
  .strict();

export const modelStatusChangedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("model.status_changed"),
    payload: z
      .object({
        modelId: modelIdSchema,
        status: profileAvailabilitySchema,
      })
      .strict(),
  })
  .strict();

export const toolStatusChangedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("tool.status_changed"),
    payload: z
      .object({
        toolId: toolIdSchema,
        status: profileAvailabilitySchema,
      })
      .strict(),
  })
  .strict();

export const pluginStatusChangedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("plugin.status_changed"),
    payload: z
      .object({
        pluginId: pluginIdSchema,
        status: pluginStatusSchema,
      })
      .strict(),
  })
  .strict();

export const practiceStatusChangedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("practice.status_changed"),
    payload: z
      .object({
        practiceTaskId: practiceTaskIdSchema,
        status: practiceTaskStatusSchema,
      })
      .strict(),
  })
  .strict();

export const avatarUnlockedEventSchema = z
  .object({
    ...runtimeEventBaseShape,
    type: z.literal("avatar.unlocked"),
    payload: z
      .object({
        avatarId: avatarIdSchema,
        itemId: avatarItemIdSchema,
        evidenceIds: z.array(evidenceIdSchema).min(1).max(10_000),
      })
      .strict(),
  })
  .strict();

const runtimeEventUnionSchema = z.discriminatedUnion("type", [
  projectUpdatedEventSchema,
  missionSubmittedEventSchema,
  jobStatusChangedEventSchema,
  artifactCreatedEventSchema,
  evidenceRecordedEventSchema,
  capabilityUpdatedEventSchema,
  modelStatusChangedEventSchema,
  toolStatusChangedEventSchema,
  pluginStatusChangedEventSchema,
  practiceStatusChangedEventSchema,
  avatarUnlockedEventSchema,
]);

export const runtimeEventSchema = runtimeEventUnionSchema.superRefine((event, context) => {
  const expected = (() => {
    switch (event.type) {
      case "project.updated":
        return ["project", event.payload.projectId] as const;
      case "mission.submitted":
        return ["mission", event.payload.missionId] as const;
      case "job.status_changed":
        return ["job", event.payload.jobId] as const;
      case "artifact.created":
        return ["artifact", event.payload.artifactId] as const;
      case "evidence.recorded":
        return ["evidence", event.payload.evidenceId] as const;
      case "capability.updated":
        return ["capability", event.payload.capabilityId] as const;
      case "model.status_changed":
        return ["model", event.payload.modelId] as const;
      case "tool.status_changed":
        return ["tool", event.payload.toolId] as const;
      case "plugin.status_changed":
        return ["plugin", event.payload.pluginId] as const;
      case "practice.status_changed":
        return ["practice_task", event.payload.practiceTaskId] as const;
      case "avatar.unlocked":
        return ["avatar", event.payload.avatarId] as const;
    }
  })();
  if (event.aggregateType !== expected[0]) {
    context.addIssue({
      code: "custom",
      message: `Event aggregateType must be ${expected[0]}.`,
      path: ["aggregateType"],
    });
  }
  if (event.aggregateId !== expected[1]) {
    context.addIssue({
      code: "custom",
      message: "Event aggregateId must match the typed payload identifier.",
      path: ["aggregateId"],
    });
  }
  if (event.causationId === event.eventId) {
    context.addIssue({
      code: "custom",
      message: "An event cannot cause itself.",
      path: ["causationId"],
    });
  }
});

export type RuntimeEventPayload = z.infer<typeof runtimeEventSchema>;
export type RuntimeEventType = RuntimeEventPayload["type"];
