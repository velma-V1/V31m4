import { describe, expect, it } from "vitest";
import {
  type AgentModelGatewayPort,
  type AgentTurnInvocationResult,
  type AgentTurnProposal,
  type ModelGatewayPort,
  supportsAgentTurns,
} from "../src/index.js";

const legacyOnly = {
  async list() {
    throw new Error("unused");
  },
  async get() {
    return null;
  },
  async invoke() {
    throw new Error("unused");
  },
  async cancel() {},
  async health() {
    throw new Error("unused");
  },
} as unknown as ModelGatewayPort;

const agentCapable: ModelGatewayPort = {
  ...legacyOnly,
  async invokeAgentTurn(): Promise<AgentTurnInvocationResult> {
    throw new Error("unused");
  },
} as AgentModelGatewayPort;

describe("the agent-turn model capability is additive", () => {
  it("leaves a legacy gateway valid and detectable as legacy", () => {
    expect(supportsAgentTurns(legacyOnly)).toBe(false);
    expect(supportsAgentTurns(agentCapable)).toBe(true);
    expect(typeof legacyOnly.invoke).toBe("function");
    expect(typeof (agentCapable as AgentModelGatewayPort).invoke).toBe("function");
  });

  it("narrows to the agent capability rather than assuming it", () => {
    const gateway: ModelGatewayPort = agentCapable;
    if (!supportsAgentTurns(gateway)) throw new Error("expected the agent capability");
    // Type-level: `gateway` is an `AgentModelGatewayPort` here, and legacy invoke survives.
    expect(typeof gateway.invokeAgentTurn).toBe("function");
    expect(typeof gateway.invoke).toBe("function");
  });

  it("models a turn as exactly one bounded outcome with no reasoning channel", () => {
    const turns: readonly AgentTurnProposal[] = [
      { kind: "tool_call", operation: "repo.search", parameters: { query: "x" } },
      { kind: "finish", summary: "ready for verification" },
      { kind: "defer", reason: "insufficient evidence" },
    ];
    expect(turns.map((turn) => turn.kind)).toEqual(["tool_call", "finish", "defer"]);
    for (const turn of turns) {
      expect(Object.keys(turn)).not.toContain("reasoning");
      expect(Object.keys(turn)).not.toContain("thinking");
    }
  });
});
