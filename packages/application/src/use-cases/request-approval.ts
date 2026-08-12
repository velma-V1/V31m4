import { ApplicationError } from "../application-errors.js";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { ApprovalRequest, ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { appendAudit } from "./use-case-support.js";

export interface RequestApprovalDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export interface RequestApprovalCommand {
  readonly approvalId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly attributes: ApplicationJsonObject;
  readonly expiresAt: string;
  readonly auditId: string;
}

export async function requestApproval(
  dependencies: RequestApprovalDependencies,
  command: RequestApprovalCommand,
  context: OperationContext,
): Promise<Versioned<ApprovalRequest>> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const policy = await dependencies.policy.evaluate(
      {
        action: command.action,
        resourceType: command.resourceType,
        ...(command.resourceId === undefined ? {} : { resourceId: command.resourceId }),
        actor: context.actor,
        attributes: command.attributes,
      },
      context,
    );
    if (policy.decision === "deny") {
      throw new ApplicationError("PERMISSION_DENIED", "The policy engine denied this operation.", {
        details: { policyId: policy.policyId, reasons: [...policy.reasons] },
      });
    }
    if (policy.decision !== "require_approval") {
      throw new ApplicationError(
        "POLICY_REJECTED",
        "The policy engine does not require approval for this operation.",
        { details: { policyId: policy.policyId } },
      );
    }
    const now = dependencies.clock.now();
    const requestedExpiry = Date.parse(command.expiresAt);
    const policyExpiry = policy.expiresAt === undefined ? undefined : Date.parse(policy.expiresAt);
    const effectiveExpiry = Math.min(requestedExpiry, policyExpiry ?? requestedExpiry);
    if (!Number.isFinite(effectiveExpiry) || effectiveExpiry <= Date.parse(now)) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Approval expiry must be a valid future timestamp.",
      );
    }
    const approval: ApprovalRequest = {
      id: command.approvalId,
      action: command.action,
      resourceType: command.resourceType,
      ...(command.resourceId === undefined ? {} : { resourceId: command.resourceId }),
      requestedBy: context.actor,
      requiredScopes: [...policy.requiredApprovalScopes],
      context: command.attributes,
      status: "pending",
      requestedAt: now,
      expiresAt: new Date(effectiveExpiry).toISOString(),
    };
    const stored = await dependencies.approvals.save(
      approval,
      WriteConditions.mustNotExist(),
      context,
      transaction,
    );
    await appendAudit(
      dependencies.audit,
      dependencies.clock,
      {
        id: command.auditId,
        action: "approval.request",
        resourceType: "approval",
        resourceId: command.approvalId,
        outcome: "accepted",
        details: {
          policyId: policy.policyId,
          protectedAction: command.action,
          protectedResourceType: command.resourceType,
          ...(command.resourceId === undefined ? {} : { protectedResourceId: command.resourceId }),
          requiredScopes: [...policy.requiredApprovalScopes],
        },
      },
      context,
      transaction,
    );
    return stored;
  });
}
