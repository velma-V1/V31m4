import {
  ApplicationError,
  type ApplicationJsonValue,
  type CandidateRepositoryPort,
  type EvidenceRepositoryPort,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type ModelGatewayPort,
  type OperationContext,
  type PortPage,
  type PortPageRequest,
  type ProjectRepositoryPort,
  type Versioned,
} from "@v31m4/application";
import {
  listCandidatesRequestSchema,
  listCandidatesResponseSchema,
  listEvidenceRequestSchema,
  listEvidenceResponseSchema,
  listJobsRequestSchema,
  listJobsResponseSchema,
  listMissionsRequestSchema,
  listMissionsResponseSchema,
  listModelsRequestSchema,
  listModelsResponseSchema,
  listToolsRequestSchema,
  listToolsResponseSchema,
  type PaginationRequest,
} from "@v31m4/contracts";
import type { Job, JobId, MissionContract, MissionId, ProjectId } from "@v31m4/domain";
import { parsePaginationCursor } from "@v31m4/infrastructure";
import type { RuntimeService } from "./composition-root.js";
import { collectCompleteModelCatalog } from "./model-catalog.js";
import { parseCommandPayload } from "./use-case-infrastructure.js";

export interface ListQueryDependencies {
  readonly projects: ProjectRepositoryPort;
  readonly missions: MissionRepositoryPort;
  readonly jobs: JobRepositoryPort;
  readonly candidates: CandidateRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly models: ModelGatewayPort;
}

function pageRequest(pagination: PaginationRequest): PortPageRequest {
  const cursor =
    pagination.cursor ?? (pagination.offset === undefined ? undefined : String(pagination.offset));
  return Object.freeze({
    limit: pagination.limit,
    ...(cursor === undefined ? {} : { cursor }),
  });
}

function responsePagination<Value>(page: PortPage<Value>) {
  return Object.freeze({
    total: page.total ?? page.items.length,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

function notFound(resourceType: string, details: Record<string, string>): ApplicationError {
  return new ApplicationError("NOT_FOUND", `${resourceType} does not exist in this boundary.`, {
    details,
  });
}

async function requireProject(
  dependencies: ListQueryDependencies,
  projectId: ProjectId,
  context: OperationContext,
): Promise<void> {
  if ((await dependencies.projects.getById(projectId, context)) === null) {
    throw notFound("Project", { projectId });
  }
}

async function requireMission(
  dependencies: ListQueryDependencies,
  missionId: MissionId,
  projectId: ProjectId | undefined,
  context: OperationContext,
): Promise<Versioned<MissionContract>> {
  const mission = await dependencies.missions.getById(missionId, context);
  if (mission === null || (projectId !== undefined && mission.value.projectId !== projectId)) {
    throw notFound("Mission", {
      missionId,
      ...(projectId === undefined ? {} : { projectId }),
    });
  }
  return mission;
}

async function requireJob(
  dependencies: ListQueryDependencies,
  jobId: JobId,
  projectId: ProjectId,
  context: OperationContext,
): Promise<Versioned<Job>> {
  const job = await dependencies.jobs.getById(jobId, context);
  if (job === null || job.value.projectId !== projectId) {
    throw notFound("Job", { jobId, projectId });
  }
  return job;
}

/** Registers authenticated read-only collection queries against existing runtime authority. */
export function registerListQueries(
  service: RuntimeService,
  dependencies: ListQueryDependencies,
): void {
  service.registerQuery("tool.list", async (payload) => {
    const request = parseCommandPayload(listToolsRequestSchema, payload);
    return listToolsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      tools: [],
      pagination: { total: 0 },
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("model.list", async (payload, context) => {
    const request = parseCommandPayload(listModelsRequestSchema, payload);
    const all = await collectCompleteModelCatalog(dependencies.models, context);
    const filtered = all.filter(
      (profile) =>
        (request.status === undefined || profile.status === request.status) &&
        (request.local === undefined || profile.local === request.local) &&
        (request.modality === undefined || profile.supportedModalities.includes(request.modality)),
    );
    const start = request.pagination.offset ?? parsePaginationCursor(request.pagination.cursor);
    const models = filtered.slice(start, start + request.pagination.limit);
    const next = start + request.pagination.limit;
    return listModelsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      models,
      pagination: {
        total: filtered.length,
        ...(next < filtered.length ? { nextCursor: String(next) } : {}),
      },
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("mission.list", async (payload, context) => {
    const request = parseCommandPayload(listMissionsRequestSchema, payload);
    await requireProject(dependencies, request.projectId, context);
    const page = await dependencies.missions.listByProject(
      request.projectId,
      pageRequest(request.pagination),
      context,
    );
    return listMissionsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      missions: page.items.map((item) => item.value),
      pagination: responsePagination(page),
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("job.list", async (payload, context) => {
    const request = parseCommandPayload(listJobsRequestSchema, payload);
    if (request.projectId !== undefined) {
      await requireProject(dependencies, request.projectId, context);
    }
    if (request.missionId !== undefined) {
      await requireMission(dependencies, request.missionId, request.projectId, context);
    }
    const page = await dependencies.jobs.list(
      {
        ...pageRequest(request.pagination),
        ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
        ...(request.missionId === undefined ? {} : { missionId: request.missionId }),
        ...(request.status === undefined ? {} : { statuses: [request.status] }),
      },
      context,
    );
    return listJobsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      jobs: page.items.map((item) => item.value),
      pagination: responsePagination(page),
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("candidate.list", async (payload, context) => {
    const request = parseCommandPayload(listCandidatesRequestSchema, payload);
    await requireProject(dependencies, request.projectId, context);
    await requireMission(dependencies, request.missionId, request.projectId, context);
    const page = await dependencies.candidates.listCandidates(
      request.missionId,
      pageRequest(request.pagination),
      context,
    );
    return listCandidatesResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      candidates: page.items.map((item) => item.value),
      pagination: responsePagination(page),
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("evidence.list", async (payload, context) => {
    const request = parseCommandPayload(listEvidenceRequestSchema, payload);
    await requireProject(dependencies, request.projectId, context);
    if (request.jobId !== undefined) {
      await requireJob(dependencies, request.jobId, request.projectId, context);
    }
    const page = await dependencies.evidence.list(
      {
        ...pageRequest(request.pagination),
        projectId: request.projectId,
        ...(request.jobId === undefined ? {} : { jobId: request.jobId }),
        ...(request.kind === undefined ? {} : { kinds: [request.kind] }),
        ...(request.status === undefined ? {} : { statuses: [request.status] }),
        ...(request.subjectType === undefined ? {} : { subjectType: request.subjectType }),
        ...(request.subjectId === undefined ? {} : { subjectId: request.subjectId }),
      },
      context,
    );
    return listEvidenceResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      evidence: page.items.map((item) => item.value),
      pagination: responsePagination(page),
    }) as unknown as ApplicationJsonValue;
  });
}
