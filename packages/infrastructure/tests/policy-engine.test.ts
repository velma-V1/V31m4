import type { PolicyRequest } from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { type PolicyRule, RuleBasedPolicyEngine } from "../src/policy/rule-based-policy-engine.js";
import { context } from "./fixtures.js";

function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    action: "project.create",
    resourceType: "project",
    actor: { id: "user-1", kind: "user", roles: ["operator"] },
    attributes: {},
    ...overrides,
  };
}

const rules: readonly PolicyRule[] = [
  {
    id: "deny-model-writes",
    effect: "deny",
    actions: ["tool.write"],
    actorKinds: ["model"],
    reason: "Models may not write directly.",
  },
  {
    id: "approve-plugin-register",
    effect: "require_approval",
    actions: ["plugin.register"],
    requiredApprovalScopes: ["plugin:install"],
    reason: "Plugin installation requires approval.",
  },
  {
    id: "allow-operator-projects",
    effect: "allow",
    actions: ["project.*"],
    requiredRoles: ["operator"],
    reason: "Operators manage projects.",
  },
];

describe("RuleBasedPolicyEngine", () => {
  it("allows an action matched by an allow rule when the actor holds the required role", async () => {
    const engine = new RuleBasedPolicyEngine(rules);
    const result = await engine.evaluate(request(), context);
    expect(result.decision).toBe("allow");
    expect(result.policyId).toBe("allow-operator-projects");
  });

  it("requires approval with the rule's scopes", async () => {
    const engine = new RuleBasedPolicyEngine(rules);
    const result = await engine.evaluate(
      request({ action: "plugin.register", resourceType: "plugin" }),
      context,
    );
    expect(result.decision).toBe("require_approval");
    expect(result.requiredApprovalScopes).toEqual(["plugin:install"]);
  });

  it("denies via an explicit deny rule that precedes any allow", async () => {
    const engine = new RuleBasedPolicyEngine(rules);
    const result = await engine.evaluate(
      request({
        action: "tool.write",
        resourceType: "tool",
        actor: { id: "m", kind: "model", roles: [] },
      }),
      context,
    );
    expect(result.decision).toBe("deny");
    expect(result.policyId).toBe("deny-model-writes");
  });

  it("fails closed with default-deny when no rule matches", async () => {
    const engine = new RuleBasedPolicyEngine(rules);
    const result = await engine.evaluate(request({ action: "unknown.action" }), context);
    expect(result.decision).toBe("deny");
    expect(result.policyId).toBe("default-deny");
  });

  it("denies when the actor lacks a required role", async () => {
    const engine = new RuleBasedPolicyEngine(rules);
    const result = await engine.evaluate(
      request({ actor: { id: "guest", kind: "user", roles: [] } }),
      context,
    );
    expect(result.decision).toBe("deny");
    expect(result.policyId).toBe("default-deny");
  });
});
