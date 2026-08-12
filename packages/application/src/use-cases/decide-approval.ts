import { ApplicationError } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { ApprovalRequest, ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { appendAudit } from "./use-case-support.js";

export interface DecideApprovalDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export interface DecideApprovalCommand {
  readonly approvalId: string;
  readonly decision: "grant" | "deny";
  readonly reason: string;
  readonly auditId: string;
}

export async function decideApproval(
  dependencies: DecideApprovalDependencies,
  command: DecideApprovalCommand,
  context: OperationContext,
): Promise<Versioned<ApprovalRequest>> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const policy = await dependencies.policy.evaluate(
      {
        action: "approval.decide",
        resourceType: "approval",
        resourceId: command.approvalId,
        actor: context.actor,
        attributes: { decision: command.decision },
      },
      context,
    );
    if (policy.decision !== "allow") {
      throw new ApplicationError("PERMISSION_DENIED", "Approval decision was not authorized.", {
        details: { policyId: policy.policyId, reasons: [...policy.reasons] },
      });
    }
    const current = await dependencies.approvals.get(command.approvalId, context, transaction);
    if (current === null) {
      throw new ApplicationError("NOT_FOUND", "Approval request was not found.", {
        details: { approvalId: command.approvalId },
      });
    }
    if (current.value.status !== "pending") {
      throw new ApplicationError("CONFLICT", "Only pending approvals may be decided.", {
        details: { approvalId: command.approvalId, status: current.value.status },
      });
    }
    const now = dependencies.clock.now();
    if (Date.parse(current.value.expiresAt) <= Date.parse(now)) {
      throw new ApplicationError("APPROVAL_REQUIRED", "The approval request has expired.", {
        details: { approvalId: command.approvalId },
      });
    }
    const decided: ApprovalRequest = {
      ...current.value,
      status: command.decision === "grant" ? "granted" : "denied",
      decidedBy: context.actor,
      decidedAt: now,
      decisionReason: command.reason,
    };
    const stored = await dependencies.approvals.save(
      decided,
      WriteConditions.matchRevision(current.revision),
      context,
      transaction,
    );
    await appendAudit(
      dependencies.audit,
      dependencies.clock,
      {
        id: command.auditId,
        action: "approval.decide",
        resourceType: "approval",
        resourceId: command.approvalId,
        outcome: command.decision === "grant" ? "completed" : "denied",
        details: {
          decision: command.decision,
          protectedAction: current.value.action,
          protectedResourceType: current.value.resourceType,
          ...(current.value.resourceId === undefined
            ? {}
            : { protectedResourceId: current.value.resourceId }),
        },
      },
      context,
      transaction,
    );
    return stored;
  });
}
