import { describe, expect, it } from "vitest";
import { createRuntimeConfig, loadRuntimeConfig } from "../src/runtime-config.js";

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
    expect(config.executionProfile).toBe("hermetic_reference");
    expect(config.supervisedLocal).toBeUndefined();
    expect(config.sessions).toHaveLength(1);
  });

  it("requires an exact loopback Ollama binding for the supervised local profile", () => {
    const base = {
      port: 0,
      databasePath: "/tmp/state.db",
      sessions: [validSession],
      executionProfile: "supervised_local" as const,
    };
    expect(() => createRuntimeConfig(base)).toThrow(/supervised/i);
    expect(() =>
      createRuntimeConfig({
        ...base,
        supervisedLocal: {
          ollamaEndpoint: "http://example.com:11434",
          model: "devstral-small-2:24b",
        },
      }),
    ).toThrow(/loopback/i);

    const config = createRuntimeConfig({
      ...base,
      supervisedLocal: {
        ollamaEndpoint: "http://127.0.0.1:11434",
        model: "devstral-small-2:24b",
      },
    });
    expect(config.supervisedLocal).toEqual({
      ollamaEndpoint: "http://127.0.0.1:11434",
      model: "devstral-small-2:24b",
    });
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

  it("rejects partially numeric environment values instead of coercing them", () => {
    const required = {
      V31M4_AUTH_TOKEN: validSession.token,
      V31M4_DATABASE: "/tmp/state.db",
    };
    for (const malformed of [
      { V31M4_PORT: "8787junk" },
      { V31M4_EVENT_QUEUE_LIMIT: "12items" },
      { V31M4_REPLAY_BATCH_SIZE: "01" },
    ]) {
      expect(() => loadRuntimeConfig({ ...required, ...malformed })).toThrow(/integer/i);
    }
  });

  it("loads the supervised local profile only from complete explicit environment input", () => {
    const required = {
      V31M4_AUTH_TOKEN: validSession.token,
      V31M4_DATABASE: "/tmp/state.db",
      V31M4_EXECUTION_PROFILE: "supervised_local",
      V31M4_OLLAMA_ENDPOINT: "http://localhost:11434",
      V31M4_OLLAMA_MODEL: "devstral-small-2:24b",
    };
    expect(loadRuntimeConfig(required)).toMatchObject({
      executionProfile: "supervised_local",
      supervisedLocal: {
        ollamaEndpoint: "http://localhost:11434",
        model: "devstral-small-2:24b",
      },
    });
    expect(() => loadRuntimeConfig({ ...required, V31M4_OLLAMA_MODEL: undefined })).toThrow(
      /supervised/i,
    );
    expect(() => loadRuntimeConfig({ ...required, V31M4_EXECUTION_PROFILE: "reference" })).toThrow(
      /execution profile/i,
    );
  });
});
