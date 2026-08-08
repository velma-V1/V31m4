import type {
  OperationContext,
  PolicyDecision,
  PolicyEnginePort,
  PolicyRequest,
  PolicyResult,
} from "@v31m4/application";

export type ActorKind = "user" | "system" | "model" | "plugin" | "scheduler";

export interface PolicyRule {
  readonly id: string;
  readonly effect: PolicyDecision;
  /** Action patterns: exact (`project.create`), prefix glob (`tool.*`), or `*`. */
  readonly actions: readonly string[];
  readonly resourceTypes?: readonly string[];
  readonly actorKinds?: readonly ActorKind[];
  /** The actor must hold every role listed here for the rule to match. */
  readonly requiredRoles?: readonly string[];
  readonly requiredApprovalScopes?: readonly string[];
  readonly reason: string;
}

function actionMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

function ruleMatches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (!rule.actions.some((pattern) => actionMatches(pattern, request.action))) return false;
  if (rule.resourceTypes !== undefined && !rule.resourceTypes.includes(request.resourceType))
    return false;
  if (rule.actorKinds !== undefined && !rule.actorKinds.includes(request.actor.kind as ActorKind))
    return false;
  if (rule.requiredRoles !== undefined) {
    const roles = new Set(request.actor.roles);
    if (!rule.requiredRoles.every((role) => roles.has(role))) return false;
  }
  return true;
}

/**
 * Deterministic, fail-closed policy engine. Rules are evaluated in order; the first
 * matching rule decides. When no rule matches the request is denied, so a resource with
 * no explicit allow is never reachable. The engine only decides — approval issuance and
 * consumption are the caller's responsibility (Layer 6 `authorizeAction`).
 */
export class RuleBasedPolicyEngine implements PolicyEnginePort {
  readonly #rules: readonly PolicyRule[];

  constructor(rules: readonly PolicyRule[]) {
    this.#rules = Object.freeze([...rules]);
  }

  async evaluate(request: PolicyRequest, _context: OperationContext): Promise<PolicyResult> {
    for (const rule of this.#rules) {
      if (!ruleMatches(rule, request)) continue;
      return Object.freeze({
        decision: rule.effect,
        policyId: rule.id,
        reasons: Object.freeze([rule.reason]),
        requiredApprovalScopes: Object.freeze([...(rule.requiredApprovalScopes ?? [])]),
      });
    }
    return Object.freeze({
      decision: "deny" as const,
      policyId: "default-deny",
      reasons: Object.freeze(["No policy rule permits this action."]),
      requiredApprovalScopes: Object.freeze([]),
    });
  }
}
