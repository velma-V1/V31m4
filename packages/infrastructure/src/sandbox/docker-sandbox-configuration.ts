import { createHash } from "node:crypto";
import { ApplicationError, type ApplicationJsonObject } from "@v31m4/application";
import type { SandboxExecutionSpec } from "./sandbox-supervisor.js";

/**
 * Docker sandbox configuration and argument construction.
 *
 * Split out of `direct-docker-sandbox.ts` to stay under the mandatory source-size limit.
 */

function denied(message: string, details: ApplicationJsonObject): ApplicationError {
  return new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}

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
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
export const CLEANUP_TIMEOUT_MS = 30_000;
const DIGEST_PINNED_IMAGE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/u;
/** Upper bound on captured output; a larger budget is a memory hazard, not a capability. */
export const MAX_ALLOWED_OUTPUT_BYTES = 64 * 1024 * 1024;
const USER_SPEC = /^([0-9]+):([0-9]+)$/u;

/** Host variables the docker *client* needs; none of these reach the container. */
export const HOST_CLIENT_ENVIRONMENT = Object.freeze([
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
]);

/**
 * Validates backend settings before anything is probed or executed, so an unsafe
 * configuration can never reach a running container.
 */
const ALLOWED_SETTING_KEYS: ReadonlySet<string> = new Set([
  "image",
  "dockerExecutable",
  "userSpec",
  "maxOutputBytes",
]);

export function assertValidDockerSandboxSettings(settings: DockerSandboxSettings): void {
  if (typeof settings !== "object" || settings === null) {
    throw denied("Docker sandbox settings are required.", {});
  }
  // Reject anything not explicitly allowed. A legacy or unknown security-sensitive key such as
  // `containerWorkdir` must fail loudly rather than be silently ignored: a caller that believes
  // it relocated the workspace target is reasoning about a boundary that no longer exists.
  for (const key of Object.keys(settings)) {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw denied(
        "Unknown Docker sandbox setting; security-sensitive configuration is strictly allowlisted.",
        { rejectedSetting: key },
      );
    }
  }
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
  if (settings.maxOutputBytes !== undefined) {
    const limit: unknown = settings.maxOutputBytes;
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit <= 0 ||
      limit > MAX_ALLOWED_OUTPUT_BYTES
    ) {
      throw denied(
        `maxOutputBytes must be a positive integer no greater than ${MAX_ALLOWED_OUTPUT_BYTES}.`,
        { maxOutputBytes: String(limit) },
      );
    }
  }
}

export function containerNameFor(sandboxId: string): string {
  return `v31m4-sandbox-${createHash("sha256").update(sandboxId, "utf8").digest("hex")}`;
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
    "--label",
    `v31m4.task=${spec.taskId}`,
    "--label",
    `v31m4.job=${spec.jobId}`,
    "--label",
    `v31m4.workspace=${spec.workspaceId}`,
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

/**
 * How a supervised docker client invocation ended. Everything except `exited` means the client
 * was killed without reporting the container's fate, so the container may still be running.
 */
