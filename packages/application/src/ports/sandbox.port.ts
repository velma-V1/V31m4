import type { ArtifactId, JobId, ResourceBudget, SandboxId, TaskId } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { AuthorizedSemanticExecutionPlan } from "./semantic-execution-capability.js";
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
  /**
   * Nominal marker. The two numeric ceilings are plain numbers, so a structural literal that
   * satisfied this interface without going through `create` typechecked and reached the argument
   * builder unbounded — `maxPids: -1` is *unlimited* to Docker, which silently removed the
   * fork-bomb ceiling from an otherwise correctly isolated container. Only `create` stamps this
   * field, so an unbranded literal is now a compile error rather than a valid policy.
   */
  readonly policyKind: "sandbox_isolation_policy";
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
    // `NaN` and the infinities are not representable in the error's JSON details, and reporting a
    // rejected bound must not itself throw an untyped error where a typed refusal is expected.
    { details: { label, value: Number.isFinite(value) ? value : String(value) } },
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
      policyKind: "sandbox_isolation_policy" as const,
      maxCpuMillisPerSecond: input.maxCpuMillisPerSecond,
      maxPids: input.maxPids,
      network: freezeNetworkPolicy(input.network),
      ...REQUIRED_INVARIANTS,
    });
  },

  /**
   * Re-asserts, at a security-critical sink, everything `create` guarantees.
   *
   * The nominal brand closes this at compile time, but a backend emitting a container argument
   * vector is exactly where an erased type is not a defence: `as`, `any`, a JSON round-trip, or a
   * plain JavaScript caller all reach it. This is the one bounds check, reused rather than
   * restated, so the ceilings cannot drift between the factory and the sink.
   */
  assertCanonical(policy: SandboxIsolationPolicy): void {
    assertApplication(
      typeof policy === "object" &&
        policy !== null &&
        policy.policyKind === "sandbox_isolation_policy",
      "PERMISSION_DENIED",
      "A sandbox isolation policy must be one SandboxIsolationPolicy.create issued.",
    );
    for (const [key, required] of Object.entries(REQUIRED_INVARIANTS)) {
      assertApplication(
        (policy as unknown as Record<string, unknown>)[key] === required,
        "PERMISSION_DENIED",
        `Sandbox isolation invariant ${key} cannot be relaxed.`,
        { details: { key, required } },
      );
    }
    assertBoundedInteger(
      "maxCpuMillisPerSecond",
      policy.maxCpuMillisPerSecond,
      1,
      MAX_CPU_MILLIS_PER_SECOND,
    );
    assertBoundedInteger("maxPids", policy.maxPids, 1, MAX_PIDS);
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

/**
 * Sandbox lifecycle boundary.
 *
 * `WorkspaceManagerPort` remains the sole workspace/worktree authority: `prepare` consumes a
 * workspace that the trusted runtime already created and never invents a second workspace
 * lifecycle. The model reaches this port only through governed semantic operations, and
 * `execute` accepts only a single-use `AuthorizedSemanticExecutionPlan` minted by the
 * configured semantic authorization boundary — never a bare operation name with free-form
 * parameters, and never a capability some other issuer produced.
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
