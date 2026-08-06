import type { CapabilityId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface WorkflowStageDefinition {
  readonly id: string;
  readonly capabilityId: CapabilityId;
  readonly dependsOn: readonly string[];
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly checkpoint: boolean;
}

export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly version: string;
  readonly displayName: string;
  readonly inputSchemaRef: string;
  readonly outputSchemaRef: string;
  readonly stages: readonly WorkflowStageDefinition[];
}

export interface WorkflowRepositoryPort {
  get(workflowId: string, version: string | undefined, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<WorkflowDefinition> | null>;
  list(request: PortPageRequest, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<PortPage<Versioned<WorkflowDefinition>>>;
  save(definition: WorkflowDefinition, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<WorkflowDefinition>>;
}
