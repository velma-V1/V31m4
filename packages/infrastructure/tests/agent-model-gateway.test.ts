import {
  type AgentTurnInvocationRequest,
  ApplicationError,
  supportsAgentTurns,
} from "@v31m4/application";
import { ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import type { AdapterInvoker, InvokeOptions } from "../src/gateways/adapter-invoker.js";
import { SupervisedModelGateway } from "../src/gateways/supervised-model-gateway.js";
import { context } from "./fixtures.js";

class FakeInvoker implements AdapterInvoker {
  public calls: { method: string; params: unknown }[] = [];
  constructor(
    readonly id: string,
    public result: unknown,
  ) {}
  available(): boolean {
    return true;
  }
  async invoke(method: string, params: unknown, _options: InvokeOptions): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "model.list") {
      return {
        models: [
          {
            modelId: "qwen-agent:27b",
            adapterId: this.id,
            displayName: "qwen-agent:27b",
            status: "available",
            local: true,
            measuredCapabilities: [],
            supportedModalities: ["text"],
          },
        ],
      };
    }
    return this.result;
  }
}

function agentRequest(
  overrides: Partial<AgentTurnInvocationRequest> = {},
): AgentTurnInvocationRequest {
  return {
    invocationId: "invocation-agent-1",
    jobId: "job-agent-1" as never,
    taskId: "task:agent" as never,
    modelId: "qwen-agent:27b" as never,
    promptArtifactId: "artifact-agent-context" as never,
    outputContractVersion: "1.0.0",
    allowedOperations: ["repo.search", "code.inspect"],
    reasoningPolicy: "disabled",
    contextBudget: { maxPromptBytes: 131_072, maxPromptTokens: 32_768 },
    resourceBudget: ResourceBudget.create({
      maxWallClockMs: 60_000,
      maxModelInvocations: 1,
      maxToolInvocations: 4,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    }),
    metadata: {},
    ...overrides,
  };
}

const goodResult = {
  invocationId: "invocation-agent-1",
  modelId: "qwen-agent:27b",
  outputContractVersion: "1.0.0",
  turn: { kind: "tool_call", operation: "repo.search", parameters: { query: "authorize" } },
  usage: { inputTokens: 40, outputTokens: 12, wallClockMs: 900 },
  metadata: { adapterId: "ollama-local-supervised" },
};

function gatewayFor(result: unknown): {
  gateway: SupervisedModelGateway;
  invoker: FakeInvoker;
} {
  const invoker = new FakeInvoker("ollama-local-supervised", result);
  return {
    gateway: new SupervisedModelGateway([], new Map(), 120_000, { primary: invoker }),
    invoker,
  };
}

describe("SupervisedModelGateway agent turns", () => {
  it("advertises the agent capability alongside the legacy invocation path", () => {
    const { gateway } = gatewayFor(goodResult);
    expect(supportsAgentTurns(gateway)).toBe(true);
    expect(typeof gateway.invoke).toBe("function");
  });

  it("translates one provider-neutral request into the 1.1 agent method", async () => {
    const { gateway, invoker } = gatewayFor(goodResult);
    const result = await gateway.invokeAgentTurn(agentRequest(), context);
    expect(invoker.calls.map((call) => call.method)).toEqual(["model.list", "model.invoke_agent"]);
    const params = invoker.calls[1]?.params as Record<string, unknown>;
    expect(params).toMatchObject({
      invocationId: "invocation-agent-1",
      taskId: "task:agent",
      outputContractVersion: "1.0.0",
      reasoningPolicy: "disabled",
      allowedOperations: ["repo.search", "code.inspect"],
      contextBudget: { maxPromptBytes: 131_072, maxPromptTokens: 32_768 },
    });
    // Runtime-only bookkeeping never travels to a provider.
    expect(params["metadata"]).toBeUndefined();
    expect(result.turn).toEqual(goodResult.turn);
    expect(result.usage.wallClockMs).toBe(900);
  });

  it("refuses an adapter answer that does not match the request it answers", async () => {
    for (const broken of [
      { ...goodResult, invocationId: "invocation-agent-2" },
      { ...goodResult, modelId: "some-other-model:7b" },
      { ...goodResult, outputContractVersion: "1.1.0" },
      { ...goodResult, extra: true },
      { ...goodResult, usage: { wallClockMs: -1 } },
      { ...goodResult, metadata: "not-an-object" },
      "not-an-object",
      null,
    ]) {
      const { gateway } = gatewayFor(broken);
      await expect(gateway.invokeAgentTurn(agentRequest(), context)).rejects.toBeInstanceOf(
        ApplicationError,
      );
    }
  });

  it("refuses a malformed turn, a mixed turn, and an unknown turn kind", async () => {
    for (const turn of [
      { kind: "tool_call", operation: "repo.search" },
      { kind: "tool_call", operation: "repo.search", parameters: [] },
      { kind: "tool_call", operation: "repo.search", parameters: {}, summary: "done" },
      { kind: "finish" },
      { kind: "finish", summary: "" },
      { kind: "defer", reason: 12 },
      { kind: "escalate", reason: "help" },
      null,
    ]) {
      const { gateway } = gatewayFor({ ...goodResult, turn });
      await expect(gateway.invokeAgentTurn(agentRequest(), context)).rejects.toBeInstanceOf(
        ApplicationError,
      );
    }
  });

  it("refuses an operation the role manifest did not offer", async () => {
    const { gateway } = gatewayFor({
      ...goodResult,
      turn: { kind: "tool_call", operation: "command.run", parameters: { executable: "sh" } },
    });
    await expect(gateway.invokeAgentTurn(agentRequest(), context)).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
  });

  it("refuses any adapter answer carrying a private reasoning trace", async () => {
    for (const broken of [
      { ...goodResult, thinking: "step 1 ..." },
      { ...goodResult, metadata: { reasoning: "step 1 ..." } },
      {
        ...goodResult,
        turn: { kind: "finish", summary: "done", chain_of_thought: "step 1 ..." },
      },
      {
        ...goodResult,
        turn: {
          kind: "tool_call",
          operation: "repo.search",
          parameters: { query: "x", scratchpad: "step 1 ..." },
        },
      },
    ]) {
      const { gateway } = gatewayFor(broken);
      await expect(gateway.invokeAgentTurn(agentRequest(), context)).rejects.toMatchObject({
        code: "DEPENDENCY_FAILURE",
      });
    }
  });

  it("reports a model with no bound adapter as unavailable rather than succeeding", async () => {
    const gateway = new SupervisedModelGateway([], new Map(), 120_000);
    await expect(
      gateway.invokeAgentTurn(agentRequest({ modelId: "absent:1b" as never }), context),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", retryable: true });
  });
});
