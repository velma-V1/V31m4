import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  assertWithinDeadline,
  createOperationContext,
  remainingTimeMs,
  throwIfOperationCancelled,
} from "../src/index.js";

const base = {
  requestId: "request-1",
  idempotencyKey: "idem-1",
  actor: { id: "user-1", kind: "user" as const, roles: ["operator"] },
  startedAt: "2026-08-06T20:00:00.000Z",
};

describe("OperationContext", () => {
  it("creates a frozen context with deterministic correlation and metadata copies", () => {
    const metadata = { stage: { value: "plan" } };
    const context = createOperationContext({ ...base, metadata });
    metadata.stage.value = "changed";
    expect(context.correlationId).toBe("request-1");
    expect(context.metadata).toEqual({ stage: { value: "plan" } });
    expect(Object.isFrozen(context.actor.roles)).toBe(true);
    expect(Object.isFrozen(context.metadata["stage"])).toBe(true);
  });

  it("rejects invalid identifiers, duplicate roles, and reversed deadlines", () => {
    expect(() => createOperationContext({ ...base, requestId: "bad id" })).toThrow();
    expect(() => createOperationContext({ ...base, actor: { ...base.actor, kind: "invalid" as "user" } })).toThrow();
    expect(() => createOperationContext({ ...base, actor: { ...base.actor, roles: ["operator", "operator"] } })).toThrow();
    expect(() => createOperationContext({ ...base, deadlineAt: "2026-08-06T19:59:59.999Z" })).toThrow();
  });

  it("enforces cancellation and deadlines", () => {
    const cancelled = createOperationContext({
      ...base,
      signal: {
        aborted: true,
        reason: "stop",
        addEventListener() {},
        removeEventListener() {},
      },
    });
    expect(() => throwIfOperationCancelled(cancelled)).toThrow(ApplicationError);

    const timed = createOperationContext({ ...base, deadlineAt: "2026-08-06T20:00:10.000Z" });
    expect(remainingTimeMs(timed, "2026-08-06T20:00:04.000Z")).toBe(6_000);
    expect(() => assertWithinDeadline(timed, "2026-08-06T20:00:10.001Z")).toThrow();
  });
});
