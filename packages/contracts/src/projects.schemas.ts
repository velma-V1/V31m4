import { z } from "zod";
import {
  apiRequestMetadataShape,
  apiResponseMetadataShape,
  canonicalNameSchema,
  isoDateTimeSchema,
  paginationRequestSchema,
  paginationResultSchema,
  projectIdSchema,
  safePathSchema,
} from "./common.schemas.js";

export const projectStatusSchema = z.enum(["active", "paused", "archived"]);

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: canonicalNameSchema,
    rootPath: safePathSchema,
    status: projectStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Project updatedAt cannot precede createdAt.",
        path: ["updatedAt"],
      });
    }
  });

export const createProjectRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    name: canonicalNameSchema,
    rootPath: safePathSchema,
  })
  .strict();

export const createProjectResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    project: projectSchema,
  })
  .strict();

export const getProjectRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema,
  })
  .strict();

export const getProjectResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    project: projectSchema,
  })
  .strict();

export const renameProjectRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema,
    name: canonicalNameSchema,
    expectedUpdatedAt: isoDateTimeSchema,
  })
  .strict();

export const setProjectStatusRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    projectId: projectIdSchema,
    status: projectStatusSchema,
    expectedUpdatedAt: isoDateTimeSchema,
  })
  .strict();

export const listProjectsRequestSchema = z
  .object({
    ...apiRequestMetadataShape,
    pagination: paginationRequestSchema,
    status: projectStatusSchema.optional(),
  })
  .strict();

export const listProjectsResponseSchema = z
  .object({
    ...apiResponseMetadataShape,
    projects: z.array(projectSchema).max(500),
    pagination: paginationResultSchema,
  })
  .strict();

export type ProjectStatusPayload = z.infer<typeof projectStatusSchema>;
export type ProjectPayload = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;
export type GetProjectRequest = z.infer<typeof getProjectRequestSchema>;
export type GetProjectResponse = z.infer<typeof getProjectResponseSchema>;
export type RenameProjectRequest = z.infer<typeof renameProjectRequestSchema>;
export type SetProjectStatusRequest = z.infer<typeof setProjectStatusRequestSchema>;
export type ListProjectsRequest = z.infer<typeof listProjectsRequestSchema>;
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
