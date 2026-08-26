import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";

/**
 * Why a supervised process stopped, when the supervisor itself ended it. `undefined` means the
 * process exited on its own. Callers that must reconcile external side effects need to tell an
 * ordinary non-zero exit apart from a supervisor kill, because the latter proves nothing about
 * work the process had already started elsewhere.
 */
export type ProcessTerminationReason = "output_limit" | "requested";

export interface SupervisedProcessOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly inheritEnvironment?: readonly string[];
  readonly stderrLimitBytes?: number;
  readonly shutdownTimeoutMs?: number;
}

export class ProcessSupervisor {
  #child: ChildProcessWithoutNullStreams | undefined;
  readonly #options: SupervisedProcessOptions;
  #stderrBytes = 0;
  #terminationReason: ProcessTerminationReason | undefined;

  constructor(options: SupervisedProcessOptions) {
    this.#options = options;
  }

  get process(): ChildProcessWithoutNullStreams | undefined {
    return this.#child;
  }

  /** Set only when this supervisor ended the process; `undefined` after a self-directed exit. */
  get terminationReason(): ProcessTerminationReason | undefined {
    return this.#terminationReason;
  }

  async start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child) throw new Error("Process is already running");
    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], {
      cwd: this.#options.cwd,
      env: buildEnvironment(this.#options.inheritEnvironment, this.#options.environment),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    this.#terminationReason = undefined;
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes += chunk.length;
      if (this.#stderrBytes > (this.#options.stderrLimitBytes ?? 1024 * 1024)) {
        this.#terminationReason ??= "output_limit";
        void this.stop("SIGKILL");
      }
    });
    child.once("exit", () => {
      if (this.#child === child) this.#child = undefined;
    });
    try {
      await Promise.race([
        once(child, "spawn"),
        once(child, "error").then(([error]) => Promise.reject(error)),
      ]);
    } catch (error) {
      if (this.#child === child) this.#child = undefined;
      throw error;
    }
    return child;
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const child = this.#child;
    if (!child) return;
    this.#terminationReason ??= "requested";
    const exited = once(child, "exit").then(() => undefined);
    if (process.platform === "win32") child.kill(signal);
    else if (child.pid) process.kill(-child.pid, signal);
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, this.#options.shutdownTimeoutMs ?? 2_000)),
    ]);
    if (this.#child) {
      if (process.platform === "win32") child.kill("SIGKILL");
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
      await exited;
    }
  }
}

const DEFAULT_INHERITED_ENVIRONMENT = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
]);

function buildEnvironment(
  inherited: readonly string[] | undefined,
  explicit: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inherited ?? DEFAULT_INHERITED_ENVIRONMENT) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(explicit ?? {})) environment[key] = value;
  return environment;
}
