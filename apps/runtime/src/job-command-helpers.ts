import { createHash } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type ApplicationJsonValue,
} from "@v31m4/application";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function asCommandObject(value: ApplicationJsonValue): ApplicationJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Command payload must be an object.");
  }
  return value as ApplicationJsonObject;
}

export function requireCommandId(object: ApplicationJsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `Command field '${key}' is invalid.`, {
      details: { field: key },
    });
  }
  return value;
}

export function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
