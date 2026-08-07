import { type ApplicationJsonObject, cloneAndFreezeApplicationJson } from "./application-json.js";

export type ApplicationErrorCode =
  | "INVALID_APPLICATION_INPUT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "PERMISSION_DENIED"
  | "POLICY_REJECTED"
  | "APPROVAL_REQUIRED"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_EXHAUSTED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DEPENDENCY_FAILURE"
  | "INTEGRITY_FAILURE"
  | "TRANSACTION_FAILED"
  | "UNSUPPORTED_OPERATION";

export interface ApplicationErrorOptions {
  readonly retryable?: boolean;
  readonly details?: ApplicationJsonObject;
  readonly cause?: unknown;
}

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly retryable: boolean;
  readonly details: ApplicationJsonObject;

  constructor(code: ApplicationErrorCode, message: string, options: ApplicationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApplicationError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = cloneAndFreezeApplicationJson(options.details ?? {}) as ApplicationJsonObject;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Readonly<{
    code: ApplicationErrorCode;
    message: string;
    retryable: boolean;
    details: ApplicationJsonObject;
  }> {
    return Object.freeze({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    });
  }
}

export function isApplicationError(value: unknown): value is ApplicationError {
  return value instanceof ApplicationError;
}

export function assertApplication(
  condition: unknown,
  code: ApplicationErrorCode,
  message: string,
  options: ApplicationErrorOptions = {},
): asserts condition {
  if (!condition) {
    throw new ApplicationError(code, message, options);
  }
}

export function normalizeApplicationError(
  value: unknown,
  fallbackMessage = "An application dependency failed.",
): ApplicationError {
  if (isApplicationError(value)) {
    return value;
  }
  return new ApplicationError("DEPENDENCY_FAILURE", fallbackMessage, {
    retryable: false,
    cause: value,
  });
}
