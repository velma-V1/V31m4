import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationActor, OperationContext } from "../operation-context.js";

export type PolicyDecision = "allow" | "deny" | "require_approval";

export interface PolicyRequest {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly actor: OperationActor;
  readonly attributes: ApplicationJsonObject;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly policyId: string;
  readonly reasons: readonly string[];
  readonly requiredApprovalScopes: readonly string[];
  readonly expiresAt?: string;
}

export interface PolicyEnginePort {
  evaluate(request: PolicyRequest, context: OperationContext): Promise<PolicyResult>;
}
