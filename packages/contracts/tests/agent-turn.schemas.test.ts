import { describe, expect, it } from "vitest";
import {
  AGENT_REASONING_POLICIES,
  AGENT_TURN_CONTRACT_VERSION,
  AGENT_TURN_KINDS,
  agentContextBudgetSchema,
  agentReasoningPolicySchema,
  agentTurnInvocationParamsSchema,
  agentTurnInvocationResultSchema,
  agentTurnSchema,
  containsPrivateReasoningKey,
  PRIVATE_REASONING_KEYS,
} from "../src/agent-turn.schemas.js";

const budget = {
  maxWallClockMs: 60_000,
  maxModelInvocations: 1,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
} as const;

const contextBudget = { maxPromptBytes: 131_072, maxPromptTokens: 32_768 } as const;

const invocationParams = {
  invocationId: "invocation:1",
  jobId: "job:1",
  taskId: "task:root",
  modelId: "model:qwen",
  promptArtifactId: "artifact:prompt",
  outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
  allowedOperations: ["repo.search", "code.inspect"],
  reasoningPolicy: "disabled",
  contextBudget,
  resourceBudget: budget,
} as const;

const toolCall = {
  kind: "tool_call",
  operation: "repo.search",
  parameters: { query: "authorizeSemanticExecution" },
} as const;
const finish = { kind: "finish", summary: "The bounded task is ready for verification." } as const;
const defer = { kind: "defer", reason: "The failing test cannot be reproduced yet." } as const;

describe("the agent turn is bounded actionable output only", () => {
  it("declares exactly three kinds and its own output-contract version", () => {
    expect([...AGENT_TURN_KINDS]).toEqual(["tool_call", "finish", "defer"]);
    expect(AGENT_TURN_CONTRACT_VERSION).toBe("1.0.0");
    expect([...AGENT_REASONING_POLICIES]).toEqual(["disabled", "enabled", "auto"]);
    for (const policy of AGENT_REASONING_POLICIES) {
      expect(agentReasoningPolicySchema.parse(policy)).toBe(policy);
    }
    expect(agentReasoningPolicySchema.safeParse("verbose").success).toBe(false);
  });

  it("parses each kind into exactly the fields that kind owns", () => {
    expect(agentTurnSchema.parse(toolCall)).toEqual(toolCall);
    expect(agentTurnSchema.parse(finish)).toEqual(finish);
    expect(agentTurnSchema.parse(defer)).toEqual(defer);
  });

  it("rejects a turn that mixes kinds, omits its own fields, or invents new ones", () => {
    for (const malformed of [
      { kind: "tool_call", operation: "repo.search" },
      { kind: "tool_call", parameters: {} },
      { kind: "tool_call", operation: "repo.search", parameters: {}, summary: "done" },
      { kind: "finish" },
      { kind: "finish", summary: "" },
      { kind: "finish", summary: "done", operation: "repo.search" },
      { kind: "defer" },
      { kind: "defer", reason: "  padded  " },
      { kind: "escalate", reason: "please help" },
      { kind: "tool_call", operation: "REPO.SEARCH", parameters: {} },
      { kind: "tool_call", operation: "gitworktree", parameters: {} },
      toolCall.parameters,
      "tool_call",
      null,
      [toolCall],
    ]) {
      expect(agentTurnSchema.safeParse(malformed).success).toBe(false);
    }
  });

  it("has no field a model could use to hand back private reasoning", () => {
    expect(PRIVATE_REASONING_KEYS.length).toBeGreaterThan(4);
    for (const key of PRIVATE_REASONING_KEYS) {
      expect(agentTurnSchema.safeParse({ ...finish, [key]: "step 1 ..." }).success).toBe(false);
      // Not just at the top level: the parameters bag is model-supplied JSON, and it is
      // persisted in the Execution Ledger, so reasoning smuggled into it would become durable.
      expect(
        agentTurnSchema.safeParse({
          ...toolCall,
          parameters: { query: "x", nested: { [key]: "step 1 ..." } },
        }).success,
      ).toBe(false);
      expect(containsPrivateReasoningKey({ deep: [{ [key]: "x" }] })).toBe(true);
    }
    expect(containsPrivateReasoningKey({ query: "x", limit: 5 })).toBe(false);
  });

  it("rejects prototype-pollution property names anywhere in a turn", () => {
    expect(
      agentTurnSchema.safeParse(JSON.parse('{"kind":"finish","summary":"x","__proto__":{}}'))
        .success,
    ).toBe(false);
    expect(
      agentTurnSchema.safeParse(
        JSON.parse(
          '{"kind":"tool_call","operation":"repo.search","parameters":{"a":{"constructor":1}}}',
        ),
      ).success,
    ).toBe(false);
  });
});

describe("the provider-neutral agent invocation contract", () => {
  it("carries the reasoning policy, output contract, allowed operations, and context budget", () => {
    const parsed = agentTurnInvocationParamsSchema.parse(invocationParams);
    expect(parsed.reasoningPolicy).toBe("disabled");
    expect(parsed.outputContractVersion).toBe(AGENT_TURN_CONTRACT_VERSION);
    expect([...parsed.allowedOperations]).toEqual(["repo.search", "code.inspect"]);
    expect(parsed.contextBudget).toEqual(contextBudget);
  });

  it("refuses an unbounded, empty, duplicated, or provider-specific invocation", () => {
    for (const invalid of [
      { ...invocationParams, allowedOperations: [] },
      { ...invocationParams, allowedOperations: ["repo.search", "repo.search"] },
      { ...invocationParams, outputContractVersion: "1.1.0" },
      { ...invocationParams, reasoningPolicy: "think" },
      { ...invocationParams, contextBudget: { maxPromptBytes: 0, maxPromptTokens: 32_768 } },
      { ...invocationParams, contextBudget: { maxPromptTokens: 32_768 } },
      { ...invocationParams, contextBudget: { ...contextBudget, numGpu: 99 } },
      { ...invocationParams, ollamaOptions: { numGpu: 99 } },
      { ...invocationParams, think: true },
    ]) {
      expect(agentTurnInvocationParamsSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("returns one validated turn and no reasoning trace", () => {
    const result = {
      invocationId: "invocation:1",
      modelId: "model:qwen",
      outputContractVersion: AGENT_TURN_CONTRACT_VERSION,
      turn: toolCall,
      usage: { inputTokens: 12, outputTokens: 8, wallClockMs: 900 },
      metadata: { adapterId: "ollama-local-supervised" },
    } as const;
    expect(agentTurnInvocationResultSchema.parse(result).turn).toEqual(toolCall);
    for (const key of PRIVATE_REASONING_KEYS) {
      expect(agentTurnInvocationResultSchema.safeParse({ ...result, [key]: "..." }).success).toBe(
        false,
      );
      expect(
        agentTurnInvocationResultSchema.safeParse({ ...result, metadata: { [key]: "..." } })
          .success,
      ).toBe(false);
    }
    expect(
      agentTurnInvocationResultSchema.safeParse({ ...result, turn: { kind: "finish" } }).success,
    ).toBe(false);
  });

  it("bounds the context budget instead of letting a caller declare an unlimited one", () => {
    expect(agentContextBudgetSchema.parse(contextBudget)).toEqual(contextBudget);
    for (const invalid of [
      { maxPromptBytes: -1, maxPromptTokens: 1 },
      { maxPromptBytes: 1.5, maxPromptTokens: 1 },
      { maxPromptBytes: Number.MAX_SAFE_INTEGER, maxPromptTokens: 1 },
      { maxPromptBytes: 1, maxPromptTokens: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(agentContextBudgetSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
