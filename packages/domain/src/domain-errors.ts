export type DomainErrorCode =
  | "INVALID_ID"
  | "INVALID_CONTENT_HASH"
  | "INVALID_SAFE_PATH"
  | "INVALID_SCORE"
  | "INVALID_RESOURCE_BUDGET"
  | "INVALID_DOMAIN_EVENT"
  | "INVALID_PROJECT"
  | "INVALID_REQUIREMENT"
  | "INVALID_MISSION_CONTRACT"
  | "INVALID_JOB"
  | "INVALID_CHECKPOINT"
  | "INVALID_ARTIFACT"
  | "INVALID_EVIDENCE"
  | "INVALID_CLAIM"
  | "INVALID_PRODUCTION_TWIN"
  | "INVALID_MODEL_PROFILE"
  | "INVALID_TOOL_PROFILE"
  | "INVALID_PLUGIN_PROFILE"
  | "INVALID_SOLVER_CANDIDATE"
  | "INVALID_VERIFICATION_RESULT"
  | "INVALID_ISSUE_RECORD"
  | "INVALID_REPAIR_RECORD"
  | "INVALID_CHAMPION_DECISION"
  | "INVALID_DELIVERY_RECEIPT"
  | "INVALID_TRAINING_PACKET"
  | "INVALID_CAPABILITY_PROFILE"
  | "INVALID_PRACTICE_TASK"
  | "INVALID_PROMOTION_RECORD"
  | "INVALID_AVATAR_STATE"
  | "INVALID_STATE_TRANSITION"
  | "INVALID_TASK_CAPSULE";

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
