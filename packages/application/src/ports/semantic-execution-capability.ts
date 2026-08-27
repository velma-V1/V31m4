import type { JobId, SandboxId, TaskId } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { type ApplicationJsonObject, cloneAndFreezeApplicationJson } from "../application-json.js";
import type { PolicyResult } from "./policy-engine.port.js";
import type { SandboxHandle } from "./sandbox.port.js";
import type { WorkspaceHandle } from "./workspace-manager.port.js";

/**
 * Semantic execution capabilities.
 *
 * Split out of `sandbox.port.ts` to stay under the mandatory source-size limit; the two files
 * reference each other only through erased type-only imports, so there is no runtime cycle.
 */

function assertAuthorization(condition: boolean, message: string, details: object): void {
  if (!condition) {
    throw new ApplicationError("PERMISSION_DENIED", message, {
      details: details as ApplicationJsonObject,
    });
  }
}

export type SandboxEffectClass =
  | "read"
  | "workspace_write"
  | "process_execute"
  | "network_read"
  | "network_effect";

/**
 * The concrete process a sandbox may run. Always an executable plus an argument array; no
 * shell string is ever constructed, and only an operation that explicitly permits a
 * caller-supplied command can put model-influenced values here.
 */
export interface SandboxCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
}

/**
 * The part of a semantic operation definition the authorizer needs. The definition itself is
 * owned by the runtime operation catalog; this is the structural contract it satisfies, so
 * the application layer authorizes without holding a second copy of the registry.
 */
export interface SemanticOperationContract {
  readonly operationId: string;
  readonly effectClass: SandboxEffectClass;
  readonly riskClass: "low" | "moderate" | "high" | "critical";
  readonly sandboxRequirement: "none" | "required";
  readonly allowedRoles: readonly string[];
  readonly evidencePreconditionPolicyId: string;
  readonly resourcePolicy: SemanticResourcePolicy;
  /** True only for the explicit raw escape hatch (`command.run`). */
  readonly allowsCallerSuppliedCommand: boolean;
}

/** Canonical per-operation ceilings copied from the runtime-owned semantic catalog. */
export interface SemanticResourcePolicy {
  readonly maxWallClockMs: number;
  readonly maxOutputBytes: number;
  readonly maxConcurrent: number;
}

/** Policy provenance sealed into the execution capability after a real engine decision. */
export interface SemanticPolicyGrant {
  readonly decision: "allow";
  readonly policyId: string;
  readonly expiresAt?: string;
}

export interface SemanticExecutionAuthorizationInput {
  readonly contract: SemanticOperationContract;
  readonly role: string;
  readonly policyGrant: PolicyResult;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly workspace: WorkspaceHandle;
  readonly sandbox: SandboxHandle | null;
  /**
   * The trusted command the runtime derived for this operation, or `null` for an operation a
   * backend serves natively without spawning a process.
   */
  readonly command: SandboxCommand | null;
  readonly parameters: ApplicationJsonObject;
  readonly fingerprints?: Readonly<Record<string, string>>;
  /**
   * A workspace fact the sandbox must re-verify immediately before dispatch. Supplied for
   * operations whose correctness depends on the workspace not having moved since authorization.
   */
  readonly currencyPrecondition?: WorkspaceCurrencyPrecondition | null;
}

/**
 * A capability token binding one authorization decision to one concrete execution.
 *
 * The sandbox execution sink accepts only an instance of this class — never an operation
 * string plus free-form JSON. That closes the gap where authorization and execution were
 * separate steps and a caller could name a harmless operation while supplying an arbitrary
 * command. Every field the sink trusts (operation, task, workspace, sandbox, command,
 * validated parameters, fingerprints) is fixed at issuance and frozen.
 *
 * The private `#authorized` field makes the token unforgeable: a structurally identical plain
 * object fails `isAuthentic`, so a fabricated plan cannot reach a backend.
 */
/**
 * A workspace fact an execution depends on, re-verified at the sink immediately before
 * dispatch. Validating currency only at authorization time leaves a window in which the
 * workspace changes and a stale effect still executes.
 */
export interface WorkspaceCurrencyPrecondition {
  /** Workspace-relative path whose content fingerprint must still match. */
  readonly path: string;
  readonly expectedFingerprint: string;
  /** The closed set of workspace-relative paths this execution may touch. */
  readonly allowedPathScope: readonly string[];
}

const PLAN_CONSTRUCTION_TOKEN: unique symbol = Symbol("v31m4.authorized-semantic-execution-plan");

/**
 * A single-use capability binding one authorization decision to one concrete execution.
 *
 * There is deliberately **no public constructor and no public factory**. The only way to obtain
 * an instance is `SemanticExecutionAuthority.mint`, and the only authority that exists is the
 * one a composition root creates and hands to its canonical semantic authorizer. A sandbox
 * verifies against that same authority's closure-owned registry, so "this object is an
 * AuthorizedSemanticExecutionPlan" is never sufficient — it must be a plan *this* authority
 * minted. Structural shape and class identity are both insufficient by design, which is why
 * verification is issuer-bound rather than a branding check.
 */
