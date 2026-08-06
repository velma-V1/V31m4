import {
  cloneAndFreezeApplicationJson,
  isApplicationJsonValue,
  type ApplicationJsonObject,
} from "./application-json.js";
import { ApplicationError, assertApplication } from "./application-errors.js";

export type OperationActorKind = "user" | "system" | "model" | "plugin" | "scheduler";

export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: Readonly<{ once?: boolean }>,
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

const NO_CANCELLATION: CancellationSignal = Object.freeze({
  aborted: false,
  addEventListener(): void {},
  removeEventListener(): void {},
});

export interface OperationActor {
  readonly id: string;
  readonly kind: OperationActorKind;
  readonly roles: readonly string[];
}

export interface OperationContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly actor: OperationActor;
  readonly startedAt: string;
  readonly deadlineAt?: string;
  readonly signal: CancellationSignal;
  readonly metadata: ApplicationJsonObject;
}

export interface CreateOperationContextInput {
  readonly requestId: string;
  readonly correlationId?: string;
  readonly idempotencyKey: string;
  readonly actor: OperationActor;
  readonly startedAt: string;
  readonly deadlineAt?: string;
  readonly signal?: CancellationSignal;
  readonly metadata?: ApplicationJsonObject;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ACTOR_KINDS = new Set<OperationActorKind>(["user", "system", "model", "plugin", "scheduler"]);

function canonicalTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  assertApplication(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_APPLICATION_INPUT",
    `${label} must be a canonical UTC ISO-8601 timestamp with milliseconds.`,
    { details: { label, value } },
  );
  return parsed;
}

function canonicalId(value: string, label: string): string {
  assertApplication(
    ID_PATTERN.test(value),
    "INVALID_APPLICATION_INPUT",
    `${label} must use canonical durable-ID syntax.`,
    { details: { label, value } },
  );
  return value;
}

export function createOperationContext(input: CreateOperationContextInput): OperationContext {
  const startedAtMs = canonicalTimestamp(input.startedAt, "startedAt");
  const deadlineAtMs =
    input.deadlineAt === undefined ? undefined : canonicalTimestamp(input.deadlineAt, "deadlineAt");
  assertApplication(
    deadlineAtMs === undefined || deadlineAtMs >= startedAtMs,
    "INVALID_APPLICATION_INPUT",
    "Operation deadline cannot precede its start time.",
  );
  assertApplication(ACTOR_KINDS.has(input.actor.kind), "INVALID_APPLICATION_INPUT", "Actor kind is invalid.");
  assertApplication(input.actor.roles.length <= 128, "INVALID_APPLICATION_INPUT", "Actor roles exceed the limit.");
  const roles = input.actor.roles.map((role) => canonicalId(role, "actor role"));
  assertApplication(new Set(roles).size === roles.length, "INVALID_APPLICATION_INPUT", "Actor roles must be unique.");

  const metadata = input.metadata ?? {};
  assertApplication(isApplicationJsonValue(metadata), "INVALID_APPLICATION_INPUT", "Operation metadata must be safe JSON.");

  const base = {
    requestId: canonicalId(input.requestId, "requestId"),
    correlationId: canonicalId(input.correlationId ?? input.requestId, "correlationId"),
    idempotencyKey: canonicalId(input.idempotencyKey, "idempotencyKey"),
    actor: Object.freeze({
      id: canonicalId(input.actor.id, "actor id"),
      kind: input.actor.kind,
      roles: Object.freeze(roles),
    }),
    startedAt: input.startedAt,
    signal: input.signal ?? NO_CANCELLATION,
    metadata: cloneAndFreezeApplicationJson(metadata) as ApplicationJsonObject,
  } as const;
  return Object.freeze(
    input.deadlineAt === undefined ? base : { ...base, deadlineAt: input.deadlineAt },
  );
}

export function throwIfOperationCancelled(context: OperationContext): void {
  if (context.signal.aborted) {
    const reason = context.signal.reason;
    throw new ApplicationError("CANCELLED", "Operation was cancelled.", {
      details: reason === undefined ? {} : { reason: String(reason) },
    });
  }
}

export function assertWithinDeadline(context: OperationContext, now: string): void {
  if (context.deadlineAt === undefined) {
    return;
  }
  const nowMs = canonicalTimestamp(now, "now");
  if (nowMs > Date.parse(context.deadlineAt)) {
    throw new ApplicationError("DEADLINE_EXCEEDED", "Operation deadline was exceeded.", {
      details: { deadlineAt: context.deadlineAt, now },
    });
  }
}

export function remainingTimeMs(context: OperationContext, now: string): number | undefined {
  if (context.deadlineAt === undefined) {
    return undefined;
  }
  const nowMs = canonicalTimestamp(now, "now");
  return Math.max(0, Date.parse(context.deadlineAt) - nowMs);
}
