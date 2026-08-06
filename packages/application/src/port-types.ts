import type { ApplicationJsonObject } from "./application-json.js";
import type { OperationContext } from "./operation-context.js";

export interface PortPageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface PortPage<Value> {
  readonly items: readonly Value[];
  readonly nextCursor?: string;
  readonly total?: number;
}

export type WriteCondition =
  | Readonly<{ kind: "any" }>
  | Readonly<{ kind: "must_not_exist" }>
  | Readonly<{ kind: "match_revision"; revision: string }>;

const REVISION_PATTERN = /^\S{1,256}$/u;

export const WriteConditions = Object.freeze({
  any(): WriteCondition {
    return Object.freeze({ kind: "any" });
  },
  mustNotExist(): WriteCondition {
    return Object.freeze({ kind: "must_not_exist" });
  },
  matchRevision(revision: string): WriteCondition {
    if (!REVISION_PATTERN.test(revision)) {
      throw new TypeError("Revision must contain between 1 and 256 non-whitespace characters.");
    }
    return Object.freeze({ kind: "match_revision", revision });
  },
});

export interface Versioned<Value> {
  readonly value: Value;
  readonly revision: string;
}

export type PortHealthStatus = "healthy" | "degraded" | "unavailable";

export interface PortHealth {
  readonly status: PortHealthStatus;
  readonly checkedAt: string;
  readonly message?: string;
  readonly details: ApplicationJsonObject;
}

export interface OperationReceipt {
  readonly operationId: string;
  readonly acceptedAt: string;
  readonly idempotencyKey: string;
}

export type PortListener<Value> = (value: Value, context: OperationContext) => void | Promise<void>;

export interface PortSubscription {
  readonly id: string;
  close(): Promise<void>;
}
