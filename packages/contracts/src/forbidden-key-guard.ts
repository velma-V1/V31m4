import { z } from "zod";

/** Property names that enable prototype-pollution and are never valid in external JSON. */
export const FORBIDDEN_JSON_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function containsForbiddenPropertyName(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some((item) => containsForbiddenPropertyName(item, active));
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_JSON_KEYS.has(key)) {
        return true;
      }
      if (containsForbiddenPropertyName((value as Record<string, unknown>)[key], active)) {
        return true;
      }
    }
    return false;
  } finally {
    active.delete(value);
  }
}

/**
 * Wraps a schema so that raw input is rejected when it carries a prototype-pollution
 * property name (`__proto__`, `prototype`, `constructor`) at any depth. Strict Zod
 * objects do not reject an own `__proto__` key materialized by `JSON.parse`, so this
 * guard closes that gap at external message boundaries before object parsing runs.
 */
export function guardForbiddenKeys<S extends z.ZodType>(schema: S) {
  return z
    .unknown()
    .superRefine((value, context) => {
      if (containsForbiddenPropertyName(value, new Set())) {
        context.addIssue({
          code: "custom",
          message: "Value contains a forbidden prototype-pollution property name.",
        });
      }
    })
    .pipe(schema);
}
