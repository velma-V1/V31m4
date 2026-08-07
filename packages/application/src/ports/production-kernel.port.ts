import type {
  CheckpointId,
  JobId,
  MissionId,
  ProjectId,
  ResourceBudget,
  Score,
} from "@v31m4/domain";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { OperationReceipt, PortHealth } from "../port-types.js";

export type KernelJobStatus =
  | "accepted"
  | "running"
  | "checkpointing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface KernelStartRequest {
  readonly jobId: JobId;
  readonly projectId: ProjectId;
  readonly missionId: MissionId;
  readonly workflowId: string;
  readonly input: ApplicationJsonObject;
  readonly resourceBudget: ResourceBudget;
}

export interface KernelStatus {
  readonly jobId: JobId;
  readonly status: KernelJobStatus;
  readonly stage: string;
  readonly progress: Score;
  readonly checkpointId?: CheckpointId;
  readonly details: ApplicationJsonObject;
}

export interface ProductionKernelPort {
  start(request: KernelStartRequest, context: OperationContext): Promise<OperationReceipt>;
  checkpoint(jobId: JobId, context: OperationContext): Promise<CheckpointId>;
  resume(
    jobId: JobId,
    checkpointId: CheckpointId,
    context: OperationContext,
  ): Promise<OperationReceipt>;
  stop(
    jobId: JobId,
    mode: "finish_and_stop" | "emergency_stop",
    context: OperationContext,
  ): Promise<void>;
  status(jobId: JobId, context: OperationContext): Promise<KernelStatus>;
  health(context: OperationContext): Promise<PortHealth>;
}
