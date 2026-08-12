import { describe, expect, it } from "vitest";
import {
  type ApprovalRequest,
  type ApprovalStorePort,
  type AuditRecord,
  type AuditStorePort,
  createOperationContext,
  decideApproval,
  type OperationContext,
  type PolicyEnginePort,
  registerPlugin,
  requestApproval,
  type UnitOfWorkPort,
  type Versioned,
} from "../../src/index.js";
import { approvedPluginManifest, T0, T1, T2 } from "./fixtures.js";

function operation(
  actor: { id: string; kind: "user"; roles: readonly string[] } = {
    id: "operator",
    kind: "user",
    roles: ["operator"],
  },
): OperationContext {
  return createOperationContext({
    requestId: "request:approval",
    idempotencyKey: "idempotency:approval",
    actor,
    startedAt: T0,
  });
}

function harness() {
  const approvals = new Map<string, Versioned<ApprovalRequest>>();
  const audits: AuditRecord[] = [];
  const plugins = new Map<string, unknown>();
  let now = T0;
  let policyMode: "allow" | "deny" | "require_approval" = "require_approval";
  let scopes: readonly string[] = ["plugin:register"];
  const unitOfWork: UnitOfWorkPort = {
    execute: async (context, work) =>
      work({
        id: "transaction:approval",
        startedAt: context.startedAt,
        afterCommit() {},
        afterRollback() {},
      }),
  };
  const policy: PolicyEnginePort = {
    evaluate: async (request) => ({
      decision:
        request.action === "approval.decide" && request.actor.roles.includes("operator")
          ? "allow"
          : policyMode,
      policyId: "policy:approval-proof",
      reasons: policyMode === "deny" ? ["Denied for test."] : [],
      requiredApprovalScopes: policyMode === "require_approval" ? scopes : [],
    }),
  };
  const approvalStore: ApprovalStorePort = {
    get: async (id) => approvals.get(id) ?? null,
    list: async () => ({ items: [...approvals.values()] }),
    save: async (request, condition) => {
      const current = approvals.get(request.id);
      if (condition.kind === "must_not_exist" && current !== undefined) throw new Error("exists");
      if (condition.kind === "match_revision" && current?.revision !== condition.revision) {
        throw new Error("revision conflict");
      }
      const stored = { value: request, revision: String(Number(current?.revision ?? "0") + 1) };
      approvals.set(request.id, stored);
      return stored;
    },
    consume: async (id, condition) => {
      const current = approvals.get(id);
      if (current === undefined) throw new Error("missing");
      if (condition.kind !== "match_revision" || condition.revision !== current.revision) {
        throw new Error("revision conflict");
      }
      const stored = {
        value: { ...current.value, status: "consumed" as const },
        revision: String(Number(current.revision) + 1),
      };
      approvals.set(id, stored);
      return stored;
    },
  };
  const audit: AuditStorePort = {
    append: async (record) => {
      audits.push(record);
    },
    list: async () => ({ items: [...audits] }),
  };
  return {
    approvals,
    audits,
    plugins,
    unitOfWork,
    policy,
    approvalStore,
    audit,
    clock: { now: () => now, monotonicMilliseconds: () => 0, async sleep() {} },
    setNow(value: string) {
      now = value;
    },
    setPolicy(value: typeof policyMode, requiredScopes = scopes) {
      policyMode = value;
      scopes = requiredScopes;
    },
    pluginRegistry: {
      register: async (manifest: ReturnType<typeof approvedPluginManifest>) => {
        if (plugins.has(manifest.pluginId)) throw new Error("plugin exists");
        const value = {
          pluginId: manifest.pluginId,
          version: manifest.version,
          status: "registered" as const,
          capabilities: manifest.capabilities,
          requiredToolIds: manifest.requiredToolIds,
          optionalToolIds: manifest.optionalToolIds,
        };
        plugins.set(manifest.pluginId, value);
        return { value, revision: "1" };
      },
    },
  };
}

