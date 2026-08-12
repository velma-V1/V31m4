import type {
  KernelStartRequest,
  ModelInvocationRequest,
  ToolInvocationRequest,
} from "@v31m4/application";
import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import type {
  AdapterBinding,
  AdapterInvoker,
  InvokeOptions,
} from "../src/gateways/adapter-invoker.js";
import { SupervisedProductionKernel } from "../src/gateways/supervised-kernel-gateway.js";
import {
  remainingTimeout,
  SupervisedModelGateway,
} from "../src/gateways/supervised-model-gateway.js";
import { SupervisedToolGateway } from "../src/gateways/supervised-tool-gateway.js";
import { RpcRemoteError } from "../src/rpc/json-rpc-client.js";
import { context } from "./fixtures.js";

function budget() {
  return ResourceBudget.create({
    maxWallClockMs: 60_000,
    maxModelInvocations: 4,
    maxToolInvocations: 4,
    maxRepairRounds: 2,
    maxConcurrentWorkers: 2,
  });
}

class FakeInvoker implements AdapterInvoker {
  public calls: { method: string; params: unknown; options: InvokeOptions }[] = [];
  constructor(
    readonly id: string,
    readonly behavior: { available?: boolean; result?: unknown; error?: Error } = {},
  ) {}
  available(): boolean {
    return this.behavior.available ?? true;
  }
  async invoke(method: string, params: unknown, _options: InvokeOptions): Promise<unknown> {
    this.calls.push({ method, params, options: _options });
    if (this.behavior.error) throw this.behavior.error;
    return this.behavior.result;
  }
}

function modelRequest(): ModelInvocationRequest {
  return {
    invocationId: "invoke-1",
    jobId: "job-1" as never,
    modelId: "model-1" as never,
    promptArtifactId: "prompt-1" as never,
    configuration: {
      modelId: "model-1",
      strategy: "direct",
      contextArtifactIds: [],
      toolIds: [],
      constraints: [],
    } as never,
    resourceBudget: budget(),
    metadata: {},
  };
}

const modelResult = {
  invocationId: "invoke-1",
  modelId: "model-1",
  responseArtifactId: "artifact-response",
  outputArtifactIds: ["artifact-out"],
  finishReason: "completed" as const,
  usage: { wallClockMs: 10 },
  metadata: {},
};

