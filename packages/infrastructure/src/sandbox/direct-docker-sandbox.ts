import {
  ApplicationError,
  type ApplicationJsonObject,
  type AuthorizedSemanticExecutionPlan,
  type OperationContext,
  type SandboxExecutionResult,
} from "@v31m4/application";
import { ProcessSupervisor } from "../processes/process-supervisor.js";
import {
  assertValidDockerSandboxSettings,
  buildDockerRunArguments,
  CLEANUP_TIMEOUT_MS,
  containerNameFor,
  DEFAULT_MAX_OUTPUT_BYTES,
  type DockerSandboxSettings,
  HOST_CLIENT_ENVIRONMENT,
} from "./docker-sandbox-configuration.js";
import {
  assertDockerContainerOwnership,
  assertDockerRuntimeObservation,
  type DockerInspectObservation,
  parseDockerInspectObservation,
} from "./docker-sandbox-inspection.js";

/**
 * What the run actually proved. A non-zero docker exit is not by itself evidence about the
 * container: `docker` reports its own client/daemon failures the same way. Only a verified
 * container lifecycle distinguishes "the command failed" from "we do not know what happened".
 */
export type SandboxRunOutcome =
  | "completed_successfully"
  | "container_command_failed_confirmed"
  | "docker_client_abnormal_exit"
  | "timeout"
  | "cancellation"
  | "output_limit"
  | "supervisor_signal"
  | "dependency_spawn_failure";

/** `docker` reserves 125 for its own client/daemon failures. */
const DOCKER_CLIENT_ERROR_EXIT = 125;

import {
  type SandboxBackend,
  type SandboxExecutionSpec,
  SandboxIndeterminateEffectError,
} from "./sandbox-supervisor.js";

/** How the supervised docker client run ended, before any lifecycle proof. */
type ClientTermination =
  | "exited"
  | "timeout"
  | "cancellation"
  | "output_limit"
  | "supervisor_signal";

