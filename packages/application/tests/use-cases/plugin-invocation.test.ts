import { describe, expect, it } from "vitest";
import { invokeModel, invokeTool, registerPlugin } from "../../src/index.js";
import { Harness, approvedPluginManifest, context, modelRequest, toolRequest } from "./fixtures.js";

describe("plugin and governed invocation use cases", () => {
  it("registers a plugin through policy and records an audit event", async () => {
    const harness = new Harness();
    const plugin = await registerPlugin({ unitOfWork: harness.unitOfWork, plugins: harness.pluginRegistry, policy: harness.policy, approvals: harness.approvalStore, audit: harness.audit, clock: harness.clock }, approvedPluginManifest(), "audit-plugin-1", undefined, context);
    expect(plugin.value.status).toBe("registered");
    expect(harness.audits[0]?.action).toBe("plugin.register");
  });

  it("audits successful model and tool invocations", async () => {
    const harness = new Harness();
    const model = await invokeModel({ unitOfWork: harness.unitOfWork, models: harness.modelGateway, policy: harness.policy, approvals: harness.approvalStore, audit: harness.audit, clock: harness.clock }, modelRequest(), "audit-model-1", undefined, context);
    const tool = await invokeTool({ unitOfWork: harness.unitOfWork, tools: harness.toolGateway, policy: harness.policy, approvals: harness.approvalStore, audit: harness.audit, clock: harness.clock }, toolRequest(), "audit-tool-1", undefined, context);
    expect(model.finishReason).toBe("completed");
    expect(tool.status).toBe("completed");
    expect(harness.audits.map((record) => record.outcome)).toEqual(["completed", "completed"]);
  });

  it("audits dependency failure without swallowing it", async () => {
    const harness = new Harness();
    harness.modelFailure = new Error("provider failed");
    await expect(invokeModel({ unitOfWork: harness.unitOfWork, models: harness.modelGateway, policy: harness.policy, approvals: harness.approvalStore, audit: harness.audit, clock: harness.clock }, modelRequest(), "audit-model-1", undefined, context)).rejects.toThrow();
    expect(harness.audits[0]?.outcome).toBe("failed");
  });
});
