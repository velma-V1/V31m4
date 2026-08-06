import { describe, expect, it } from "vitest";
import {
  cloneAndFreezeApplicationJson,
  isApplicationJsonValue,
} from "../src/application-json.js";

describe("application JSON values", () => {
  it("accepts finite acyclic JSON and returns recursively frozen copies", () => {
    const input = { values: [1, "two", true, null], nested: { ok: true } };
    expect(isApplicationJsonValue(input)).toBe(true);
    const copy = cloneAndFreezeApplicationJson(input);
    input.nested.ok = false;
    expect(copy).toEqual({ values: [1, "two", true, null], nested: { ok: true } });
    expect(Object.isFrozen(copy)).toBe(true);
  });

  it("rejects cycles, non-finite numbers, class instances, and dangerous keys", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isApplicationJsonValue(cyclic)).toBe(false);
    expect(isApplicationJsonValue({ value: Number.NaN })).toBe(false);
    expect(isApplicationJsonValue(new Date())).toBe(false);
    const sparse = new Array(2);
    sparse[1] = "value";
    expect(isApplicationJsonValue(sparse)).toBe(false);
    const withSymbol = { ok: true, [Symbol("hidden")]: "bad" };
    expect(isApplicationJsonValue(withSymbol)).toBe(false);
    let getterExecuted = false;
    const withGetter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterExecuted = true;
        return "bad";
      },
    });
    expect(isApplicationJsonValue(withGetter)).toBe(false);
    expect(getterExecuted).toBe(false);
    const dangerous = Object.create(null) as Record<string, unknown>;
    dangerous["constructor"] = "bad";
    expect(isApplicationJsonValue(dangerous)).toBe(false);
    expect(() => cloneAndFreezeApplicationJson(cyclic as never)).toThrow();
  });
});
