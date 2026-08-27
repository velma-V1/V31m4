import { spawn } from "node:child_process";

// V31M4-AUTONOMY-001 / 1.1.0 Task 4 target-host proof.
//
// Runs the whole real path on this machine: the governed agent-turn loop, the real supervised
// model gateway, the real supervised adapter child process, the real Ollama service, and a real
// local model. Nothing is simulated and nothing is faked: if Ollama is unreachable or the
// requested model is not installed, this reports BLOCKED_ENVIRONMENT and exits non-zero rather
// than producing a proof that did not happen.
//
//   V31M4_AGENT_MODEL           model to prove against (default: qwen3.8:27b)
//   V31M4_OLLAMA_ENDPOINT       default http://127.0.0.1:11434
//   V31M4_AGENT_CONTEXT_TOKENS  practical context target (default 32768)

function environment(key, fallback) {
  const value = process.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const endpoint = environment("V31M4_OLLAMA_ENDPOINT", "http://127.0.0.1:11434");
const model = environment("V31M4_AGENT_MODEL", "qwen3.8:27b");
const contextTokens = environment("V31M4_AGENT_CONTEXT_TOKENS", "32768");

function blocked(reason) {
  process.stdout.write(
    `[agent-turn-proof] TASK4_TARGET_HOST_PROOF=BLOCKED_ENVIRONMENT\n` +
      `[agent-turn-proof] reason: ${reason}\n` +
      `[agent-turn-proof] endpoint: ${endpoint}\n` +
      `[agent-turn-proof] requested model: ${model}\n`,
  );
  process.exitCode = 2;
}

async function installedModels() {
  const response = await fetch(new URL("/api/tags", endpoint), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Ollama discovery returned HTTP ${response.status}`);
  const parsed = await response.json();
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.models)) {
    throw new Error("Ollama discovery response is malformed");
  }
  return parsed.models.map((entry) => ({
    name: String(entry?.name ?? ""),
    capabilities: Array.isArray(entry?.capabilities) ? entry.capabilities : [],
    contextLength: entry?.details?.context_length ?? null,
    quantization: entry?.details?.quantization_level ?? null,
  }));
}

let installed;
try {
  installed = await installedModels();
} catch (error) {
  blocked(`the Ollama service is not reachable: ${error.message}`);
  process.exit();
}

const entry = installed.find((candidate) => candidate.name === model);
process.stdout.write(
  `[agent-turn-proof] endpoint: ${endpoint}\n` +
    `[agent-turn-proof] installed models: ${installed.map((candidate) => candidate.name).join(", ") || "(none)"}\n` +
    `[agent-turn-proof] requested model: ${model}\n`,
);
if (entry === undefined) {
  blocked(`the requested model ${model} is not installed on this host`);
  process.exit();
}
process.stdout.write(
  `[agent-turn-proof] model capabilities: ${entry.capabilities.join(", ") || "(none reported)"}\n` +
    `[agent-turn-proof] model quantization: ${entry.quantization ?? "(unreported)"}\n` +
    `[agent-turn-proof] model context length: ${entry.contextLength ?? "(unreported)"}\n` +
    `[agent-turn-proof] practical context target: ${contextTokens} tokens\n`,
);
if (entry.contextLength !== null && Number(entry.contextLength) < Number(contextTokens)) {
  blocked(
    `the model reports a ${entry.contextLength} token context, below the requested ${contextTokens}`,
  );
  process.exit();
}

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "apps/runtime/tests/autonomy/agent-turn-real.target-host.test.ts"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      V31M4_RUN_REAL_AGENT_TURN: "1",
      V31M4_OLLAMA_ENDPOINT: endpoint,
      V31M4_AGENT_MODEL: model,
      V31M4_AGENT_CONTEXT_TOKENS: contextTokens,
    },
    stdio: "inherit",
    shell: false,
  },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start the agent turn proof: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.stderr.write(`Agent turn proof terminated by ${signal}.\n`);
  process.exitCode = code ?? 1;
});
