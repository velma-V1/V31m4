import type { ModelInvocationRequest, ToolInvocationRequest } from "@v31m4/application";
import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import type {
  AdapterBinding,
  AdapterInvoker,
  InvokeOptions,
} from "../src/gateways/adapter-invoker.js";
import { SupervisedModelGateway } from "../src/gateways/supervised-model-gateway.js";
import { SupervisedToolGateway } from "../src/gateways/supervised-tool-gateway.js";
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
  public calls: { method: string; params: unknown }[] = [];
  constructor(
    readonly id: string,
    private readonly behavior: { available?: boolean; result?: unknown; error?: Error } = {},
  ) {}
  available(): boolean {
    return this.behavior.available ?? true;
  }
  async invoke(method: string, params: unknown, _options: InvokeOptions): Promise<unknown> {
    this.calls.push({ method, params });
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
  it("translates an invocation to a model.invoke adapter call", async () => {
    const primary = new FakeInvoker("adapter-1", { result: modelResult });
    const gateway = new SupervisedModelGateway([], new Map([["model-1", { primary }]]));
    const result = await gateway.invoke(modelRequest(), context);
    expect(result.finishReason).toBe("completed");
    expect(primary.calls[0]?.method).toBe("model.invoke");
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

  it("reports DEPENDENCY_UNAVAILABLE when the model has no binding", async () => {
    const gateway = new SupervisedModelGateway([], new Map());
    await expect(gateway.invoke(modelRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});

describe("SupervisedToolGateway", () => {
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
  });
});
