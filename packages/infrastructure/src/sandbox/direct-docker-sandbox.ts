import {
  ApplicationError,
  type ApplicationJsonObject,
  type AuthorizedSemanticExecutionPlan,
  type OperationContext,
  type SandboxExecutionResult,
} from "@v31m4/application";
import { ProcessSupervisor } from "../processes/process-supervisor.js";
import {
  type SandboxBackend,
  type SandboxExecutionSpec,
  SandboxIndeterminateEffectError,
} from "./sandbox-supervisor.js";

/**
 * Hardened direct-Docker sandbox backend.
 *
 * A **challenger**, not a decision: the frozen boundary is `SandboxPort`, and which backend
 * ships is settled only by a target-host bake-off that may conclude no candidate meets the
 * floor. Docker authority is never exposed to the model — the model asks for a semantic
 * operation, an authorized plan names the exact command, and this backend decides the
 * container it runs in.
 *
 * Every docker client invocation goes through the Layer 8 `ProcessSupervisor` rather than a
 * bespoke spawn, so process-group termination, explicit environment inheritance, and bounded
 * output are the existing supervised behavior instead of a parallel implementation.
 */
export interface DockerSandboxSettings {
  /** Digest-pinned image. A floating tag is not an acceptable trusted dependency. */
  readonly image: string;
  readonly dockerExecutable: string;
  /** Non-root `uid:gid`. Neither may be 0. */
  readonly userSpec: string;
  readonly maxOutputBytes?: number;
}

/**
 * The backend owns the container-side workspace target. A caller cannot relocate it — a
 * caller-chosen target such as `/` would mount the workspace over the container root and
 * destroy the read-only-root and workspace-only guarantees at once.
 */
export const CONTAINER_WORKDIR = "/workspace";
const CONTAINER_HOME = "/home/sandbox";
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const CLEANUP_TIMEOUT_MS = 30_000;
const DIGEST_PINNED_IMAGE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/u;
const USER_SPEC = /^([0-9]+):([0-9]+)$/u;

/** Host variables the docker *client* needs; none of these reach the container. */
const HOST_CLIENT_ENVIRONMENT = Object.freeze([
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
]);

function denied(message: string, details: ApplicationJsonObject): ApplicationError {
  return new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}

/**
 * Validates backend settings before anything is probed or executed, so an unsafe
 * configuration can never reach a running container.
 */
export function assertValidDockerSandboxSettings(settings: DockerSandboxSettings): void {
  if (typeof settings.image !== "string" || !DIGEST_PINNED_IMAGE.test(settings.image)) {
    throw denied(
      "A sandbox image must be digest-pinned as <repository>@sha256:<64 lowercase hex>; a floating tag is refused.",
      { image: String(settings.image) },
    );
  }
  const user = USER_SPEC.exec(settings.userSpec ?? "");
  if (user === null) {
    throw denied("A sandbox user must be a numeric uid:gid pair.", {
      userSpec: String(settings.userSpec),
    });
  }
  if (user[1] === undefined || user[2] === undefined) {
    throw denied("A sandbox user must be a numeric uid:gid pair.", { userSpec: settings.userSpec });
  }
  if (Number(user[1]) === 0 || Number(user[2]) === 0) {
    throw denied("A sandbox must not run as uid 0 or gid 0.", { userSpec: settings.userSpec });
  }
  if (typeof settings.dockerExecutable !== "string" || settings.dockerExecutable.length === 0) {
    throw denied("A container runtime executable is required.", {
      dockerExecutable: String(settings.dockerExecutable),
    });
  }
}

export function containerNameFor(sandboxId: string): string {
  return `v31m4-sandbox-${sandboxId.replace(/[^A-Za-z0-9_.-]/gu, "-")}`;
}

/**
 * Builds the exact `docker run` argument vector. Exported so the security boundary is asserted
 * against the real production argv rather than a re-implementation in a test.
 *
 * Every container is network-isolated, read-only-rooted, non-root, capability-stripped,
 * privilege-escalation-blocked, CPU/PID/memory-bounded, mounted with the assigned workspace at
 * the backend-owned target as its only host path, and given ephemeral in-container tmpfs
 * scratch plus a temporary HOME that carry no host secrets and vanish with the container.
 * No Docker socket is ever mounted.
 */
