import { describe, expect, it } from "vitest";
import { adapterRpcMessageSchema } from "../src/adapter-rpc.schemas.js";
import { safeJsonObjectSchema, safeJsonValueSchema } from "../src/common.schemas.js";
import { submitMissionRequestSchema } from "../src/missions.schemas.js";
import { runtimeEventSchema } from "../src/runtime-events.schemas.js";

const parse = (raw: string): unknown => JSON.parse(raw);

describe("prototype-pollution and hostile-input hardening", () => {
  it("rejects forbidden property names at any depth and inside arrays (adapter RPC)", () => {
    const payloads = [
      '{"jsonrpc":"2.0","id":"rpc:1","method":"adapter.cancel","params":{"invocationId":"invocation:1","__proto__":{"polluted":true}}}',
      '{"jsonrpc":"2.0","id":"rpc:1","method":"adapter.cancel","params":{"invocationId":"invocation:1","constructor":{"x":1}}}',
      '{"jsonrpc":"2.0","id":"rpc:1","method":"adapter.cancel","params":{"invocationId":"invocation:1","prototype":{"x":1}}}',
      '{"jsonrpc":"2.0","id":"rpc:1","result":{"deep":{"deeper":{"__proto__":{"x":1}}}}}',
      '{"jsonrpc":"2.0","id":"rpc:1","result":{"arr":[{"ok":1},{"__proto__":{"x":1}}]}}',
    ];
    for (const payload of payloads) {
      expect(adapterRpcMessageSchema.safeParse(parse(payload)).success).toBe(false);
    }
  });

  it("rejects forbidden property names at the runtime event boundary", () => {
    const malicious = parse(
      '{"schemaVersion":"1.0.0","eventId":"event:1","type":"job.status_changed","aggregateType":"job","aggregateId":"job:1","sequence":1,"occurredAt":"2026-08-06T12:00:00.000Z","__proto__":{"polluted":true},"payload":{"jobId":"job:1","status":"running"}}',
    );
    expect(runtimeEventSchema.safeParse(malicious).success).toBe(false);
  });

  it("rejects unsafe JSON: proto keys, NaN, Infinity, cycles, functions, symbols, class instances", () => {
    expect(safeJsonObjectSchema.safeParse(parse('{"__proto__":{"x":1}}')).success).toBe(false);
    expect(safeJsonObjectSchema.safeParse({ a: Number.NaN }).success).toBe(false);
    expect(safeJsonObjectSchema.safeParse({ a: Number.POSITIVE_INFINITY }).success).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(safeJsonValueSchema.safeParse(cyclic).success).toBe(false);
    expect(safeJsonValueSchema.safeParse(() => 1).success).toBe(false);
    expect(safeJsonValueSchema.safeParse(Symbol("x")).success).toBe(false);
    expect(safeJsonValueSchema.safeParse(new Date()).success).toBe(false);
  });

  it("never pollutes Object.prototype through any schema parse path", () => {
    const marker = () => (Object.prototype as unknown as Record<string, unknown>)["polluted"];
    expect(marker()).toBeUndefined();
    adapterRpcMessageSchema.safeParse(
      parse('{"jsonrpc":"2.0","id":"x","result":{"__proto__":{"polluted":"YES"}}}'),
    );
    submitMissionRequestSchema.safeParse(
      parse('{"schemaVersion":"1.0.0","requestId":"r1","__proto__":{"polluted":"YES"}}'),
    );
    safeJsonObjectSchema.safeParse(parse('{"__proto__":{"polluted":"YES"}}'));
    expect(marker()).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not leak a __proto__ own key into parsed strict output", () => {
    const result = submitMissionRequestSchema.safeParse(
      parse('{"schemaVersion":"1.0.0","requestId":"r1","__proto__":{"x":1}}'),
    );
    if (result.success) {
      expect(Object.hasOwn(result.data, "__proto__")).toBe(false);
    }
  });
});
