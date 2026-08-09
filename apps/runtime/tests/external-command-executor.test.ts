import { SqliteRecordStore } from "@v31m4/infrastructure";
import { describe, expect, it } from "vitest";
import { canonicalJson, ExternalCommandExecutor } from "../src/external-command-executor.js";
import { context, runtimeDatabase } from "./fixtures.js";

describe("canonicalJson", () => {
  it("produces key-order-independent output", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }),
    );
  });
});

describe("ExternalCommandExecutor", () => {
  it("runs once and returns the stored result on an identical retry", async () => {
    const db = runtimeDatabase();
    const records = new SqliteRecordStore(db);
    const executor = new ExternalCommandExecutor(db);
    let runs = 0;
    const command = {
      actorId: "user-1",
      idempotencyKey: "k1",
      commandType: "project.create",
      payload: { name: "demo" },
    };
    const first = await executor.execute(command, context, async (tx) => {
      runs += 1;
      await records.save(
        "project",
        "project-1",
        { id: "project-1", name: "demo" },
        { kind: "must_not_exist" },
        tx,
      );
      return { id: "project-1", revision: "1" };
    });
    const second = await executor.execute(command, context, async (tx) => {
      runs += 1;
      await records.save(
        "project",
        "project-1",
        { id: "project-1", name: "demo" },
        { kind: "must_not_exist" },
        tx,
      );
      return { id: "project-1", revision: "1" };
    });
    expect(first).toEqual(second);
    expect(runs).toBe(1);
    db.close();
  });

  it("rejects the same key with a different payload as a conflict", async () => {
    const db = runtimeDatabase();
    const executor = new ExternalCommandExecutor(db);
    await executor.execute(
      {
        actorId: "user-1",
        idempotencyKey: "k1",
        commandType: "project.create",
        payload: { name: "a" },
      },
      context,
      async () => ({ ok: true }),
    );
    await expect(
      executor.execute(
        {
          actorId: "user-1",
          idempotencyKey: "k1",
          commandType: "project.create",
          payload: { name: "b" },
        },
        context,
        async () => ({ ok: true }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    db.close();
  });

  it("rejects the same key with a different command type as a conflict", async () => {
    const db = runtimeDatabase();
    const executor = new ExternalCommandExecutor(db);
    await executor.execute(
      {
        actorId: "user-1",
        idempotencyKey: "k1",
        commandType: "project.create",
        payload: { name: "a" },
      },
      context,
      async () => ({ ok: true }),
    );
    await expect(
      executor.execute(
        {
          actorId: "user-1",
          idempotencyKey: "k1",
          commandType: "mission.submit",
          payload: { name: "a" },
        },
        context,
        async () => ({ ok: true }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    db.close();
  });

  it("propagates a version conflict from the operation and stores no idempotency record", async () => {
    const db = runtimeDatabase();
    const executor = new ExternalCommandExecutor(db);
    const command = {
      actorId: "user-1",
      idempotencyKey: "k1",
      commandType: "project.rename",
      payload: { name: "a" },
    };
    await expect(
      executor.execute(command, context, async () => {
        throw Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" });
      }),
    ).rejects.toThrow("stale");
    // No record was stored, so a corrected retry can proceed.
    const ok = await executor.execute(command, context, async () => ({ ok: true }));
    expect(ok).toEqual({ ok: true });
    db.close();
  });
});