interface SupervisedRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly termination: ClientTermination;
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
    // Bounding stderr alone leaves stdout free to flood; the sandbox owns both streams, so it
    // opts into the supervisor's combined accounting.
    maxCombinedOutputBytes: maxOutputBytes,
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
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, closeSignal) => resolve({ code, signal: closeSignal }));
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
    const closed = await exited;
    return {
      code: closed.code,
      stdout,
      stderr,
      termination: classifyTermination(timedOut, cancelled, supervisor, closed.signal),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function classifyTermination(
  timedOut: boolean,
  cancelled: boolean,
  supervisor: ProcessSupervisor,
  closeSignal: NodeJS.Signals | null,
): ClientTermination {
  if (timedOut) return "timeout";
  if (cancelled) return "cancellation";
  // The Layer 8 supervisor kills the client when its bounded output is exceeded. That is not an
  // ordinary failure: the container it launched can still be running.
  if (supervisor.terminationReason === "output_limit") return "output_limit";
  if (supervisor.terminationReason !== undefined || closeSignal !== null) {
    return "supervisor_signal";
  }
  return "exited";
}

export class DirectDockerSandbox implements SandboxBackend {
  readonly id = "direct-docker";
  readonly #settings: DockerSandboxSettings;
  /** Explicit supervised lifecycle state: which container name belongs to which sandbox. */
  readonly #containers = new Map<string, string>();
  readonly #specs = new Map<string, SandboxExecutionSpec>();
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
    this.#specs.set(spec.sandboxId, spec);
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
      Math.min(spec.budget.maxWallClockMs, plan.resourcePolicy.maxWallClockMs),
      Math.min(
        this.#settings.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        plan.resourcePolicy.maxOutputBytes,
      ),
      context.signal,
    ).catch((error: unknown) => {
      if (error instanceof ApplicationError) throw error;
      // The client never ran, so no container of ours can exist to reconcile.
      throw new ApplicationError("DEPENDENCY_FAILURE", "The container runtime call failed.", {
        cause: error,
        details: {
          sandboxId: spec.sandboxId,
          operationId: plan.operationId,
          outcome: "dependency_spawn_failure",
        },
      });
    });

    const outcome = await this.#classifyOutcome(spec, result);
    if (outcome !== "completed_successfully" && outcome !== "container_command_failed_confirmed") {
      // The client died, or exited in a way that proves nothing about the container. Remove the
      // container by name and verify it is gone; only then report the effect as indeterminate. A
      // cleanup failure propagates instead, so the supervisor keeps the sandbox reconcilable.
      await this.#removeContainer(spec);
      throw new SandboxIndeterminateEffectError(
        `Sandbox ${spec.sandboxId} ended as ${outcome} without confirming its container; the container was force-removed and its effect cannot be proven.`,
      );
    }

    const metadata: ApplicationJsonObject = Object.freeze({
      operationId: plan.operationId,
      backend: this.id,
      image: this.#settings.image,
      outcome,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? -1,
    });
    return Object.freeze({
      status: outcome === "completed_successfully" ? ("completed" as const) : ("failed" as const),
      outputArtifactIds: Object.freeze([]),
      logArtifactIds: Object.freeze([]),
      metadata,
    });
  }

  /**
   * Turns a raw client result into a claim we can actually defend.
   *
   * Exit 0 with a clean termination is the only unconditional success. Docker's own error exit
   * (125) is never treated as a container result. Any other non-zero exit is only reported as an
   * ordinary failure once the container's absence proves its lifecycle finished; if the container
   * is still there — or its state cannot be read — the outcome is abnormal and gets reconciled.
   */
  async #classifyOutcome(
    spec: SandboxExecutionSpec,
    result: SupervisedRunResult,
  ): Promise<SandboxRunOutcome> {
    if (result.termination === "timeout") return "timeout";
    if (result.termination === "cancellation") return "cancellation";
    if (result.termination === "output_limit") return "output_limit";
    if (result.termination === "supervisor_signal") return "supervisor_signal";
    if (result.code === 0) return "completed_successfully";
    if (result.code === DOCKER_CLIENT_ERROR_EXIT || result.code === null) {
      return "docker_client_abnormal_exit";
    }
    const absent = await this.#containerIsAbsent(spec).catch(() => null);
    if (absent !== true) return "docker_client_abnormal_exit";
    return "container_command_failed_confirmed";
  }

  /** Reads container lifecycle state instead of inferring it from an exit code. */
  async #containerIsAbsent(spec: SandboxExecutionSpec): Promise<boolean> {
    const name = this.#containers.get(spec.sandboxId) ?? containerNameFor(spec.sandboxId);
    const listed = await runSupervised(
      this.#settings.dockerExecutable,
      ["ps", "--all", "--quiet", "--filter", `name=^${name}$`],
      CLEANUP_TIMEOUT_MS,
      4_096,
    );
    if (listed.code !== 0) {
      throw new ApplicationError(
        "DEPENDENCY_FAILURE",
        "Container lifecycle state could not be read.",
        { details: { sandboxId: spec.sandboxId, container: name } },
      );
    }
    return listed.stdout.trim().length === 0;
  }

  async cancel(spec: SandboxExecutionSpec, _context: OperationContext): Promise<void> {
    await this.#removeContainer(spec);
  }

  async destroy(spec: SandboxExecutionSpec, _context: OperationContext): Promise<void> {
    await this.#removeContainer(spec);
    this.#containers.delete(spec.sandboxId);
    this.#specs.delete(spec.sandboxId);
  }

  /**
   * Proof challenger: observes the live daemon-side container through the same Layer 8 process
   * authority as every other Docker client call, then validates effective state rather than argv.
   */
  async inspectActiveSandbox(
    sandboxId: string,
    context: OperationContext,
  ): Promise<DockerInspectObservation> {
    const spec = this.#specFor(sandboxId);
    const observation = await this.#inspectContainer(spec, context);
    return assertDockerRuntimeObservation(observation, {
      ...identityFor(spec),
      workspaceRoot: spec.workspaceRoot,
    });
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
    let observation: DockerInspectObservation;
    try {
      observation = await this.#inspectContainer(spec);
    } catch (error) {
      // `docker inspect` exits non-zero for an already-removed `--rm` container as well as for
      // daemon failures. Only an independent name query may distinguish proven absence.
      if (await this.#containerIsAbsent(spec)) return;
      throw error;
    }
    assertDockerContainerOwnership(observation, identityFor(spec));
    const removed = await runSupervised(
      this.#settings.dockerExecutable,
      ["rm", "--force", observation.containerId],
      CLEANUP_TIMEOUT_MS,
      4_096,
    );
    if (removed.code !== 0 || removed.termination !== "exited") {
      throw new ApplicationError("DEPENDENCY_FAILURE", "Sandbox container removal failed.", {
        details: { sandboxId: spec.sandboxId, container: name, stderr: removed.stderr },
      });
    }
    const listed = await runSupervised(
      this.#settings.dockerExecutable,
      ["ps", "--all", "--quiet", "--filter", `id=${observation.containerId}`],
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

  async #inspectContainer(
    spec: SandboxExecutionSpec,
    context?: OperationContext,
  ): Promise<DockerInspectObservation> {
    const name = this.#containers.get(spec.sandboxId) ?? containerNameFor(spec.sandboxId);
    const inspected = await runSupervised(
      this.#settings.dockerExecutable,
      ["inspect", "--format", "{{json .}}", name],
      CLEANUP_TIMEOUT_MS,
      64 * 1024,
      context?.signal,
    );
    if (inspected.code !== 0 || inspected.termination !== "exited") {
      throw new ApplicationError(
        "DEPENDENCY_FAILURE",
        "Docker container ownership could not be inspected before cleanup.",
        { details: { sandboxId: spec.sandboxId, container: name, stderr: inspected.stderr } },
      );
    }
    const observation = parseDockerInspectObservation(inspected.stdout);
    if (observation.name !== `/${name}`) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "Docker inspect returned a container whose name does not match the requested sandbox.",
        {
          details: {
            sandboxId: spec.sandboxId,
            expectedName: name,
            observedName: observation.name,
          },
        },
      );
    }
    return observation;
  }

  #specFor(sandboxId: string): SandboxExecutionSpec {
    const spec = this.#specs.get(sandboxId);
    if (spec === undefined) {
      throw new ApplicationError("NOT_FOUND", "The Docker sandbox is not prepared.", {
        details: { sandboxId },
      });
    }
    return spec;
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

function identityFor(spec: SandboxExecutionSpec) {
  return {
    sandboxId: spec.sandboxId,
    taskId: spec.taskId,
    jobId: spec.jobId,
    workspaceId: spec.workspaceId,
  };
}
