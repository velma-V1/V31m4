import type { OperationContext } from "../operation-context.js";
import type { ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type {
  ModelGatewayPort,
  ModelInvocationRequest,
  ModelInvocationResult,
} from "../ports/model-gateway.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import { appendAudit, authorizeAction } from "./use-case-support.js";

export interface InvokeModelDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly models: ModelGatewayPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export async function invokeModel(
  dependencies: InvokeModelDependencies,
  request: ModelInvocationRequest,
  auditId: string,
  approvalId: string | undefined,
  context: OperationContext,
): Promise<ModelInvocationResult> {
  await dependencies.unitOfWork.execute(context, (transaction) =>
    authorizeAction(
      dependencies,
      {
        action: "model.invoke",
        resourceType: "model",
        resourceId: request.modelId,
        attributes: { invocationId: request.invocationId, localOnly: false },
      },
      approvalId,
      context,
      transaction,
    ),
  );
  try {
    const result = await dependencies.models.invoke(request, context);
    await dependencies.unitOfWork.execute(context, (transaction) =>
      appendAudit(
        dependencies.audit,
        dependencies.clock,
        {
          id: auditId,
          action: "model.invoke",
          resourceType: "model",
          resourceId: request.modelId,
          outcome:
            result.finishReason === "cancelled"
              ? "cancelled"
              : result.finishReason === "failed"
                ? "failed"
                : "completed",
          details: { invocationId: request.invocationId, finishReason: result.finishReason },
        },
        context,
        transaction,
      ),
    );
    return result;
  } catch (error) {
    await dependencies.unitOfWork.execute(context, (transaction) =>
      appendAudit(
        dependencies.audit,
        dependencies.clock,
        {
          id: auditId,
          action: "model.invoke",
          resourceType: "model",
          resourceId: request.modelId,
          outcome: "failed",
          details: { invocationId: request.invocationId },
        },
        context,
        transaction,
      ),
    );
    throw error;
  }
}
