import { spawn } from "node:child_process";

const environment = {
  ...process.env,
  V31M4_STAGE4_REAL: "1",
  V31M4_OLLAMA_ENDPOINT: process.env.V31M4_OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434",
  V31M4_OLLAMA_MODEL: process.env.V31M4_OLLAMA_MODEL ?? "devstral-small-2:24b",
};

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "apps/runtime/tests/stage-4-real-local.test.ts"],
  { cwd: process.cwd(), env: environment, stdio: "inherit", shell: false },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start Stage 4 proof: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.stderr.write(`Stage 4 proof terminated by ${signal}.\n`);
  process.exitCode = code ?? 1;
});