export function buildDockerRunArguments(
  spec: SandboxExecutionSpec,
  settings: DockerSandboxSettings,
  command: readonly string[],
): string[] {
  assertValidDockerSandboxSettings(settings);
  if (spec.policy.network.mode !== "none") {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "The direct-Docker backend cannot yet enforce an egress allowlist; it fails closed instead of granting broader network access than requested.",
      { details: { sandboxId: spec.sandboxId, mode: spec.policy.network.mode } },
    );
  }
  if (command.length === 0) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "A sandbox command is required.", {
      details: { sandboxId: spec.sandboxId },
    });
  }

  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    settings.userSpec,
    "--pids-limit",
    String(spec.policy.maxPids),
    "--cpus",
    formatCpuQuota(spec.policy.maxCpuMillisPerSecond),
    "--workdir",
    CONTAINER_WORKDIR,
    "--mount",
    `type=bind,source=${spec.workspaceRoot},target=${CONTAINER_WORKDIR}`,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--tmpfs",
    `${CONTAINER_HOME}:rw,noexec,nosuid,nodev,size=16m`,
    "--env",
    `HOME=${CONTAINER_HOME}`,
    "--env",
    "TMPDIR=/tmp",
    "--label",
    `v31m4.sandbox=${spec.sandboxId}`,
    "--name",
    containerNameFor(spec.sandboxId),
    "--stop-timeout",
    "5",
  ];

  if (spec.budget.maxRamBytes !== undefined) {
    // Equal memory and memory+swap means the container cannot escape its RAM bound via swap.
    args.push("--memory", String(spec.budget.maxRamBytes));
    args.push("--memory-swap", String(spec.budget.maxRamBytes));
  }

  args.push(settings.image, ...command);
  return args;
}

function formatCpuQuota(maxCpuMillisPerSecond: number): string {
  const cpus = maxCpuMillisPerSecond / 1000;
  return Number.isInteger(cpus) ? String(cpus) : String(Number(cpus.toFixed(3)));
}

interface SupervisedRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/**
 * Runs one docker client invocation under the Layer 8 process supervisor. A pre-aborted
 * operation never spawns anything; a timeout or cancellation terminates the whole process
 * group through the supervisor rather than signalling a single pid.
 */
