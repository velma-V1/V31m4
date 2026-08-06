import type { ArtifactId, ProjectId, SafePath } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";

export type WorkspacePurpose = "candidate" | "repair" | "tool_execution" | "practice" | "verification";
export type WorkspaceStatus = "active" | "sealed" | "discarded";

export interface WorkspaceHandle {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly purpose: WorkspacePurpose;
  readonly rootPath: SafePath;
  readonly status: WorkspaceStatus;
  readonly createdAt: string;
}

export interface WorkspaceSnapshot {
  readonly workspaceId: string;
  readonly artifactIds: readonly ArtifactId[];
  readonly createdAt: string;
}

export interface WorkspaceManagerPort {
  create(projectId: ProjectId, purpose: WorkspacePurpose, context: OperationContext): Promise<WorkspaceHandle>;
  get(workspaceId: string, context: OperationContext): Promise<WorkspaceHandle | null>;
  snapshot(workspaceId: string, context: OperationContext): Promise<WorkspaceSnapshot>;
  seal(workspaceId: string, context: OperationContext): Promise<WorkspaceHandle>;
  discard(workspaceId: string, context: OperationContext): Promise<void>;
}
