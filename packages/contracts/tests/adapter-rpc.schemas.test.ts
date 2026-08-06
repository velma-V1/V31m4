import { describe, expect, it } from "vitest";
import {
  adapterRpcMessageSchema,
  adapterRpcNotificationSchema,
  adapterRpcRequestSchema,
  adapterRpcResponseSchema,
} from "../src/adapter-rpc.schemas.js";

describe("adapter JSON-RPC contracts", () => {
  it("parses a versioned initialize request", () => {
    const request = {
      jsonrpc: "2.0",
      id: "rpc:1",
      method: "adapter.initialize",
      params: {
        protocolVersion: "1.0.0",
        adapterId: "adapter:ollama",
        runtimeId: "runtime:primary",
        capabilities: ["model.invoke"],
      },
    } as const;
    expect(adapterRpcRequestSchema.parse(request).method).toBe("adapter.initialize");
  });

  it("rejects unknown methods and invalid request identifiers", () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "adapter.health",
      params: {},
    } as const;
    expect(adapterRpcRequestSchema.parse(request).id).toBe(1);
    expect(adapterRpcRequestSchema.safeParse({ ...request, method: "shell.execute" }).success).toBe(
      false,
    );
    expect(adapterRpcRequestSchema.safeParse({ ...request, id: -1 }).success).toBe(false);
    expect(adapterRpcRequestSchema.safeParse({ ...request, id: 1.5 }).success).toBe(false);
  });

  it("keeps success and error responses mutually exclusive", () => {
    expect(
      adapterRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: "rpc:1",
        result: { status: "ready" },
      }),
    ).toMatchObject({ id: "rpc:1" });
    expect(
      adapterRpcResponseSchema.parse({
        jsonrpc: "2.0",
        id: "rpc:1",
        error: {
          code: -32001,
          message: "Adapter unavailable.",
          retryable: true,
          data: { adapterId: "adapter:ollama" },
        },
      }),
    ).toMatchObject({ id: "rpc:1" });
    expect(
      adapterRpcResponseSchema.safeParse({
        jsonrpc: "2.0",
        id: "rpc:1",
        result: {},
        error: { code: -32001, message: "bad", retryable: false },
      }).success,
    ).toBe(false);
  });

  it("rejects prototype-pollution data in params and accepts notifications without IDs", () => {
    const malicious = JSON.parse(
      '{"jsonrpc":"2.0","id":"rpc:1","method":"adapter.cancel","params":{"invocationId":"invocation:1","__proto__":{"polluted":true}}}',
    );
    expect(adapterRpcMessageSchema.safeParse(malicious).success).toBe(false);
    expect(
      adapterRpcNotificationSchema.parse({
        jsonrpc: "2.0",
        method: "adapter.progress",
        params: {
          invocationId: "invocation:1",
          progress: 0.5,
          stage: "render",
        },
      }).method,
    ).toBe("adapter.progress");
  });
});
