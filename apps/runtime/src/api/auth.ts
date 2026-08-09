import { timingSafeEqual } from "node:crypto";
import {
  ApplicationError,
  createOperationContext,
  type OperationContext,
} from "@v31m4/application";
import type { RuntimeSession } from "../runtime-config.js";

export interface RuntimePrincipal {
  readonly actorId: string;
  readonly roles: readonly string[];
}

export interface RequestIdentity {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly now: string;
}

const BEARER_PREFIX = "Bearer ";

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Authenticates local sessions by bearer token. Tokens are compared in constant time so a wrong
 * token cannot be discovered by timing, and an unknown or malformed credential fails closed with
 * `PERMISSION_DENIED` rather than defaulting to any actor.
 */
export class LocalSessionAuthenticator {
  readonly #sessions: readonly RuntimeSession[];

  constructor(sessions: readonly RuntimeSession[]) {
    this.#sessions = [...sessions];
  }

  authenticate(authorizationHeader: string | undefined): RuntimePrincipal {
    if (authorizationHeader === undefined || !authorizationHeader.startsWith(BEARER_PREFIX)) {
      throw new ApplicationError("PERMISSION_DENIED", "Missing or malformed bearer credential.");
    }
    const presented = authorizationHeader.slice(BEARER_PREFIX.length);
    for (const session of this.#sessions) {
      if (constantTimeEquals(presented, session.token)) {
        return Object.freeze({
          actorId: session.actorId,
          roles: Object.freeze([...session.roles]),
        });
      }
    }
    throw new ApplicationError("PERMISSION_DENIED", "Unrecognized session credential.");
  }

  /** Builds a validated operation context for an authenticated request. */
  contextFor(principal: RuntimePrincipal, identity: RequestIdentity): OperationContext {
    return createOperationContext({
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      actor: { id: principal.actorId, kind: "user", roles: principal.roles },
      startedAt: identity.now,
    });
  }
}