export class AuthorizedSemanticExecutionPlan {
  readonly executionPlanId: string;
  readonly issuedAt: string;
  readonly operationId: string;
  readonly effectClass: SandboxEffectClass;
  readonly riskClass: SemanticOperationContract["riskClass"];
  readonly evidencePreconditionPolicyId: string;
  readonly resourcePolicy: SemanticResourcePolicy;
  readonly policyGrant: SemanticPolicyGrant;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly workspaceId: string;
  readonly sandboxId: SandboxId | null;
  readonly command: SandboxCommand | null;
  readonly parameters: ApplicationJsonObject;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly currencyPrecondition: WorkspaceCurrencyPrecondition | null;

  constructor(
    token: symbol,
    input: SemanticExecutionAuthorizationInput,
    executionPlanId: string,
    issuedAt: string,
  ) {
    if (token !== PLAN_CONSTRUCTION_TOKEN) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Execution capabilities can only be minted by a semantic execution authority.",
        {},
      );
    }
    this.executionPlanId = executionPlanId;
    this.issuedAt = issuedAt;
    this.operationId = input.contract.operationId;
    this.effectClass = input.contract.effectClass;
    this.riskClass = input.contract.riskClass;
    this.evidencePreconditionPolicyId = input.contract.evidencePreconditionPolicyId;
    this.resourcePolicy = Object.freeze({ ...input.contract.resourcePolicy });
    this.policyGrant = Object.freeze({
      decision: "allow" as const,
      policyId: input.policyGrant.policyId,
      ...(input.policyGrant.expiresAt === undefined
        ? {}
        : { expiresAt: input.policyGrant.expiresAt }),
    });
    this.taskId = input.taskId;
    this.jobId = input.jobId;
    this.workspaceId = input.workspace.id;
    this.sandboxId = input.sandbox === null ? null : input.sandbox.id;
    this.command =
      input.command === null
        ? null
        : Object.freeze({
            executable: input.command.executable,
            arguments: Object.freeze([...input.command.arguments]),
          });
    this.parameters = cloneAndFreezeApplicationJson(input.parameters) as ApplicationJsonObject;
    this.fingerprints = Object.freeze({ ...(input.fingerprints ?? {}) });
    this.currencyPrecondition =
      input.currencyPrecondition === undefined || input.currencyPrecondition === null
        ? null
        : Object.freeze({
            path: input.currencyPrecondition.path,
            expectedFingerprint: input.currencyPrecondition.expectedFingerprint,
            allowedPathScope: Object.freeze([...input.currencyPrecondition.allowedPathScope]),
          });
    Object.freeze(this);
  }
}

/** What a sandbox needs: prove the capability is ours, then spend it exactly once. */
export interface SemanticExecutionCapabilityVerifier {
  /** Returns the plan when this authority minted it; otherwise throws `PERMISSION_DENIED`. */
  verify(plan: unknown): AuthorizedSemanticExecutionPlan;
  /** Spends the capability. A second attempt on the same plan is a replay and is rejected. */
  consume(plan: AuthorizedSemanticExecutionPlan): void;
}

/** The mint side, held only by the canonical semantic authorizer that created the authority. */
export interface SemanticExecutionAuthority extends SemanticExecutionCapabilityVerifier {
  mint(input: SemanticExecutionAuthorizationInput): AuthorizedSemanticExecutionPlan;
}

export interface SemanticExecutionAuthorityOptions {
  /** Supplies the per-capability nonce. Injected so the application layer stays deterministic. */
  readonly generateExecutionPlanId: () => string;
  readonly now: () => string;
}

/**
 * Creates one mint/verify pair sharing a closure-private registry.
 *
 * Nothing outside this closure can add to `minted`, so a plan produced by any other authority —
 * or by any caller that somehow obtains a plan-shaped object — fails `verify`. Splitting the
 * pair is the point: a composition root keeps `mint` inside its authorizer and hands only the
 * verifier to the sandbox.
 */
export function createSemanticExecutionAuthority(
  options: SemanticExecutionAuthorityOptions,
): SemanticExecutionAuthority {
  const minted = new WeakSet<AuthorizedSemanticExecutionPlan>();
  const consumed = new WeakSet<AuthorizedSemanticExecutionPlan>();

  return Object.freeze({
    mint(input: SemanticExecutionAuthorizationInput): AuthorizedSemanticExecutionPlan {
      const issuedAt = options.now();
      assertExecutionPreconditions(input, issuedAt);
      const plan = new AuthorizedSemanticExecutionPlan(
        PLAN_CONSTRUCTION_TOKEN,
        input,
        options.generateExecutionPlanId(),
        issuedAt,
      );
      minted.add(plan);
      return plan;
    },

    verify(plan: unknown): AuthorizedSemanticExecutionPlan {
      if (!(plan instanceof AuthorizedSemanticExecutionPlan) || !minted.has(plan)) {
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "The execution capability was not issued by this semantic authorization boundary.",
          {},
        );
      }
      assertPolicyGrantCurrent(plan.policyGrant, options.now());
      return plan;
    },

    consume(plan: AuthorizedSemanticExecutionPlan): void {
      if (!minted.has(plan)) {
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "The execution capability was not issued by this semantic authorization boundary.",
          {},
        );
      }
      assertPolicyGrantCurrent(plan.policyGrant, options.now());
      if (consumed.has(plan)) {
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "The execution capability has already been spent; authorization is single-use.",
          { details: { executionPlanId: plan.executionPlanId, operationId: plan.operationId } },
        );
      }
      consumed.add(plan);
    },
  });
}

