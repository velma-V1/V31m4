import { describe, expect, it } from "vitest";
import {
  approvalRequestSchema,
  decideApprovalRequestSchema,
  decideApprovalResponseSchema,
  listApprovalsRequestSchema,
  listApprovalsResponseSchema,
  registerGovernedPluginRequestSchema,
  registerGovernedPluginResponseSchema,
} from "../src/approvals.schemas.js";

const metadata = { schemaVersion: "1.0.0", requestId: "request:approval" } as const;
const actor = { id: "operator", kind: "user", roles: ["operator"] } as const;

const manifest = {
  schemaVersion: "1.0.0",
  pluginId: "plugin:approval-proof",
  displayName: "Approval Proof",
  version: "1.0.0",
  minimumRuntimeVersion: "1.0.0",
  entrypoint: "plugins/approval-proof/index.js",
  capabilities: ["capability:approval-proof"],
  requiredToolIds: [],
  optionalToolIds: [],
  workflowIds: ["workflow:approval-proof"],
  verifierIds: ["verifier:approval-proof"],
  permissions: { filesystem: ["project_read"], network: false, process: [] },
} as const;

const pending = {
  id: "approval:one",
  action: "plugin.register",
  resourceType: "plugin",
  resourceId: "plugin:approval-proof",
  requestedBy: actor,
  requiredScopes: ["plugin:register"],
  context: { version: "1.0.0", network: false },
  status: "pending",
  requestedAt: "2026-08-11T12:00:00.000Z",
  expiresAt: "2026-08-11T13:00:00.000Z",
} as const;

describe("approval runtime contracts", () => {
  it("validates strict pending and decided approval lifecycle records", () => {
    expect(approvalRequestSchema.parse(pending)).toEqual(pending);
    expect(
      approvalRequestSchema.safeParse({
        ...pending,
        requiredScopes: ["plugin:register", "plugin:register"],
      }).success,
    ).toBe(false);
    expect(approvalRequestSchema.safeParse({ ...pending, status: "granted" }).success).toBe(false);
    expect(approvalRequestSchema.safeParse({ ...pending, unexpected: true }).success).toBe(false);

    const granted = {
      ...pending,
      status: "granted" as const,
      decidedBy: actor,
      decidedAt: "2026-08-11T12:05:00.000Z",
      decisionReason: "Reviewed and approved.",
    };
    expect(approvalRequestSchema.safeParse(granted).success).toBe(true);
    expect(
      approvalRequestSchema.safeParse({
        ...granted,
        decidedAt: "2026-08-11T11:59:59.999Z",
      }).success,
    ).toBe(false);
  });

  it("validates protected plugin registration and decision envelopes", () => {
    expect(registerGovernedPluginRequestSchema.parse({ ...metadata, manifest })).toMatchObject({
      manifest: { pluginId: "plugin:approval-proof" },
    });
    expect(
      registerGovernedPluginRequestSchema.safeParse({
        ...metadata,
        manifest,
        approvalId: "approval:one",
        hidden: true,
      }).success,
    ).toBe(false);

    expect(
      registerGovernedPluginResponseSchema.safeParse({
        ...metadata,
        outcome: "approval_required",
        approval: pending,
      }).success,
    ).toBe(true);
    expect(
      registerGovernedPluginResponseSchema.safeParse({
        ...metadata,
        outcome: "registered",
        plugin: {
          pluginId: manifest.pluginId,
          version: manifest.version,
          status: "registered",
          capabilities: manifest.capabilities,
          requiredToolIds: [],
          optionalToolIds: [],
        },
      }).success,
    ).toBe(true);

    expect(
      decideApprovalRequestSchema.parse({
        ...metadata,
        approvalId: "approval:one",
        decision: "grant",
        reason: "Reviewed and approved.",
      }),
    ).toMatchObject({ decision: "grant" });
    expect(
      decideApprovalRequestSchema.safeParse({
        ...metadata,
        approvalId: "approval:one",
        decision: "grant",
      }).success,
    ).toBe(false);
    expect(
      decideApprovalResponseSchema.safeParse({
        ...metadata,
        approval: {
          ...pending,
          status: "denied",
          decidedBy: actor,
          decidedAt: "2026-08-11T12:05:00.000Z",
          decisionReason: "Risk was not accepted.",
        },
      }).success,
    ).toBe(true);
  });

  it("validates status-filtered approval lists and rejects duplicates", () => {
    expect(
      listApprovalsRequestSchema.parse({
        ...metadata,
        status: "pending",
        pagination: { limit: 10 },
      }),
    ).toMatchObject({ status: "pending" });
    expect(
      listApprovalsResponseSchema.safeParse({
        ...metadata,
        approvals: [pending],
        pagination: { total: 1 },
      }).success,
    ).toBe(true);
    expect(
      listApprovalsResponseSchema.safeParse({
        ...metadata,
        approvals: [pending, pending],
        pagination: { total: 2 },
      }).success,
    ).toBe(false);
  });
});
