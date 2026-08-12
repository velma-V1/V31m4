import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonValue,
  isApplicationError,
  startJob,
} from "@v31m4/application";
import { startJobRequestSchema, startJobResponseSchema } from "@v31m4/contracts";
import { type Job, JobId } from "@v31m4/domain";
import { canonicalJson } from "./external-command-executor.js";
import type { JobCommandDependencies } from "./job-command-surface.js";
import { parseCommandPayload } from "./use-case-infrastructure.js";

/** Registers job.start while keeping the external kernel call outside the command UoW. */
export function registerJobStartCommand(dependencies: JobCommandDependencies): void {
  const { service, database, missions, jobs, eventBus, idempotency, kernel, audit, clock } =
    dependencies;
  service.registerDirect("job.start", async (payload, context) => {
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const cached = await idempotency.lookup(
      context.actor.id,
      context.idempotencyKey,
      "job.start",
      payloadHash,
    );
    if (cached?.status === "completed") return cached.result as ApplicationJsonValue;

    const request = parseCommandPayload(startJobRequestSchema, payload);
    const jobId = `job-${createHash("sha256")
      .update(`${context.actor.id}:${context.idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`;
    const mission = await missions.getById(request.missionId, context);
    if (mission === null) {
      throw new ApplicationError("NOT_FOUND", "Mission does not exist.", {
        details: { missionId: request.missionId },
      });
    }
    if (request.workflowId === "software.production.v1") {
      const project = await dependencies.projects.getById(mission.value.projectId, context);
      if (project === null) {
        throw new ApplicationError("INTEGRITY_FAILURE", "Mission project does not exist.");
      }
      if (dependencies.prepareSoftwareJob === undefined) {
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Software production requires the supervised local execution profile.",
        );
      }
      await dependencies.prepareSoftwareJob(project.value.rootPath, project.value.id, jobId);
    }
    const toResponse = (job: Job): ApplicationJsonValue =>
      startJobResponseSchema.parse({
        schemaVersion: request.schemaVersion,
        requestId: request.requestId,
        job,
      }) as unknown as ApplicationJsonValue;

    let response: ApplicationJsonValue;
    try {
      const saved = await startJob(
        { unitOfWork: database.unitOfWork, jobs, events: eventBus, kernel, audit, clock },
        {
          jobId,
          projectId: mission.value.projectId,
          missionId: request.missionId,
          workflowId: request.workflowId,
          input: {},
          resourceBudget: mission.value.resourceBudget,
          createdEventId: `event-${randomUUID()}`,
          queuedEventId: `event-${randomUUID()}`,
          startedEventId: `event-${randomUUID()}`,
          failureEventId: `event-${randomUUID()}`,
          auditId: `audit-${randomUUID()}`,
        },
        context,
      );
      response = toResponse(saved.value);
    } catch (error) {
      if (isApplicationError(error) && error.code === "CONFLICT") {
        const current = await jobs.getById(JobId.parse(jobId), context);
        if (
          current !== null &&
          current.value.missionId === request.missionId &&
          current.value.workflowId === request.workflowId
        ) {
          response = toResponse(current.value);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    await idempotency.complete(
      context.actor.id,
      context.idempotencyKey,
      "job.start",
      payloadHash,
      response,
    );
    return response;
  });
}
