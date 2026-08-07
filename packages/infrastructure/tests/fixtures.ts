import { createOperationContext } from "@v31m4/application";

export const context = createOperationContext({
  requestId: "request-infrastructure",
  idempotencyKey: "idempotency-infrastructure",
  actor: { id: "user-infrastructure", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-07T12:00:00.000Z",
});