/**
 * Every precondition a capability must satisfy before it exists: the role may run the
 * operation, policy allows it, the workspace is one the workspace manager still owns, and —
 * for anything that is not a pure read — a prepared sandbox belonging to this exact task, job,
 * and workspace. A command may only be present in the shapes the operation permits.
 */
function assertExecutionPreconditions(
  input: SemanticExecutionAuthorizationInput,
  now: string,
): void {
  const { contract, sandbox, workspace } = input;
  assertAuthorization(
    contract.allowedRoles.includes(input.role),
    "The requested semantic operation is not permitted for this role.",
    { operationId: contract.operationId, role: input.role },
  );
  if (input.policyGrant.decision === "require_approval") {
    throw new ApplicationError(
      "APPROVAL_REQUIRED",
      "The semantic operation requires a governed approval before it can execute.",
      { details: { operationId: contract.operationId } },
    );
  }
  if (input.policyGrant.decision !== "allow") {
    throw new ApplicationError("POLICY_REJECTED", "Policy denied the semantic operation.", {
      details: { operationId: contract.operationId, decision: input.policyGrant.decision },
    });
  }
  assertAuthorization(
    typeof input.policyGrant.policyId === "string" && input.policyGrant.policyId.length > 0,
    "A semantic execution requires policy provenance from the canonical policy engine.",
    { operationId: contract.operationId },
  );
  assertPolicyGrantCurrent(input.policyGrant, now);
  assertResourcePolicy(contract.resourcePolicy, contract.operationId);
  assertAuthorization(
    typeof contract.evidencePreconditionPolicyId === "string" &&
      contract.evidencePreconditionPolicyId.length > 0,
    "A semantic execution must preserve its canonical evidence-precondition policy identifier.",
    { operationId: contract.operationId },
  );
  assertAuthorization(
    workspace.id.length > 0 && workspace.status === "active",
    "A semantic operation runs only inside an active workspace assigned by WorkspaceManagerPort.",
    { operationId: contract.operationId, workspaceId: workspace.id, status: workspace.status },
  );
  if (contract.sandboxRequirement === "required") {
    assertAuthorization(
      sandbox !== null,
      "This semantic operation has no execution path without a prepared sandbox.",
      { operationId: contract.operationId, effectClass: contract.effectClass },
    );
  }
  if (sandbox !== null) {
    assertAuthorization(
      sandbox.workspaceId === workspace.id &&
        sandbox.taskId === input.taskId &&
        sandbox.jobId === input.jobId &&
        sandbox.status === "ready",
      "The sandbox is not bound to this task, job, and workspace.",
      { operationId: contract.operationId, sandboxId: sandbox.id, workspaceId: workspace.id },
    );
  }
  if (input.command !== null) {
    assertAuthorization(
      typeof input.command.executable === "string" && input.command.executable.length > 0,
      "An authorized command requires a non-empty executable.",
      { operationId: contract.operationId },
    );
    assertAuthorization(
      Array.isArray(input.command.arguments) &&
        input.command.arguments.every((value) => typeof value === "string"),
      "Authorized command arguments must be an array of strings.",
      { operationId: contract.operationId },
    );
  }
}

function assertPolicyGrantCurrent(
  grant: Pick<PolicyResult, "policyId" | "expiresAt">,
  now: string,
): void {
  const nowMs = Date.parse(now);
  assertAuthorization(Number.isFinite(nowMs), "The authorization clock returned an invalid time.", {
    now,
  });
  if (grant.expiresAt === undefined) return;
  const expiresAtMs = Date.parse(grant.expiresAt);
  assertAuthorization(
    Number.isFinite(expiresAtMs) && expiresAtMs > nowMs,
    "The policy grant is malformed or expired and cannot authorize execution.",
    { policyId: grant.policyId, expiresAt: grant.expiresAt, now },
  );
}

function assertResourcePolicy(policy: SemanticResourcePolicy, operationId: string): void {
  for (const [name, value] of Object.entries(policy)) {
    assertAuthorization(
      Number.isSafeInteger(value) && value > 0,
      "A semantic operation resource policy must contain positive integer ceilings.",
      { operationId, resourceLimit: name, value },
    );
  }
}
