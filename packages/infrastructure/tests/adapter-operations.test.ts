import { describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  BoundedScheduler,
  LeasedSecretStore,
  ProcessResourceMonitor,
  RedactedLogger,
  RestartBudget,
} from "../src/index.js";

describe("adapter operations", () => {
  it("rejects registration collisions and restart storms", () => {
    const registry = new AdapterRegistry();
    registry.register({ id: "model-a", protocolVersion: "1", capabilities: ["model"] });
    expect(() =>
      registry.register({ id: "model-a", protocolVersion: "1", capabilities: ["other"] }),
    ).toThrow("already registered");
    const budget = new RestartBudget(2, 1_000);
    expect([budget.consume(1), budget.consume(2), budget.consume(3)]).toEqual([true, true, false]);
    expect(budget.consume(1_002)).toBe(true);
  });

  it("leases secrets once, expires them, and redacts structured logs", () => {
    const secrets = new LeasedSecretStore();
    secrets.set("token", "top-secret");
    const token = secrets.lease("token", 10, 100);
    expect(secrets.redeem(token, 109)).toBe("top-secret");
    expect(() => secrets.redeem(token, 109)).toThrow("invalid or expired");
    const expired = secrets.lease("token", 10, 100);
    expect(() => secrets.redeem(expired, 110)).toThrow("invalid or expired");
    const lines: string[] = [];
    new RedactedLogger(
      (line) => lines.push(line),
      () => secrets.valuesForRedaction(),
    ).write({
      level: "info",
      message: "token=top-secret",
      fields: { nested: "top-secret" },
    });
    expect(lines[0]).not.toContain("top-secret");
  });

  it("ignores an empty secret instead of corrupting the log line", () => {
    const lines: string[] = [];
    new RedactedLogger(
      (line) => lines.push(line),
      () => ["", "real-secret"],
    ).write({ level: "info", message: "value=real-secret" });
    // The empty secret must not splice the marker between characters; the real secret is redacted.
    expect(lines[0]).toBe('{"level":"info","message":"value=[REDACTED]"}');
  });

  it("bounds scheduling and validates resource readings", async () => {
    const scheduler = new BoundedScheduler(1);
    const order: number[] = [];
    const first = scheduler.run(async () => {
      order.push(1);
      await Promise.resolve();
      order.push(2);
    });
    const second = scheduler.run(async () => order.push(3));
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    expect(new ProcessResourceMonitor().read(process.pid).memoryBytes).toBeGreaterThan(0);
  });
});
