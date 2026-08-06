import { assertDomain } from "./domain-errors.js";
import { EventId, type EventId as EventIdType } from "./value-objects/ids.js";

export type DomainEventPrimitive = string | number | boolean | null;

export interface DomainEventArray extends ReadonlyArray<DomainEventValue> {}

export interface DomainEventObject {
  readonly [key: string]: DomainEventValue;
}

export type DomainEventValue = DomainEventPrimitive | DomainEventArray | DomainEventObject;

export interface DomainEvent<
  Type extends string = string,
  Payload extends Readonly<Record<string, DomainEventValue>> = Readonly<
    Record<string, DomainEventValue>
  >,
> {
  readonly id: EventIdType;
  readonly type: Type;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: Payload;
  readonly metadata: Readonly<Record<string, string>>;
}

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface CreateDomainEventInput<
  Type extends string,
  Payload extends Readonly<Record<string, DomainEventValue>>,
> {
  readonly id: string;
  readonly type: Type;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: Payload;
  readonly metadata?: Readonly<Record<string, string>>;
}

function freezeEventValue(value: DomainEventValue, path: string): DomainEventValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    assertDomain(
      Number.isFinite(value),
      "INVALID_DOMAIN_EVENT",
      "Domain event numbers must be finite.",
      { path, value: Number.isNaN(value) ? "NaN" : value },
    );
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => freezeEventValue(item, `${path}[${index}]`)));
  }

  const prototype = Object.getPrototypeOf(value);
  assertDomain(
    prototype === Object.prototype || prototype === null,
    "INVALID_DOMAIN_EVENT",
    "Domain event payloads may contain only plain objects, arrays, and JSON primitives.",
    { path },
  );

  const frozenEntries = Object.entries(value).map(([key, nestedValue]) => [
    key,
    freezeEventValue(nestedValue, `${path}.${key}`),
  ]);
  return Object.freeze(Object.fromEntries(frozenEntries));
}

function validateEventName(label: string, value: string): void {
  assertDomain(
    EVENT_NAME_PATTERN.test(value),
    "INVALID_DOMAIN_EVENT",
    `${label} must use lowercase dot, underscore, or hyphen separated tokens.`,
    { label, value },
  );
}

function validateOccurredAt(value: string): void {
  const timestamp = Date.parse(value);
  assertDomain(
    ISO_DATE_TIME_PATTERN.test(value) &&
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString() === value,
    "INVALID_DOMAIN_EVENT",
    "Event occurrence time must be a canonical UTC ISO-8601 timestamp with milliseconds.",
    { occurredAt: value },
  );
}

function freezeMetadata(
  metadata: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const copied = { ...(metadata ?? {}) };
  for (const [key, value] of Object.entries(copied)) {
    assertDomain(
      key.length > 0 && key === key.trim(),
      "INVALID_DOMAIN_EVENT",
      "Domain event metadata keys must be non-empty and canonical.",
      { key },
    );
    assertDomain(
      value === value.trim(),
      "INVALID_DOMAIN_EVENT",
      "Domain event metadata values cannot contain outer whitespace.",
      { key, value },
    );
  }
  return Object.freeze(copied);
}

export function createDomainEvent<
  Type extends string,
  Payload extends Readonly<Record<string, DomainEventValue>>,
>(input: CreateDomainEventInput<Type, Payload>): DomainEvent<Type, Payload> {
  validateEventName("Event type", input.type);
  validateEventName("Aggregate type", input.aggregateType);
  assertDomain(
    input.aggregateId.length > 0 && input.aggregateId === input.aggregateId.trim(),
    "INVALID_DOMAIN_EVENT",
    "Aggregate ID must be non-empty and cannot contain outer whitespace.",
    { aggregateId: input.aggregateId },
  );
  validateOccurredAt(input.occurredAt);

  const payload = freezeEventValue(input.payload, "payload") as Payload;
  const metadata = freezeMetadata(input.metadata);

  return Object.freeze({
    id: EventId.parse(input.id),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    payload,
    metadata,
  });
}
