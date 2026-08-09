import { spawn } from "node:child_process";
import { ApplicationError, type OperationContext } from "@v31m4/application";

const STDERR_TAIL_BYTES = 4096;

export interface RunExternalProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly context: OperationContext;
  /** Message used for the ApplicationError when the process exits non-zero or fails to start. */
  readonly toolLabel: string;
}

/**
 * Runs an external CLI tool to completion as an argument-array child process (no shell), honoring
 * `context.signal` cancellation and a hard timeout. Shared by real production adapters that shell
 * out to a supervised one-shot tool (e.g. ffmpeg) so cancellation/timeout/failure handling is not
 * duplicated per adapter.
 */
export function runExternalProcess(options: RunExternalProcessOptions): Promise<void> {
  const { command, args, timeoutMs, context, toolLabel } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    let settled = false;

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill("SIGKILL");
        reject(
          new ApplicationError("DEPENDENCY_FAILURE", `${toolLabel} timed out.`, {
            details: { timeoutMs },
          }),
        );
      });
    }, timeoutMs);

    const onAbort = (): void => {
      settle(() => {
        child.kill("SIGKILL");
        reject(new ApplicationError("CANCELLED", `${toolLabel} invocation was cancelled.`));
      });
    };

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", onAbort);
      action();
    }

    context.signal.addEventListener("abort", onAbort, { once: true });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });

    child.on("error", (error) => {
      settle(() => {
        reject(
          new ApplicationError("DEPENDENCY_FAILURE", `${toolLabel} failed to start.`, {
            details: { message: error.message },
          }),
        );
      });
    });

    child.on("close", (code) => {
      settle(() => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new ApplicationError(
              "DEPENDENCY_FAILURE",
              `${toolLabel} exited with a non-zero status.`,
              {
                details: { exitCode: code ?? -1, stderrTail },
              },
            ),
          );
        }
      });
    });
  });
}
