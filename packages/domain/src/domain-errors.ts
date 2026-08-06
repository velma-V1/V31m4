export type DomainErrorCode =
  | "INVALID_ID"
  | "INVALID_CONTENT_HASH"
  | "INVALID_SAFE_PATH"
  | "INVALID_SCORE"
  | "INVALID_RESOURCE_BUDGET"
  | "INVALID_DOMAIN_EVENT";

export type DomainErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetails;

  constructor(code: DomainErrorCode, message: string, details: DomainErrorDetails = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export function assertDomain(
  condition: unknown,
  code: DomainErrorCode,
  message: string,
  details: DomainErrorDetails = {},
): asserts condition {
  if (!condition) {
    throw new DomainError(code, message, details);
  }
}
