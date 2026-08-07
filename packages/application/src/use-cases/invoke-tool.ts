import type { OperationContext } from "../operation-context.js";
import type { ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { ToolGatewayPort, ToolInvocationRequest, ToolInvocationResult } from "../ports/tool-gateway.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { appendAudit, authorizeAction } from "./use-case-support.js";

export interface InvokeToolDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly tools: ToolGatewayPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export async function invokeTool(
  dependencies: InvokeToolDependencies,
  request: ToolInvocationRequest,
  auditId: string,
  approvalId: string | undefined,
  context: OperationContext,
): Promise<ToolInvocationResult> {
  await dependencies.unitOfWork.execute(context, (transaction) =>
    authorizeAction(dependencies, {
      action: `tool.${request.operation}`,
      resourceType: "tool",
      resourceId: request.toolId,
      attributes: { invocationId: request.invocationId, inputArtifactCount: request.inputArtifactIds.length },
    }, approvalId, context, transaction),
  );
  try {
    const result = await dependencies.tools.invoke(request, context);
    await dependencies.unitOfWork.execute(context, (transaction) => appendAudit(dependencies.audit, dependencies.clock, {
      id: auditId,
      action: `tool.${request.operation}`,
      resourceType: "tool",
      resourceId: request.toolId,
      outcome: result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed",
      details: { invocationId: request.invocationId, status: result.status },
    }, context, transaction));
    return result;
  } catch (error) {
    await dependencies.unitOfWork.execute(context, (transaction) => appendAudit(dependencies.audit, dependencies.clock, {
      id: auditId,
      action: `tool.${request.operation}`,
      resourceType: "tool",
      resourceId: request.toolId,
      outcome: "failed",
      details: { invocationId: request.invocationId },
    }, context, transaction));
    throw error;
  }
}
