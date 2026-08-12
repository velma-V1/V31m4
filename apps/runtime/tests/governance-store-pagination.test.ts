import {
  type ApprovalRequest,
  type AuditRecord,
  createOperationContext,
  WriteConditions,
} from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { SqliteApprovalStore, SqliteAuditStore } from "../src/use-case-infrastructure.js";
import { runtimeDatabase } from "./fixtures.js";

const context = createOperationContext({
  requestId: "request:governance-pagination",
  idempotencyKey: "idempotency:governance-pagination",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-11T12:00:00.000Z",
});

function approval(id: string, status: "pending" | "denied"): ApprovalRequest {
  return {
    id,
    action: "plugin.register",
    resourceType: "plugin",
    resourceId: `plugin:${id}`,
    requestedBy: context.actor,
    requiredScopes: ["plugin:register"],
    context: {},
    status,
    requestedAt: "2026-08-11T12:00:00.000Z",
    expiresAt: "2026-08-11T14:00:00.000Z",
    ...(status === "pending"
      ? {}
      : {
          decidedBy: context.actor,
          decidedAt: "2026-08-11T13:00:00.000Z",
          decisionReason: "Denied for pagination proof.",
        }),
  };
}

function audit(id: string, action: string): AuditRecord {
  return {
    id,
    occurredAt: "2026-08-11T12:00:00.000Z",
    action,
    resourceType: "plugin",
    resourceId: `plugin:${id}`,
    actor: context.actor,
    outcome: "completed",
    correlationId: context.correlationId,
    details: {},
  };
}

describe("governance store filtered pagination", () => {
  it("filters approval status before slicing and computing metadata", async () => {
    const database = runtimeDatabase();
    const store = new SqliteApprovalStore(database);
    try {
      await database.unitOfWork.execute(context, async (transaction) => {
        for (const value of [
          approval("approval:pending:one", "pending"),
          approval("approval:denied:one", "denied"),
          approval("approval:pending:two", "pending"),
          approval("approval:denied:two", "denied"),
        ]) {
          await store.save(value, WriteConditions.mustNotExist(), context, transaction);
        }
      });

      const first = await store.list("pending", { limit: 1 });
      expect(first.items.map((entry) => entry.value.id)).toEqual(["approval:pending:one"]);
      expect(first.total).toBe(2);
      expect(first.nextCursor).toBe("1");

      const second = await store.list("pending", { limit: 1, cursor: "1" });
      expect(second.items.map((entry) => entry.value.id)).toEqual(["approval:pending:two"]);
      expect(second.total).toBe(2);
      expect(second.nextCursor).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("filters audit queries before slicing and computing metadata", async () => {
    const database = runtimeDatabase();
    const store = new SqliteAuditStore(database);
    try {
      await database.unitOfWork.execute(context, async (transaction) => {
        for (const value of [
          audit("audit:target:one", "approval.consume"),
          audit("audit:other:one", "project.create"),
          audit("audit:target:two", "approval.consume"),
          audit("audit:other:two", "project.create"),
        ]) {
          await store.append(value, context, transaction);
        }
      });

      const first = await store.list({ action: "approval.consume", limit: 1 });
      expect(first.items.map((entry) => entry.id)).toEqual(["audit:target:one"]);
      expect(first.total).toBe(2);
      expect(first.nextCursor).toBe("1");

      const second = await store.list({ action: "approval.consume", limit: 1, cursor: "1" });
      expect(second.items.map((entry) => entry.id)).toEqual(["audit:target:two"]);
      expect(second.total).toBe(2);
      expect(second.nextCursor).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
