import type { ArtifactId, JobId, ResourceBudget, SandboxId, TaskId } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";
import { type ApplicationJsonObject, cloneAndFreezeApplicationJson } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { PolicyDecision } from "./policy-engine.port.js";
import type { WorkspaceHandle } from "./workspace-manager.port.js";

/**
 * Sandbox egress policy. `none` is the default posture; an allowlist is an explicit,
 * bounded grant. There is no "allow everything" mode.
 */
export type SandboxNetworkPolicy =
  | Readonly<{ mode: "none" }>
  | Readonly<{ mode: "allowlist"; hosts: readonly string[] }>;

/**
 * Application-local typed isolation contract.
 *
 * The public `ResourceBudget` contract is immutable and expresses wall-clock/RAM/VRAM/
 * invocation bounds only; it cannot express CPU quota, PID ceilings, mount policy, privilege
 * policy, capability policy, Docker-socket policy, or ambient-secret policy. Those live here
 * as typed application state rather than untyped JSON.
 *
 * Every security-relevant field is a fixed literal: the type system forbids relaxing it and
 * `SandboxIsolationPolicy.create` additionally rejects any runtime attempt to do so.
 *
 * `writableWorkspaceOnly` means no additional writable **host** mount. A backend may still
 * provide bounded ephemeral sandbox-internal scratch/tmp/cache storage and a temporary HOME
 * that carry no host secrets, are non-authoritative, and are destroyed with the sandbox.
 */
export interface SandboxIsolationPolicy {
  readonly maxCpuMillisPerSecond: number;
  readonly maxPids: number;
  readonly network: SandboxNetworkPolicy;
  readonly writableWorkspaceOnly: true;
  readonly readOnlyRootFilesystem: true;
  readonly nonRootUser: true;
  readonly noNewPrivileges: true;
  readonly dropAllCapabilities: true;
  readonly allowHostDockerSocket: false;
  readonly allowAmbientHostSecrets: false;
}

/** Only the bounded resource limits and the optional egress grant are caller-supplied. */
export interface SandboxIsolationPolicyInput {
  readonly maxCpuMillisPerSecond: number;
  readonly maxPids: number;
  readonly network?: SandboxNetworkPolicy;
}

/** One full CPU core is 1000 millis per second; 64 cores is the accepted ceiling. */
const MAX_CPU_MILLIS_PER_SECOND = 64_000;
const MAX_PIDS = 4_096;
const MAX_ALLOWLIST_HOSTS = 64;
const MAX_HOST_LENGTH = 253;
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*$/u;

/**
 * The invariant fields, and the only values they may ever hold. A caller that supplies any
 * of these keys must supply exactly the mandated value; anything else fails closed.
 */
const REQUIRED_INVARIANTS = Object.freeze({
  writableWorkspaceOnly: true,
  readOnlyRootFilesystem: true,
  nonRootUser: true,
  noNewPrivileges: true,
  dropAllCapabilities: true,
  allowHostDockerSocket: false,
  allowAmbientHostSecrets: false,
} as const);

function assertBoundedInteger(
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  assertApplication(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "INVALID_APPLICATION_INPUT",
    `${label} must be an integer between ${minimum} and ${maximum}.`,
    { details: { label, value } },
  );
}

