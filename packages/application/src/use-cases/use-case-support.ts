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
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

function actorsMatch(left: OperationContext["actor"], right: OperationContext["actor"]): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.roles.length === right.roles.length &&
    left.roles.every((role) => right.roles.includes(role))
  );
}

function jsonValuesMatch(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesMatch(value, right[index]))
    );
  }
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) =>
        Object.hasOwn(right, key) &&
        jsonValuesMatch(value, (right as Record<string, unknown>)[key]),
    )
  );
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
  const now = Date.parse(dependencies.clock.now());
  if (
    stored === null ||
    stored.value.status !== "granted" ||
    Date.parse(stored.value.expiresAt) <= now
  ) {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "The supplied approval is missing, expired, or not granted.",
      {
        details: { approvalId },
      },
    );
  }
  if (
    stored.value.action !== request.action ||
    stored.value.resourceType !== request.resourceType ||
    stored.value.resourceId !== request.resourceId ||
    !actorsMatch(stored.value.requestedBy, context.actor) ||
    !jsonValuesMatch(stored.value.context, request.attributes) ||
    (result.expiresAt !== undefined && Date.parse(result.expiresAt) <= now)
  ) {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "The supplied approval does not match this protected operation.",
      { details: { approvalId } },
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
  await appendAudit(
    dependencies.audit,
    dependencies.clock,
    {
      id: `audit:approval.consume:${approvalId}`,
      action: "approval.consume",
      resourceType: "approval",
      resourceId: approvalId,
      outcome: "completed",
      details: {
        protectedAction: request.action,
        protectedResourceType: request.resourceType,
        ...(request.resourceId === undefined ? {} : { protectedResourceId: request.resourceId }),
      },
    },
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

export type PortPageLoader<Value> = (
  cursor: string | undefined,
) => Promise<Readonly<{ items: readonly Value[]; nextCursor?: string }>>;

/** Whether the walk should keep following `nextCursor` after this page. */
export type PortPageVisitDecision = "continue" | "stop";

/**
 * The one canonical paged walk for authoritative reads.
 *
 * It follows `nextCursor` to exhaustion, rejects a repeated cursor as an integrity failure, and
 * reports hitting its defensive page ceiling as a typed non-success — it never treats a bounded
 * first page as "all of the history". A visitor may stop early once it has decided, so a caller
 * that only needs to find one entry does not have to materialise everything before it.
 */
export async function visitPortPages<Value>(
  load: PortPageLoader<Value>,
  visit: (items: readonly Value[]) => PortPageVisitDecision | Promise<PortPageVisitDecision>,
  maximumPages = 10_000,
): Promise<void> {
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maximumPages; page += 1) {
    const result = await load(cursor);
    if ((await visit(result.items)) === "stop") return;
    if (result.nextCursor === undefined) return;
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

export async function collectPortPages<Value>(
  load: PortPageLoader<Value>,
  maximumPages = 10_000,
): Promise<readonly Value[]> {
  const items: Value[] = [];
  await visitPortPages(
    load,
    (page) => {
      items.push(...page);
      return "continue";
    },
    maximumPages,
  );
  return Object.freeze(items);
}
