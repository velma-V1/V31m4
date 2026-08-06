import type { ArtifactId, ContentHash, ProjectId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { OperationReceipt, PortPage, PortPageRequest } from "../port-types.js";

export type BackupStatus = "creating" | "verified" | "failed" | "restored";

export interface BackupRecord {
  readonly id: string;
  readonly projectId?: ProjectId;
  readonly artifactId: ArtifactId;
  readonly contentHash: ContentHash;
  readonly status: BackupStatus;
  readonly createdAt: string;
  readonly verifiedAt?: string;
}

export interface BackupStorePort {
  create(projectId: ProjectId | undefined, context: OperationContext): Promise<OperationReceipt>;
  get(backupId: string, context: OperationContext): Promise<BackupRecord | null>;
  list(request: PortPageRequest, context: OperationContext): Promise<PortPage<BackupRecord>>;
  verify(backupId: string, context: OperationContext): Promise<BackupRecord>;
  restore(backupId: string, context: OperationContext): Promise<OperationReceipt>;
}