function freezeNetworkPolicy(network: SandboxNetworkPolicy | undefined): SandboxNetworkPolicy {
  if (network === undefined || network.mode === "none") {
    assertApplication(
      network === undefined || Object.keys(network).length === 1,
      "INVALID_APPLICATION_INPUT",
      "A `none` sandbox network policy carries no additional fields.",
    );
    return Object.freeze({ mode: "none" as const });
  }
  assertApplication(
    network.mode === "allowlist",
    "INVALID_APPLICATION_INPUT",
    "Sandbox network policy must be `none` or `allowlist`.",
    { details: { mode: String((network as { mode?: unknown }).mode) } },
  );
  const hosts = network.hosts;
  assertApplication(
    Array.isArray(hosts) && hosts.length > 0 && hosts.length <= MAX_ALLOWLIST_HOSTS,
    "INVALID_APPLICATION_INPUT",
    `A sandbox egress allowlist must name between 1 and ${MAX_ALLOWLIST_HOSTS} hosts.`,
  );
  assertApplication(
    new Set(hosts).size === hosts.length,
    "INVALID_APPLICATION_INPUT",
    "Sandbox egress allowlist hosts must be unique.",
  );
  for (const host of hosts) {
    assertApplication(
      typeof host === "string" &&
        host.length > 0 &&
        host.length <= MAX_HOST_LENGTH &&
        HOST_PATTERN.test(host),
      "INVALID_APPLICATION_INPUT",
      "Each sandbox egress allowlist entry must be a bare hostname or IP literal.",
      { details: { host: String(host) } },
    );
  }
  return Object.freeze({ mode: "allowlist" as const, hosts: Object.freeze([...hosts]) });
}

export const SandboxIsolationPolicy = Object.freeze({
  /**
   * Builds a fail-closed isolation policy. Resource bounds are mandatory, egress defaults to
   * `none`, and the security invariants are stamped by this factory rather than accepted from
   * the caller — so no configuration path can produce a privileged, host-writable, socket-
   * mounting, or secret-inheriting sandbox.
   */
  create(input: SandboxIsolationPolicyInput): SandboxIsolationPolicy {
    assertApplication(
      typeof input === "object" && input !== null,
      "INVALID_APPLICATION_INPUT",
      "A sandbox isolation policy input object is required.",
    );
    const candidate = input as unknown as Record<string, unknown>;
    for (const [key, required] of Object.entries(REQUIRED_INVARIANTS)) {
      const supplied = candidate[key];
      assertApplication(
        supplied === undefined || supplied === required,
        "PERMISSION_DENIED",
        `Sandbox isolation invariant ${key} cannot be relaxed.`,
        { details: { key, required, supplied: String(supplied) } },
      );
    }
    assertBoundedInteger(
      "maxCpuMillisPerSecond",
      input.maxCpuMillisPerSecond,
      1,
      MAX_CPU_MILLIS_PER_SECOND,
    );
    assertBoundedInteger("maxPids", input.maxPids, 1, MAX_PIDS);
    return Object.freeze({
      maxCpuMillisPerSecond: input.maxCpuMillisPerSecond,
      maxPids: input.maxPids,
      network: freezeNetworkPolicy(input.network),
      ...REQUIRED_INVARIANTS,
    });
  },
});

export type SandboxStatus = "ready" | "running" | "degraded" | "stopped";

export interface SandboxHandle {
  readonly id: SandboxId;
  readonly jobId: JobId;
  readonly taskId: TaskId;
  readonly workspaceId: string;
  readonly backendId: string;
  readonly status: SandboxStatus;
}

/**
 * Internal sandbox execution status. `unknown` exists only here and in the Execution Ledger:
 * an effect whose application could not be proven after a crash or transport loss. It is
 * deliberately absent from the public v1 `ToolInvocationResult.status` union.
 */
export type SandboxExecutionStatus = "completed" | "failed" | "cancelled" | "unknown";

/** The subset of statuses the immutable public tool contract can represent. */
export type PublicToolInvocationStatus = "completed" | "failed" | "cancelled";

export interface SandboxExecutionResult {
  readonly status: SandboxExecutionStatus;
  readonly outputArtifactIds: readonly ArtifactId[];
  readonly logArtifactIds: readonly ArtifactId[];
  readonly metadata: ApplicationJsonObject;
}

/**
 * Narrows an internal sandbox status to the public v1 tool status. An unreconciled `unknown`
 * effect is an integrity condition, never a silent coercion to success or failure — Task 3's
 * Execution Ledger reconciliation is what resolves it.
 */