async function runSupervised(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: OperationContext["signal"],
): Promise<SupervisedRunResult> {
  if (signal?.aborted === true) {
    throw new ApplicationError("CANCELLED", "The operation was cancelled before the sandbox ran.", {
      details: { executable },
    });
  }
  const supervisor = new ProcessSupervisor({
    command: executable,
    args: [...args],
    inheritEnvironment: HOST_CLIENT_ENVIRONMENT,
    stderrLimitBytes: maxOutputBytes,
    shutdownTimeoutMs: 2_000,
  });
  const child = await supervisor.start();

  let stdout = "";
  let stderr = "";
  const append = (target: "out" | "err", chunk: Buffer): void => {
    const current = target === "out" ? stdout : stderr;
    if (current.length >= maxOutputBytes) return;
    const bounded = (current + chunk.toString("utf8")).slice(0, maxOutputBytes);
    if (target === "out") stdout = bounded;
    else stderr = bounded;
  };
  child.stdout.on("data", (chunk: Buffer) => append("out", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("err", chunk));

  let timedOut = false;
  let cancelled = false;
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void supervisor.stop("SIGKILL");
  }, timeoutMs);
  const onAbort = (): void => {
    cancelled = true;
    void supervisor.stop("SIGKILL");
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const code = await exited;
    return { code, stdout, stderr, timedOut, cancelled };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export class DirectDockerSandbox implements SandboxBackend {
  readonly id = "direct-docker";
  readonly #settings: DockerSandboxSettings;
  /** Explicit supervised lifecycle state: which container name belongs to which sandbox. */
  readonly #containers = new Map<string, string>();
  #availability: Promise<boolean> | undefined;

  constructor(settings: DockerSandboxSettings) {
    assertValidDockerSandboxSettings(settings);
    this.#settings = settings;
  }

  /** Probes for a reachable container runtime. A missing daemon is reported, never worked around. */
  available(): Promise<boolean> {
    this.#availability ??= runSupervised(
      this.#settings.dockerExecutable,
      ["version", "--format", "{{.Server.Version}}"],
      15_000,
      4_096,
    )
      .then((result) => result.code === 0 && result.stdout.trim().length > 0)
      .catch(() => false);
    return this.#availability;
  }

  async prepare(spec: SandboxExecutionSpec, _context: OperationContext): Promise<void> {
    await this.#assertAvailable(spec);
    this.#containers.set(spec.sandboxId, containerNameFor(spec.sandboxId));
  }

  async execute(
    spec: SandboxExecutionSpec,
    plan: AuthorizedSemanticExecutionPlan,
    context: OperationContext,
  ): Promise<SandboxExecutionResult> {
    await this.#assertAvailable(spec);
    if (plan.command === null) {
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "This semantic operation has no trusted container command; the direct-Docker backend refuses to invent one.",
        { details: { sandboxId: spec.sandboxId, operationId: plan.operationId } },
      );
    }
    const args = buildDockerRunArguments(spec, this.#settings, [
      plan.command.executable,
      ...plan.command.arguments,
    ]);
    const result = await runSupervised(
      this.#settings.dockerExecutable,
      args,
      spec.budget.maxWallClockMs,
      this.#settings.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      context.signal,
    ).catch((error: unknown) => {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("DEPENDENCY_FAILURE", "The container runtime call failed.", {
        cause: error,
        details: { sandboxId: spec.sandboxId, operationId: plan.operationId },
      });
    });

    if (result.timedOut || result.cancelled) {
      // Killing the docker *client* proves nothing about the container, so remove it by name
      // and verify it is gone before saying anything about the effect.
      await this.#removeContainer(spec);
    }
    if (result.timedOut) {
      throw new SandboxIndeterminateEffectError(
        `Sandbox ${spec.sandboxId} exceeded its ${spec.budget.maxWallClockMs}ms budget; its container was force-removed before the effect could be confirmed.`,
      );
    }

    const metadata: ApplicationJsonObject = Object.freeze({
      operationId: plan.operationId,
      backend: this.id,
      image: this.#settings.image,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? -1,
    });
    return Object.freeze({
      status: result.cancelled ? ("cancelled" as const) : statusFor(result.code),
      outputArtifactIds: Object.freeze([]),
      logArtifactIds: Object.freeze([]),
      metadata,
    });
  }

  async cancel(spec: SandboxExecutionSpec, _context: OperationContext): Promise<void> {
    await this.#removeContainer(spec);
  }

  async destroy(spec: SandboxExecutionSpec, _context: OperationContext): Promise<void> {
    await this.#removeContainer(spec);
    this.#containers.delete(spec.sandboxId);
  }

  /**
   * Force-removes the sandbox's container and proves its absence. A cleanup failure is raised,
   * never suppressed: the caller must keep the sandbox reconcilable rather than forget it.
   */
  async #removeContainer(spec: SandboxExecutionSpec): Promise<void> {
    if (!(await this.available())) {
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "The container runtime is unreachable, so sandbox container removal cannot be proven.",
        { details: { sandboxId: spec.sandboxId } },
      );
    }
    const name = this.#containers.get(spec.sandboxId) ?? containerNameFor(spec.sandboxId);
    // `rm --force` exits non-zero when the container is already gone, which is the state we
    // want; absence is established by the explicit check below, not by this exit code.
    await runSupervised(
      this.#settings.dockerExecutable,
      ["rm", "--force", name],
      CLEANUP_TIMEOUT_MS,
      4_096,
    ).catch(() => undefined);

    const listed = await runSupervised(
      this.#settings.dockerExecutable,
      ["ps", "--all", "--quiet", "--filter", `name=^${name}$`],
      CLEANUP_TIMEOUT_MS,
      4_096,
    );
    if (listed.code !== 0) {
      throw new ApplicationError(
        "DEPENDENCY_FAILURE",
        "Sandbox container removal could not be verified.",
        { details: { sandboxId: spec.sandboxId, container: name, stderr: listed.stderr } },
      );
    }
    if (listed.stdout.trim().length > 0) {
      throw new ApplicationError(
        "DEPENDENCY_FAILURE",
        "The sandbox container still exists after a forced removal.",
        { details: { sandboxId: spec.sandboxId, container: name } },
      );
    }
  }

  async #assertAvailable(spec: SandboxExecutionSpec): Promise<void> {
    if (await this.available()) return;
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No reachable container runtime; the direct-Docker sandbox refuses to run without its isolation boundary.",
      { details: { sandboxId: spec.sandboxId, executable: this.#settings.dockerExecutable } },
    );
  }
}

function statusFor(code: number | null): "completed" | "failed" {
  return code === 0 ? "completed" : "failed";
}
