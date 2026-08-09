import { describe, expect, it } from "vitest";
import { createRuntimeConfig } from "../src/runtime-config.js";

const validSession = { token: "token-abcdefghijklmnop", actorId: "operator", roles: ["operator"] };

describe("createRuntimeConfig", () => {
  it("accepts a valid local configuration and applies defaults", () => {
    const config = createRuntimeConfig({
      port: 0,
      databasePath: "/tmp/state.db",
      sessions: [validSession],
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.eventQueueLimit).toBe(1024);
    expect(config.replayBatchSize).toBe(512);
    expect(config.sessions).toHaveLength(1);
  });

  it("rejects a non-loopback host", () => {
    expect(() =>
      createRuntimeConfig({
        host: "0.0.0.0",
        port: 0,
        databasePath: "/tmp/state.db",
        sessions: [validSession],
      }),
    ).toThrow(/loopback/i);
  });

  it("rejects a weak session token and an out-of-range port", () => {
    expect(() =>
      createRuntimeConfig({
        port: 0,
        databasePath: "/tmp/state.db",
        sessions: [{ token: "short", actorId: "operator", roles: [] }],
      }),
    ).toThrow(/token/i);
    expect(() =>
      createRuntimeConfig({ port: 70000, databasePath: "/tmp/state.db", sessions: [validSession] }),
    ).toThrow(/port/i);
  });

  it("requires at least one session", () => {
    expect(() =>
      createRuntimeConfig({ port: 0, databasePath: "/tmp/state.db", sessions: [] }),
    ).toThrow(/session/i);
  });
});
