import {
  type ApplicationErrorCode,
  type ApplicationJsonObject,
  isApplicationError,
} from "@v31m4/application";

export interface MappedError {
  readonly status: number;
  readonly body: {
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly details: ApplicationJsonObject;
    };
  };
}

const STATUS_BY_CODE: Readonly<Record<ApplicationErrorCode, number>> = Object.freeze({
  INVALID_APPLICATION_INPUT: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  PERMISSION_DENIED: 403,
  POLICY_REJECTED: 403,
  APPROVAL_REQUIRED: 403,
  CANCELLED: 499,
  DEADLINE_EXCEEDED: 504,
  RESOURCE_EXHAUSTED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  DEPENDENCY_FAILURE: 502,
  INTEGRITY_FAILURE: 500,
  TRANSACTION_FAILED: 500,
  UNSUPPORTED_OPERATION: 501,
});

/**
 * Maps any thrown value to an HTTP status and a safe JSON body. Known {@link ApplicationError}s
 * translate their code to a status and expose their structured, already-safe details; any other
 * value collapses to an opaque 500 so internal failures never leak implementation detail.
 */
export function mapErrorToHttp(error: unknown): MappedError {
  if (isApplicationError(error)) {
    return {
      status: STATUS_BY_CODE[error.code] ?? 500,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: "An unexpected error occurred.",
        retryable: false,
        details: {},
      },
    },
  };
}
