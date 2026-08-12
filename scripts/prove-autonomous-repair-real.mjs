import { spawn } from "node:child_process";

const environment = {
  ...process.env,
  V31M4_RUN_REAL_REPAIR_PROOF: "1",
  V31M4_OLLAMA_ENDPOINT: process.env.V31M4_OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434",
};

const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "apps/runtime/tests/general-coding-production.test.ts",
    "-t",
    "failed real-model candidate",
  ],
  { cwd: process.cwd(), env: environment, stdio: "inherit", shell: false },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start autonomous repair proof: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.stderr.write(`Autonomous repair proof terminated by ${signal}.\n`);
  process.exitCode = code ?? 1;
});
