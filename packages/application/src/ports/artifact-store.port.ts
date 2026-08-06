import type {
  Artifact,
  ArtifactId,
  ArtifactKind,
  ContentHash,
  JobId,
  ProjectId,
  SafePath,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface ArtifactWriteRequest {
  readonly id: ArtifactId;
  readonly projectId: ProjectId;
  readonly jobId?: JobId;
  readonly kind: ArtifactKind;
  readonly logicalPath: SafePath;
  readonly mediaType: string;
  readonly expectedHash?: ContentHash;
  readonly parentArtifactIds: readonly ArtifactId[];
  readonly bytes: AsyncIterable<Uint8Array>;
}

export interface ArtifactStorePort {
  write(request: ArtifactWriteRequest, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<Artifact>>;
  get(id: ArtifactId, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<Artifact> | null>;
  findByHash(hash: ContentHash, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<Artifact> | null>;
  listByProject(projectId: ProjectId, request: PortPageRequest, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<Artifact>>>;
  open(id: ArtifactId, context: OperationContext): Promise<AsyncIterable<Uint8Array>>;
  verify(id: ArtifactId, context: OperationContext): Promise<boolean>;
  discardUncommitted(id: ArtifactId, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<void>;
}
