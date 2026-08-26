import { spawn } from "node:child_process";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type OperationContext,
  type SandboxExecutionResult,
} from "@v31m4/application";
import {
  type SandboxBackend,
  type SandboxExecutionSpec,
  SandboxIndeterminateEffectError,
} from "./sandbox-supervisor.js";

/**
 * Hardened direct-Docker sandbox backend.
 *
 * This is a **challenger**, not a decision: the frozen boundary is `SandboxPort`, and which
 * backend ships is settled only by a target-host bake-off that is allowed to conclude that no
 * candidate meets the floor. Docker authority is never exposed to the model — the model asks
 * for a semantic operation and this backend decides the container it runs in.
 */
export interface DockerSandboxSettings {
  /** Pinned, digest-addressed image. Floating tags are a supply-chain hazard. */
  readonly image: string;
  readonly dockerExecutable: string;
  /** Non-root `uid:gid` the container process runs as. */
  readonly userSpec: string;
  readonly containerWorkdir: string;
  readonly maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const CONTAINER_HOME = "/home/sandbox";
/** Host variables the docker *client* needs; none of these reach the container. */
const HOST_CLIENT_ENVIRONMENT = Object.freeze([
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
]);

function sanitizeContainerName(sandboxId: string): string {
  return `v31m4-sandbox-${sandboxId.replace(/[^A-Za-z0-9_.-]/gu, "-")}`;
}

/**
 * Builds the exact `docker run` argument vector. Exported so the security boundary is asserted
 * against the real production argv rather than a re-implementation in a test.
 *
 * Every container is: network-isolated, read-only-rooted, non-root, capability-stripped,
 * privilege-escalation-blocked, CPU/PID/memory-bounded, mounted with the assigned workspace as
 * its only host path, and given ephemeral in-container tmpfs scratch plus a temporary HOME
 * that carry no host secrets and disappear with the container. No Docker socket is ever mounted.
 */
export function buildDockerRunArguments(
  spec: SandboxExecutionSpec,
  settings: DockerSandboxSettings,
  command: readonly string[],
): string[] {
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
    settings.containerWorkdir,
    "--mount",
    `type=bind,source=${spec.workspaceRoot},target=${settings.containerWorkdir}`,
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
    sanitizeContainerName(spec.sandboxId),
    "--stop-timeout",
    "5",
  ];

  if (spec.budget.maxRamBytes !== undefined) {
    args.push("--memory", String(spec.budget.maxRamBytes));
    // Equal memory and memory+swap means the container cannot escape its RAM bound via swap.
    args.push("--memory-swap", String(spec.budget.maxRamBytes));
  }

  args.push(settings.image, ...command);
  return args;
}

function formatCpuQuota(maxCpuMillisPerSecond: number): string {
  const cpus = maxCpuMillisPerSecond / 1000;
  return Number.isInteger(cpus) ? String(cpus) : String(Number(cpus.toFixed(3)));
}

interface BoundedProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

function runBoundedProcess(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: OperationContext["signal"],
): Promise<BoundedProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of HOST_CLIENT_ENVIRONMENT) {
      const value = process.env[key];
      if (value !== undefined) environment[key] = value;
    }
    const child = spawn(executable, [...args], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    const append = (target: "out" | "err", chunk: Buffer): void => {
      const current = target === "out" ? stdout : stderr;
      if (current.length >= maxOutputBytes) return;
      const text = current + chunk.toString("utf8");
      const bounded = text.slice(0, maxOutputBytes);
      if (target === "out") stdout = bounded;
      else stderr = bounded;
    };
    child.stdout.on("data", (chunk: Buffer) => append("out", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("err", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.once("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    child.once("close", (code, closeSignal) => {
      cleanup();
      resolvePromise({ code, signal: closeSignal, stdout, stderr, timedOut, cancelled });
    });
  });
}

export class DirectDockerSandbox implements SandboxBackend {
  readonly id = "direct-docker";
  readonly #settings: DockerSandboxSettings;
  #availability: Promise<boolean> | undefined;

  constructor(settings: DockerSandboxSettings) {
    this.#settings = settings;
  }

  /** Probes for a reachable container runtime. A missing daemon is reported, never worked around. */
  available(): Promise<boolean> {
    this.#availability ??= runBoundedProcess(
      this.#settings.dockerExecutable,
      ["version", "--format", "{{.Server.Version}}"],
      15_000,
      4_096,
    )
      .then((result) => result.code === 0 && result.stdout.trim().length > 0)
      .catch(() => false);
    return this.#availability;
  }

  async prepare(spec: SandboxExecutionSpec): Promise<void> {
    // Containers are created per execution with `--rm`, so preparation only asserts the
    // runtime is genuinely reachable rather than silently degrading isolation later.
    await this.#assertAvailable(spec);
  }

  async execute(
    spec: SandboxExecutionSpec,
    operation: string,
    parameters: ApplicationJsonObject,
    context: OperationContext,
  ): Promise<SandboxExecutionResult> {
    await this.#assertAvailable(spec);
    const command = readCommand(parameters, spec);
    const args = buildDockerRunArguments(spec, this.#settings, command);
    const result = await runBoundedProcess(
      this.#settings.dockerExecutable,
      args,
      spec.budget.maxWallClockMs,
      this.#settings.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      context.signal,
    ).catch((error: unknown) => {
      throw new ApplicationError("DEPENDENCY_FAILURE", "The container runtime call failed.", {
        cause: error,
        details: { sandboxId: spec.sandboxId, operation },
      });
    });

    if (result.timedOut) {
      // The container was killed mid-flight: whether its effect applied is unknown, and a
      // blind retry would be unsound. Reconciliation, not retry, resolves this.
      throw new SandboxIndeterminateEffectError(
        `Sandbox ${spec.sandboxId} exceeded its ${spec.budget.maxWallClockMs}ms budget and was killed before confirmation.`,
      );
    }

    const metadata: ApplicationJsonObject = Object.freeze({
      operation,
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

  async cancel(spec: SandboxExecutionSpec): Promise<void> {
    await this.#stopContainer(spec);
  }

  async destroy(spec: SandboxExecutionSpec): Promise<void> {
    await this.#stopContainer(spec);
  }

  async #stopContainer(spec: SandboxExecutionSpec): Promise<void> {
    if (!(await this.available())) return;
    await runBoundedProcess(
      this.#settings.dockerExecutable,
      ["rm", "--force", sanitizeContainerName(spec.sandboxId)],
      15_000,
      4_096,
    ).catch(() => undefined);
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

function readCommand(
  parameters: ApplicationJsonObject,
  spec: SandboxExecutionSpec,
): readonly string[] {
  const executable = parameters["executable"];
  const args = parameters["arguments"];
  if (typeof executable !== "string" || executable.length === 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "A sandbox execution requires an explicit executable.",
      { details: { sandboxId: spec.sandboxId } },
    );
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "Sandbox command arguments must be an array of strings; no shell string is ever constructed.",
      { details: { sandboxId: spec.sandboxId } },
    );
  }
  return [executable, ...(args as readonly string[])];
}
