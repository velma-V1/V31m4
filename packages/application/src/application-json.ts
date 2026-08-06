export type ApplicationJsonPrimitive = string | number | boolean | null;
export type ApplicationJsonValue =
  | ApplicationJsonPrimitive
  | ApplicationJsonArray
  | ApplicationJsonObject;
export interface ApplicationJsonArray extends ReadonlyArray<ApplicationJsonValue> {}
export interface ApplicationJsonObject {
  readonly [key: string]: ApplicationJsonValue;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isDenseJsonArray(value: readonly unknown[], active: Set<object>): value is ApplicationJsonArray {
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isApplicationJsonValueInternal(value[index], active)) {
      return false;
    }
  }
  return true;
}

function isPlainJsonObject(value: object, active: Set<object>): value is ApplicationJsonObject {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    if (
      key.length === 0 ||
      key.length > 256 ||
      key !== key.trim() ||
      FORBIDDEN_KEYS.has(key)
    ) {
      return false;
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !isApplicationJsonValueInternal(descriptor.value, active)
    ) {
      return false;
    }
  }
  return true;
}

function isApplicationJsonValueInternal(
  value: unknown,
  active: Set<object>,
): value is ApplicationJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    return Array.isArray(value)
      ? isDenseJsonArray(value, active)
      : isPlainJsonObject(value, active);
  } finally {
    active.delete(value);
  }
}

export function isApplicationJsonValue(value: unknown): value is ApplicationJsonValue {
  return isApplicationJsonValueInternal(value, new Set<object>());
}

function cloneKnownJson(value: ApplicationJsonValue): ApplicationJsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneKnownJson(item)));
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneKnownJson(nested)]),
    ),
  ) as ApplicationJsonObject;
}

export function cloneAndFreezeApplicationJson(value: ApplicationJsonValue): ApplicationJsonValue {
  if (!isApplicationJsonValue(value)) {
    throw new TypeError("Value must be finite, acyclic, accessor-free JSON data.");
  }
  return cloneKnownJson(value);
}
