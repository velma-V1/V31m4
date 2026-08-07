import { ApplicationError } from "../application-errors.js";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import { WriteConditions } from "../port-types.js";
import type { ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditOutcome, AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyEnginePort, PolicyRequest } from "../ports/policy-engine.port.js";
import type { UnitOfWorkTransaction } from "../ports/unit-of-work.port.js";

export interface AuthorizationDependencies {
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly clock: ClockPort;
}

export async function authorizeAction(
  dependencies: AuthorizationDependencies,
  request: Omit<PolicyRequest, "actor">,
  approvalId: string | undefined,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<void> {
  const result = await dependencies.policy.evaluate({ ...request, actor: context.actor }, context);
  if (result.decision === "allow") return;
  if (result.decision === "deny") {
    throw new ApplicationError("PERMISSION_DENIED", "The policy engine denied this operation.", {
      details: { policyId: result.policyId, reasons: [...result.reasons] },
    });
  }
  if (approvalId === undefined) {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "This operation requires an explicit approval.",
      {
        details: { policyId: result.policyId, requiredScopes: [...result.requiredApprovalScopes] },
      },
    );
  }
  const stored = await dependencies.approvals.get(approvalId, context, transaction);
  if (
    stored === null ||
    stored.value.status !== "granted" ||
    Date.parse(stored.value.expiresAt) <= Date.parse(dependencies.clock.now())
  ) {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "The supplied approval is missing, expired, or not granted.",
      {
        details: { approvalId },
      },
    );
  }
  const scopes = new Set(stored.value.requiredScopes);
  if (!result.requiredApprovalScopes.every((scope) => scopes.has(scope))) {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "The supplied approval does not cover every required scope.",
      {
        details: { approvalId },
      },
    );
  }
  await dependencies.approvals.consume(
    approvalId,
    WriteConditions.matchRevision(stored.revision),
    context,
    transaction,
  );
}

export async function appendAudit(
  audit: AuditStorePort,
  clock: ClockPort,
  input: {
    readonly id: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId?: string;
    readonly outcome: AuditOutcome;
    readonly details?: ApplicationJsonObject;
  },
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<void> {
  await audit.append(
    {
      id: input.id,
      occurredAt: clock.now(),
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
      actor: context.actor,
      outcome: input.outcome,
      correlationId: context.correlationId,
      details: input.details ?? {},
    },
    context,
    transaction,
  );
}

export function requireValue<Value>(value: Value | null, message: string): Value {
  if (value === null) throw new ApplicationError("NOT_FOUND", message);
  return value;
}

export async function collectPortPages<Value>(
  load: (
    cursor: string | undefined,
  ) => Promise<Readonly<{ items: readonly Value[]; nextCursor?: string }>>,
  maximumPages = 10_000,
): Promise<readonly Value[]> {
  const items: Value[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maximumPages; page += 1) {
    const result = await load(cursor);
    items.push(...result.items);
    if (result.nextCursor === undefined) return Object.freeze(items);
    if (seenCursors.has(result.nextCursor)) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Pagination returned a repeated cursor.", {
        details: { cursor: result.nextCursor },
      });
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new ApplicationError(
    "RESOURCE_EXHAUSTED",
    "Pagination exceeded the maximum supported page count.",
    {
      details: { maximumPages },
    },
  );
}