describe("SupervisedModelGateway", () => {
  it("discovers provider-neutral profiles and binds installed models to the supervised adapter", async () => {
    const discovery = new FakeInvoker("ollama-local-supervised", {
      result: {
        models: [
          {
            modelId: "discovered-code:latest",
            adapterId: "ollama-local-supervised",
            displayName: "discovered-code:latest",
            status: "available",
            local: true,
            measuredCapabilities: [],
            supportedModalities: ["text"],
          },
        ],
      },
    });
    const gateway = new SupervisedModelGateway([], new Map(), 120_000, { primary: discovery });
    await expect(gateway.list({ limit: 10 }, context)).resolves.toMatchObject({
      items: [{ modelId: "discovered-code:latest" }],
      total: 1,
    });
    discovery.behavior.result = {
      ...modelResult,
      modelId: "discovered-code:latest",
    };
    await gateway.invoke(
      {
        ...modelRequest(),
        modelId: "discovered-code:latest" as never,
        configuration: {
          ...modelRequest().configuration,
          modelId: "discovered-code:latest" as never,
        },
      },
      context,
    );
    expect(discovery.calls.map((call) => call.method)).toEqual(["model.list", "model.invoke"]);
  });

  it("uses only the wall-clock time remaining before the operation deadline", () => {
    const started = Date.parse("2026-08-11T12:00:00.000Z");
    const deadlineContext = {
      ...context,
      startedAt: new Date(started).toISOString(),
      deadlineAt: new Date(started + 10_000).toISOString(),
    };
    expect(remainingTimeout(deadlineContext, 120_000, started + 3_000)).toBe(7_000);
    expect(remainingTimeout(deadlineContext, 5_000, started + 3_000)).toBe(5_000);
    expect(remainingTimeout(deadlineContext, 120_000, started + 11_000)).toBe(1);
  });

  it("rejects malformed pagination cursors", async () => {
    const gateway = new SupervisedModelGateway([], new Map());
    await expect(gateway.list({ limit: 1, cursor: "1junk" })).rejects.toMatchObject({
      code: "INVALID_APPLICATION_INPUT",
    });
  });

  it("translates an invocation to a model.invoke adapter call", async () => {
    const primary = new FakeInvoker("adapter-1", { result: modelResult });
    const gateway = new SupervisedModelGateway([], new Map([["model-1", { primary }]]));
    const result = await gateway.invoke(modelRequest(), context);
    expect(result.finishReason).toBe("completed");
    expect(primary.calls[0]?.method).toBe("model.invoke");
    expect(primary.calls[0]?.options.signal).toBe(context.signal);
    expect(primary.calls[0]?.params).toEqual({
      invocationId: "invoke-1",
      jobId: "job-1",
      modelId: "model-1",
      promptArtifactId: "prompt-1",
      configuration: modelRequest().configuration,
      resourceBudget: modelRequest().resourceBudget,
    });

    await gateway.cancel("invoke-1", context);
    expect(primary.calls[1]).toMatchObject({
      method: "adapter.cancel",
      params: { invocationId: "invoke-1" },
    });
  });

  it("falls back to the secondary adapter when the primary is unavailable", async () => {
    const primary = new FakeInvoker("adapter-1", { available: false });
    const fallback = new FakeInvoker("adapter-2", { result: modelResult });
    const binding: AdapterBinding = { primary, fallback };
    const gateway = new SupervisedModelGateway([], new Map([["model-1", binding]]));
    await gateway.invoke(modelRequest(), context);
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls[0]?.method).toBe("model.invoke");
  });

  it("reports DEPENDENCY_UNAVAILABLE when no adapter is available", async () => {
    const primary = new FakeInvoker("adapter-1", { available: false });
    const gateway = new SupervisedModelGateway([], new Map([["model-1", { primary }]]));
    await expect(gateway.invoke(modelRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });

  it("classifies an adapter transport error as DEPENDENCY_FAILURE", async () => {
    const primary = new FakeInvoker("adapter-1", { error: new Error("socket closed") });
    const gateway = new SupervisedModelGateway([], new Map([["model-1", { primary }]]));
    await expect(gateway.invoke(modelRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
  });

  it("preserves a remote adapter's non-retryable failure classification", async () => {
    const primary = new FakeInvoker("adapter-1", {
      error: new RpcRemoteError(-32000, "invalid candidate", false),
    });
    const gateway = new SupervisedModelGateway([], new Map([["model-1", { primary }]]));
    await expect(gateway.invoke(modelRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
      retryable: false,
    });
  });

  it("reports DEPENDENCY_UNAVAILABLE when the model has no binding", async () => {
    const gateway = new SupervisedModelGateway([], new Map());
    await expect(gateway.invoke(modelRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});

describe("SupervisedProductionKernel", () => {
  it("translates the port to the frozen kernel RPC methods and required fields", async () => {
    const primary = new FakeInvoker("kernel-adapter", {
      result: {
        operationId: "operation-1",
        acceptedAt: "2026-08-07T12:00:00.000Z",
        idempotencyKey: "job-1",
      },
    });
    const gateway = new SupervisedProductionKernel({ primary });
    const request: KernelStartRequest = {
      jobId: "job-1" as never,
      projectId: "project-1" as never,
      missionId: "mission-1" as never,
      workflowId: "stage4.tiny-code",
      input: {},
      resourceBudget: budget(),
    };

    await gateway.start(request, context);
    expect(primary.calls[0]).toMatchObject({
      method: "kernel.start_job",
      params: { jobId: "job-1", workflowId: "stage4.tiny-code" },
    });
    expect(
      (primary.calls[0]?.params as Record<string, unknown> | undefined)?.["invocationId"],
    ).toEqual(expect.any(String));

    primary.calls.length = 0;
    primary.behavior.result = "checkpoint-1";
    await gateway.checkpoint("job-1" as never, context);
    expect(primary.calls[0]).toMatchObject({
      method: "kernel.checkpoint_job",
      params: { jobId: "job-1", stage: "checkpointing" },
    });

    primary.calls.length = 0;
    primary.behavior.result = {
      operationId: "operation-2",
      acceptedAt: "2026-08-07T12:00:00.000Z",
      idempotencyKey: "job-1",
    };
    await gateway.resume("job-1" as never, "checkpoint-1" as never, context);
    expect(primary.calls[0]).toMatchObject({
      method: "kernel.resume_job",
      params: { jobId: "job-1", checkpointId: "checkpoint-1" },
    });

    primary.calls.length = 0;
    await gateway.stop("job-1" as never, "emergency_stop", context);
    expect(primary.calls[0]).toMatchObject({
      method: "kernel.stop_job",
      params: { jobId: "job-1", mode: "emergency_stop" },
    });

    primary.calls.length = 0;
    primary.behavior.result = {
      jobId: "job-1",
      status: "running",
      stage: "started",
      progress: 0,
      details: {},
    };
    await gateway.status("job-1" as never, context);
    expect(primary.calls[0]).toMatchObject({
      method: "kernel.job_status",
      params: { jobId: "job-1" },
    });
  });
});

describe("SupervisedToolGateway", () => {
  it("rejects malformed pagination cursors", async () => {
    const gateway = new SupervisedToolGateway([], new Map());
    await expect(gateway.list({ limit: 1, cursor: "1junk" })).rejects.toMatchObject({
      code: "INVALID_APPLICATION_INPUT",
    });
  });

  function toolRequest(): ToolInvocationRequest {
    return {
      invocationId: "invoke-1",
      jobId: "job-1" as never,
      toolId: "tool-1" as never,
      operation: "write",
      inputArtifactIds: [] as never,
      parameters: {},
      expectedOutputs: [],
      resourceBudget: budget(),
    };
  }

  it("translates a tool invocation and classifies failures", async () => {
    const primary = new FakeInvoker("tool-adapter", {
      result: {
        invocationId: "invoke-1",
        toolId: "tool-1",
        status: "completed",
        outputArtifactIds: [],
        logArtifactIds: [],
        metadata: {},
      },
    });
    const gateway = new SupervisedToolGateway([], new Map([["tool-1", { primary }]]));
    const result = await gateway.invoke(toolRequest(), context);
    expect(result.status).toBe("completed");
    expect(primary.calls[0]?.method).toBe("tool.invoke");
    expect(primary.calls[0]?.options.signal).toBe(context.signal);
    await gateway.cancel("invoke-1", context);
    expect(primary.calls[1]).toMatchObject({
      method: "adapter.cancel",
      params: { invocationId: "invoke-1" },
    });
  });
});
