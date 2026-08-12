import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonValue,
  type ApprovalStorePort,
  type AuditStorePort,
  type ClockPort,
  decideApproval,
  type PluginRegistryPort,
  type PolicyEnginePort,
  registerPlugin,
  requestApproval,
} from "@v31m4/application";
import {
  decideApprovalRequestSchema,
  decideApprovalResponseSchema,
  listApprovalsRequestSchema,
  listApprovalsResponseSchema,
  registerGovernedPluginRequestSchema,
  registerGovernedPluginResponseSchema,
} from "@v31m4/contracts";
import type { RuntimeService } from "./composition-root.js";
import { parseCommandPayload, passthroughUnitOfWork } from "./use-case-infrastructure.js";

export interface ApprovalSurfaceDependencies {
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
  readonly plugins: PluginRegistryPort;
  readonly policy: PolicyEnginePort;
}

/**
 * Registers the externally reachable approval lifecycle. Transport handlers only validate,
 * compose existing Layer 6 use cases, and shape contract responses; policy, approval matching,
 * consumption, protected mutation, audit, and transaction semantics remain below this boundary.
 */
export function registerApprovalSurface(
  service: RuntimeService,
  dependencies: ApprovalSurfaceDependencies,
): void {
  service.register("plugin.register", async (payload, context, transaction) => {
    const request = parseCommandPayload(registerGovernedPluginRequestSchema, payload);
    if (request.approvalId === undefined) {
      const requestedAt = dependencies.clock.now();
      const approval = await requestApproval(
        {
          unitOfWork: passthroughUnitOfWork(transaction),
          policy: dependencies.policy,
          approvals: dependencies.approvals,
          audit: dependencies.audit,
          clock: dependencies.clock,
        },
        {
          approvalId: `approval-${randomUUID()}`,
          action: "plugin.register",
          resourceType: "plugin",
          resourceId: request.manifest.pluginId,
          attributes: {
            version: request.manifest.version,
            network: request.manifest.permissions.network,
          },
          expiresAt: new Date(Date.parse(requestedAt) + 60 * 60 * 1_000).toISOString(),
          auditId: `audit-${randomUUID()}`,
        },
        context,
      );
      return registerGovernedPluginResponseSchema.parse({
        schemaVersion: request.schemaVersion,
        requestId: request.requestId,
        outcome: "approval_required",
        approval: approval.value,
      }) as unknown as ApplicationJsonValue;
    }

    const plugin = await registerPlugin(
      {
        unitOfWork: passthroughUnitOfWork(transaction),
        plugins: dependencies.plugins,
        policy: dependencies.policy,
        approvals: dependencies.approvals,
        audit: dependencies.audit,
        clock: dependencies.clock,
      },
      request.manifest,
      `audit-${randomUUID()}`,
      request.approvalId,
      context,
    );
    return registerGovernedPluginResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      outcome: "registered",
      plugin: plugin.value,
    }) as unknown as ApplicationJsonValue;
  });

  service.register("approval.decide", async (payload, context, transaction) => {
    const request = parseCommandPayload(decideApprovalRequestSchema, payload);
    const approval = await decideApproval(
      {
        unitOfWork: passthroughUnitOfWork(transaction),
        policy: dependencies.policy,
        approvals: dependencies.approvals,
        audit: dependencies.audit,
        clock: dependencies.clock,
      },
      {
        approvalId: request.approvalId,
        decision: request.decision,
        reason: request.reason,
        auditId: `audit-${randomUUID()}`,
      },
      context,
    );
    return decideApprovalResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      approval: approval.value,
    }) as unknown as ApplicationJsonValue;
  });

  service.registerQuery("approval.list", async (payload, context) => {
    const request = parseCommandPayload(listApprovalsRequestSchema, payload);
    const decision = await dependencies.policy.evaluate(
      {
        action: "approval.list",
        resourceType: "approval",
        actor: context.actor,
        attributes: request.status === undefined ? {} : { status: request.status },
      },
      context,
    );
    if (decision.decision !== "allow") {
      throw new ApplicationError("PERMISSION_DENIED", "Approval listing was not authorized.", {
        details: { policyId: decision.policyId, reasons: [...decision.reasons] },
      });
    }
    const cursor =
      request.pagination.cursor ??
      (request.pagination.offset === undefined ? undefined : String(request.pagination.offset));
    const page = await dependencies.approvals.list(
      request.status,
      {
        limit: request.pagination.limit,
        ...(cursor === undefined ? {} : { cursor }),
      },
      context,
    );
    return listApprovalsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      approvals: page.items.map((item) => item.value),
      pagination: {
        total: page.total ?? page.items.length,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      },
    }) as unknown as ApplicationJsonValue;
  });
}
