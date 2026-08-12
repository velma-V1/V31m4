import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "apps/runtime/tests/model-routing-real.test.ts"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      V31M4_RUN_REAL_MODEL_ROUTING: "1",
      V31M4_OLLAMA_ENDPOINT: process.env.V31M4_OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434",
      V31M4_ROUTING_MODELS: process.env.V31M4_ROUTING_MODELS ?? "qwen3:8b,qwen2.5-coder:14b",
    },
    stdio: "inherit",
    shell: false,
  },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start model routing proof: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.stderr.write(`Model routing proof terminated by ${signal}.\n`);
  process.exitCode = code ?? 1;
});