export function assertPublicToolInvocationStatus(
  status: SandboxExecutionStatus,
): PublicToolInvocationStatus {
  if (status === "unknown") {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "An unreconciled sandbox effect cannot be reported through the public tool contract.",
      { details: { status } },
    );
  }
  return status;
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
  readonly sandboxRequirement: "none" | "required";
  readonly allowedRoles: readonly string[];
  /** True only for the explicit raw escape hatch (`command.run`). */
  readonly allowsCallerSuppliedCommand: boolean;
}

export interface SemanticExecutionAuthorizationInput {
  readonly contract: SemanticOperationContract;
  readonly role: string;
  readonly policyDecision: PolicyDecision;
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
}

function assertAuthorization(condition: boolean, message: string, details: object): void {
  if (!condition) {
    throw new ApplicationError("PERMISSION_DENIED", message, {
      details: details as ApplicationJsonObject,
    });
  }
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
export class AuthorizedSemanticExecutionPlan {
  readonly #authorized = true;
  readonly operationId: string;
  readonly effectClass: SandboxEffectClass;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly workspaceId: string;
  readonly sandboxId: SandboxId | null;
  readonly command: SandboxCommand | null;
  readonly parameters: ApplicationJsonObject;
  readonly fingerprints: Readonly<Record<string, string>>;

  private constructor(input: SemanticExecutionAuthorizationInput) {
    this.operationId = input.contract.operationId;
    this.effectClass = input.contract.effectClass;
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
    Object.freeze(this);
  }

  /**
   * Issues a plan only when every precondition holds: the role may run the operation, policy
   * allows it, the workspace is one the workspace manager still owns, and — for anything that
   * is not a pure read — a prepared sandbox belonging to this exact task, job, and workspace
   * exists. A command may be present only in the shapes the operation permits.
   */
  static issue(input: SemanticExecutionAuthorizationInput): AuthorizedSemanticExecutionPlan {
    const { contract, sandbox, workspace } = input;
    assertAuthorization(
      contract.allowedRoles.includes(input.role),
      "The requested semantic operation is not permitted for this role.",
      { operationId: contract.operationId, role: input.role },
    );
    if (input.policyDecision === "require_approval") {
      throw new ApplicationError(
        "APPROVAL_REQUIRED",
        "The semantic operation requires a governed approval before it can execute.",
        { details: { operationId: contract.operationId } },
      );
    }
    if (input.policyDecision !== "allow") {
      throw new ApplicationError("POLICY_REJECTED", "Policy denied the semantic operation.", {
        details: { operationId: contract.operationId, decision: input.policyDecision },
      });
    }
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
          sandbox.status !== "stopped",
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
    return new AuthorizedSemanticExecutionPlan(input);
  }

  /** Rejects a structurally forged look-alike; only a real issuance carries the private field. */
  static isAuthentic(value: unknown): value is AuthorizedSemanticExecutionPlan {
    return typeof value === "object" && value !== null && #authorized in value;
  }
}

/**
 * Sandbox lifecycle boundary.
 *
 * `WorkspaceManagerPort` remains the sole workspace/worktree authority: `prepare` consumes a
 * workspace that the trusted runtime already created and never invents a second workspace
 * lifecycle. The model reaches this port only through governed semantic operations, and
 * `execute` accepts only an `AuthorizedSemanticExecutionPlan` — never a bare operation name
 * with free-form parameters.
 */
export interface SandboxPort {
  prepare(
    taskId: TaskId,
    jobId: JobId,
    workspace: WorkspaceHandle,
    budget: ResourceBudget,
    policy: SandboxIsolationPolicy,
    context: OperationContext,
  ): Promise<SandboxHandle>;
  execute(
    sandbox: SandboxHandle,
    plan: AuthorizedSemanticExecutionPlan,
    context: OperationContext,
  ): Promise<SandboxExecutionResult>;
  inspect(id: SandboxId, context: OperationContext): Promise<SandboxHandle | null>;
  cancel(id: SandboxId, context: OperationContext): Promise<void>;
  destroy(id: SandboxId, context: OperationContext): Promise<void>;
}
