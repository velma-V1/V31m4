import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";

export interface SupervisedProcessOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly stderrLimitBytes?: number;
  readonly shutdownTimeoutMs?: number;
}

export class ProcessSupervisor {
  #child: ChildProcessWithoutNullStreams | undefined;
  readonly #options: SupervisedProcessOptions;
  #stderrBytes = 0;

  constructor(options: SupervisedProcessOptions) {
    this.#options = options;
  }

  get process(): ChildProcessWithoutNullStreams | undefined {
    return this.#child;
  }

  async start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child) throw new Error("Process is already running");
    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], {
      cwd: this.#options.cwd,
      env: this.#options.environment
        ? { ...process.env, ...this.#options.environment }
        : process.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes += chunk.length;
      if (this.#stderrBytes > (this.#options.stderrLimitBytes ?? 1024 * 1024))
        void this.stop("SIGKILL");
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