describe("approval lifecycle use cases", () => {
  it("creates a policy-linked pending request and records approval-required audit", async () => {
    const state = harness();
    const created = await requestApproval(
      {
        unitOfWork: state.unitOfWork,
        policy: state.policy,
        approvals: state.approvalStore,
        audit: state.audit,
        clock: state.clock,
      },
      {
        approvalId: "approval:one",
        action: "plugin.register",
        resourceType: "plugin",
        resourceId: "plugin:one",
        attributes: { version: "1.0.0", network: false },
        expiresAt: T2,
        auditId: "audit:request",
      },
      operation(),
    );

    expect(created.value).toMatchObject({
      id: "approval:one",
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: "plugin:one",
      requestedBy: { id: "operator" },
      requiredScopes: ["plugin:register"],
      context: { version: "1.0.0", network: false },
      status: "pending",
      requestedAt: T0,
      expiresAt: T2,
    });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "approval.request",
        resourceType: "approval",
        resourceId: "approval:one",
        outcome: "accepted",
      }),
    ]);
  });

  it("grants or denies only pending non-expired approvals under approval-decision policy", async () => {
    const state = harness();
    const context = operation();
    const pending: ApprovalRequest = {
      id: "approval:one",
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: "plugin:one",
      requestedBy: context.actor,
      requiredScopes: ["plugin:register"],
      context: { version: "1.0.0" },
      status: "pending",
      requestedAt: T0,
      expiresAt: T2,
    };
    state.approvals.set(pending.id, { value: pending, revision: "1" });
    state.setNow(T1);

    const granted = await decideApproval(
      {
        unitOfWork: state.unitOfWork,
        policy: state.policy,
        approvals: state.approvalStore,
        audit: state.audit,
        clock: state.clock,
      },
      {
        approvalId: pending.id,
        decision: "grant",
        reason: "Reviewed and approved.",
        auditId: "audit:decision",
      },
      context,
    );
    expect(granted.value).toMatchObject({
      status: "granted",
      decidedBy: context.actor,
      decidedAt: T1,
      decisionReason: "Reviewed and approved.",
    });
    expect(state.audits[0]).toMatchObject({ action: "approval.decide", outcome: "completed" });

    await expect(
      decideApproval(
        {
          unitOfWork: state.unitOfWork,
          policy: state.policy,
          approvals: state.approvalStore,
          audit: state.audit,
          clock: state.clock,
        },
        {
          approvalId: pending.id,
          decision: "deny",
          reason: "Cannot decide twice.",
          auditId: "audit:decision:two",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    state.approvals.set("approval:two", {
      value: { ...pending, id: "approval:two" },
      revision: "1",
    });
    const denied = await decideApproval(
      {
        unitOfWork: state.unitOfWork,
        policy: state.policy,
        approvals: state.approvalStore,
        audit: state.audit,
        clock: state.clock,
      },
      {
        approvalId: "approval:two",
        decision: "deny",
        reason: "Risk was not accepted.",
        auditId: "audit:decision:deny",
      },
      context,
    );
    expect(denied.value.status).toBe("denied");
    expect(state.audits.at(-1)).toMatchObject({ action: "approval.decide", outcome: "denied" });
  });

  it("rejects every represented approval mismatch before the plugin effect", async () => {
    const manifest = approvedPluginManifest();
    const baseContext = operation();
    const cases: readonly [string, Partial<ApprovalRequest>][] = [
      ["wrong action", { action: "plugin.activate" }],
      ["wrong resource type", { resourceType: "project" }],
      ["wrong resource", { resourceId: "plugin:other" }],
      ["wrong requester", { requestedBy: { id: "other", kind: "user", roles: ["operator"] } }],
      ["wrong scope", { requiredScopes: ["plugin:read"] }],
      ["wrong context", { context: { version: "2.0.0", network: false } }],
      ["denied", { status: "denied" }],
      ["consumed", { status: "consumed" }],
    ];

    for (const [label, override] of cases) {
      const state = harness();
      const approval: ApprovalRequest = {
        id: `approval:${label.replaceAll(" ", "-")}`,
        action: "plugin.register",
        resourceType: "plugin",
        resourceId: manifest.pluginId,
        requestedBy: baseContext.actor,
        requiredScopes: ["plugin:register"],
        context: { version: manifest.version, network: manifest.permissions.network },
        status: "granted",
        requestedAt: T0,
        expiresAt: T2,
        decidedBy: baseContext.actor,
        decidedAt: T1,
        decisionReason: "Approved.",
        ...override,
      };
      state.approvals.set(approval.id, { value: approval, revision: "1" });
      state.setNow(T1);
      await expect(
        registerPlugin(
          {
            unitOfWork: state.unitOfWork,
            plugins: state.pluginRegistry as never,
            policy: state.policy,
            approvals: state.approvalStore,
            audit: state.audit,
            clock: state.clock,
          },
          manifest,
          `audit:${label.replaceAll(" ", "-")}`,
          approval.id,
          baseContext,
        ),
        label,
      ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect(state.plugins.size).toBe(0);
    }
  });

  it("consumes a matching approval once and records consumption before protected audit", async () => {
    const state = harness();
    const context = operation();
    const manifest = approvedPluginManifest();
    const approval: ApprovalRequest = {
      id: "approval:valid",
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: manifest.pluginId,
      requestedBy: context.actor,
      requiredScopes: ["plugin:register"],
      context: { version: manifest.version, network: manifest.permissions.network },
      status: "granted",
      requestedAt: T0,
      expiresAt: T2,
      decidedBy: context.actor,
      decidedAt: T1,
      decisionReason: "Approved.",
    };
    state.approvals.set(approval.id, { value: approval, revision: "1" });
    state.setNow(T1);

    await registerPlugin(
      {
        unitOfWork: state.unitOfWork,
        plugins: state.pluginRegistry as never,
        policy: state.policy,
        approvals: state.approvalStore,
        audit: state.audit,
        clock: state.clock,
      },
      manifest,
      "audit:plugin",
      approval.id,
      context,
    );
    expect(state.approvals.get(approval.id)?.value.status).toBe("consumed");
    expect(state.audits.map((record) => record.action)).toEqual([
      "approval.consume",
      "plugin.register",
    ]);
    await expect(
      registerPlugin(
        {
          unitOfWork: state.unitOfWork,
          plugins: state.pluginRegistry as never,
          policy: state.policy,
          approvals: state.approvalStore,
          audit: state.audit,
          clock: state.clock,
        },
        manifest,
        "audit:plugin:replay",
        approval.id,
        context,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("rejects an approval at its exact expiry and leaves it unconsumed", async () => {
    const state = harness();
    const context = operation();
    const manifest = approvedPluginManifest();
    const approval: ApprovalRequest = {
      id: "approval:expired",
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: manifest.pluginId,
      requestedBy: context.actor,
      requiredScopes: ["plugin:register"],
      context: { version: manifest.version, network: manifest.permissions.network },
      status: "granted",
      requestedAt: T0,
      expiresAt: T2,
      decidedBy: context.actor,
      decidedAt: T1,
      decisionReason: "Approved.",
    };
    state.approvals.set(approval.id, { value: approval, revision: "1" });
    state.setNow(T2);
    await expect(
      registerPlugin(
        {
          unitOfWork: state.unitOfWork,
          plugins: state.pluginRegistry as never,
          policy: state.policy,
          approvals: state.approvalStore,
          audit: state.audit,
          clock: state.clock,
        },
        manifest,
        "audit:expired",
        approval.id,
        context,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(state.approvals.get(approval.id)?.value.status).toBe("granted");
  });
});
