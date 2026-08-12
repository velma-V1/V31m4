import { randomUUID } from "node:crypto";
import type {
  KernelStartRequest,
  KernelStatus,
  OperationContext,
  OperationReceipt,
  PortHealth,
  ProductionKernelPort,
} from "@v31m4/application";
import { CheckpointId, type CheckpointId as CheckpointIdType, type JobId } from "@v31m4/domain";
import { type AdapterBinding, invokeAdapter, selectInvoker } from "./adapter-invoker.js";
import { remainingTimeout } from "./supervised-model-gateway.js";

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Provider-neutral production kernel over a single supervised adapter. The kernel owns
 * authoritative job execution; this gateway translates the port to `kernel.*` adapter
 * calls, validates the returned checkpoint id, and classifies transport failures.
 */
export class SupervisedProductionKernel implements ProductionKernelPort {
  constructor(
    private readonly binding: AdapterBinding,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async start(request: KernelStartRequest, context: OperationContext): Promise<OperationReceipt> {
    return invokeAdapter<OperationReceipt>(
      this.#invoker(),
      "kernel.start_job",
      { invocationId: `invocation-${randomUUID()}`, ...request },
      {
        timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
        signal: context.signal,
      },
    );
  }

  async checkpoint(jobId: JobId, context: OperationContext): Promise<CheckpointIdType> {
    const raw = await invokeAdapter<string>(
      this.#invoker(),
      "kernel.checkpoint_job",
      { invocationId: `invocation-${randomUUID()}`, jobId, stage: "checkpointing" },
      {
        timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
        signal: context.signal,
      },
    );
    return CheckpointId.parse(raw);
  }

  async resume(
    jobId: JobId,
    checkpointId: CheckpointIdType,
    context: OperationContext,
  ): Promise<OperationReceipt> {
    return invokeAdapter<OperationReceipt>(
      this.#invoker(),
      "kernel.resume_job",
      { invocationId: `invocation-${randomUUID()}`, jobId, checkpointId },
      {
        timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
        signal: context.signal,
      },
    );
  }

  async stop(
    jobId: JobId,
    mode: "finish_and_stop" | "emergency_stop",
    context: OperationContext,
  ): Promise<void> {
    await invokeAdapter<void>(
      this.#invoker(),
      "kernel.stop_job",
      { invocationId: `invocation-${randomUUID()}`, jobId, mode },
      {
        timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
        signal: context.signal,
      },
    );
  }

  async status(jobId: JobId, context: OperationContext): Promise<KernelStatus> {
    return invokeAdapter<KernelStatus>(
      this.#invoker(),
      "kernel.job_status",
      { jobId },
      {
        timeoutMs: remainingTimeout(context, this.defaultTimeoutMs),
        signal: context.signal,
      },
    );
  }

  async health(): Promise<PortHealth> {
    const available =
      this.binding.primary.available() || this.binding.fallback?.available() === true;
    return Object.freeze({
      status: available ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      details: {},
    });
  }

  #invoker() {
    return selectInvoker(this.binding, "production-kernel");
  }
}
