import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_REASONING_KEYS } from "@v31m4/domain";
import { SupervisedAdapterProcess } from "@v31m4/infrastructure";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ADAPTER_ROOT = join(REPO_ROOT, "adapters/local-supervised");
const roots: string[] = [];
const servers: Server[] = [];

const budget = {
  maxWallClockMs: 30_000,
  maxModelInvocations: 1,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
};

const THINKING_MODEL = "qwen-thinker:14b";
const PLAIN_MODEL = "plain-coder:7b";

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "v31m4-agent-adapter-"));
  roots.push(root);
  return root;
}

async function fakeOllama(response: object): Promise<{
  readonly endpoint: string;
  readonly requests: Record<string, unknown>[];
}> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((request, reply) => {
    if (request.url === "/api/tags") {
      reply.writeHead(200, { "content-type": "application/json" });
      reply.end(
        JSON.stringify({
          models: [
            {
              name: THINKING_MODEL,
              details: { context_length: 40_960 },
              capabilities: ["completion", "tools", "thinking"],
            },
            {
              name: PLAIN_MODEL,
              details: { context_length: 32_768 },
              capabilities: ["completion", "tools"],
            },
          ],
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      reply.writeHead(200, { "content-type": "application/json" });
      reply.end(JSON.stringify(response));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fake Ollama did not bind");
  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

function envelope(turn: unknown, extra: Record<string, unknown> = {}, model = THINKING_MODEL) {
  return {
    model,
    response: JSON.stringify(turn),
    done: true,
    prompt_eval_count: 120,
    eval_count: 30,
    ...extra,
  };
}

function adapter(root: string, endpoint: string, environment: Record<string, string> = {}) {
  return new SupervisedAdapterProcess({
    id: "ollama-model",
    process: {
      command: process.execPath,
      args: [join(ADAPTER_ROOT, "model-adapter.mjs")],
      environment: {
        V31M4_STAGE4_ROOT: root,
        V31M4_OLLAMA_ENDPOINT: endpoint,
        V31M4_OLLAMA_MODEL: THINKING_MODEL,
        ...environment,
      },
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 500,
    },
    maxFrameBytes: 256 * 1024,
  });
}

function agentParams(overrides: Record<string, unknown> = {}) {
  return {
    invocationId: "invocation-agent-1",
    jobId: "job-agent-1",
    taskId: "task:agent",
    modelId: THINKING_MODEL,
    promptArtifactId: "artifact-agent-context",
    outputContractVersion: "1.0.0",
    allowedOperations: ["repo.search", "code.inspect"],
    reasoningPolicy: "disabled",
    contextBudget: { maxPromptBytes: 131_072, maxPromptTokens: 32_768 },
    resourceBudget: budget,
    ...overrides,
  };
}

async function stageContext(root: string, size = 64): Promise<void> {
  await mkdir(join(root, "model-inputs"), { recursive: true });
  await writeFile(join(root, "model-inputs/artifact-agent-context.txt"), "x".repeat(size), "utf8");
}

const toolCall = {
  kind: "tool_call",
  operation: "repo.search",
  parameters: { query: "authorizeSemanticExecution" },
};

describe("the local adapter speaks the structured agent protocol", () => {
  it("asks for one structured turn under an explicit token budget", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      const result = (await model.invoke("model.invoke_agent", agentParams(), {
        timeoutMs: 5_000,
      })) as Record<string, unknown>;
      expect(result).toMatchObject({
        invocationId: "invocation-agent-1",
        modelId: THINKING_MODEL,
        outputContractVersion: "1.0.0",
        turn: toolCall,
      });
      expect(result["usage"]).toMatchObject({ inputTokens: 120, outputTokens: 30 });
      const request = ollama.requests[0] as Record<string, unknown>;
      expect(request).toMatchObject({
        model: THINKING_MODEL,
        stream: false,
        think: false,
        options: { temperature: 0, num_ctx: 32_768 },
      });
      expect((request["format"] as Record<string, unknown>)["type"]).toBe("object");
      expect(JSON.stringify(request["format"])).toMatch(/tool_call.*finish.*defer/u);
    } finally {
      await model.stop();
    }
  });

  it("translates the provider-neutral reasoning policy inside the adapter", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      await model.invoke("model.invoke_agent", agentParams({ reasoningPolicy: "enabled" }), {
        timeoutMs: 5_000,
      });
      expect(ollama.requests[0]).toMatchObject({ think: true });
      await model.invoke(
        "model.invoke_agent",
        agentParams({ invocationId: "invocation-agent-2", reasoningPolicy: "auto" }),
        { timeoutMs: 5_000 },
      );
      // `auto` means the runtime declines to decide, so no provider flag is sent at all rather
      // than a guess about what this provider's default means.
      expect(Object.keys(ollama.requests[1] ?? {})).not.toContain("think");
    } finally {
      await model.stop();
    }
  });

  it("refuses to claim reasoning on a model that does not report the capability", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall, {}, PLAIN_MODEL));
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      await expect(
        model.invoke(
          "model.invoke_agent",
          agentParams({ modelId: PLAIN_MODEL, reasoningPolicy: "enabled" }),
          { timeoutMs: 5_000 },
        ),
      ).rejects.toThrow(/reasoning/i);
      expect(ollama.requests).toHaveLength(0);
    } finally {
      await model.stop();
    }
  });

  it("never returns or persists a reasoning trace the provider volunteers", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(
      envelope(toolCall, { thinking: "SECRETCHAIN step one then step two" }),
    );
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      const result = await model.invoke("model.invoke_agent", agentParams(), {
        timeoutMs: 5_000,
      });
      expect(JSON.stringify(result)).not.toMatch(/SECRETCHAIN/u);
      const outputs = join(root, "model-outputs");
      for (const file of await readdir(outputs)) {
        expect(await readFile(join(outputs, file), "utf8")).not.toMatch(/SECRETCHAIN/u);
      }
    } finally {
      await model.stop();
    }
  });

  it("refuses a turn that smuggles reasoning into its own fields", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(
      envelope({ kind: "finish", summary: "done", thinking: "step one" }),
    );
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      await expect(
        model.invoke("model.invoke_agent", agentParams(), { timeoutMs: 5_000 }),
      ).rejects.toThrow(/reasoning|malformed/i);
    } finally {
      await model.stop();
    }
  });

  it("refuses a malformed, mixed, or out-of-manifest turn", async () => {
    for (const turn of [
      { kind: "tool_call", operation: "repo.search" },
      { kind: "tool_call", operation: "repo.search", parameters: {}, summary: "done" },
      { kind: "finish" },
      { kind: "escalate", reason: "help" },
      { kind: "tool_call", operation: "command.run", parameters: { executable: "sh" } },
    ]) {
      const root = await temporaryRoot();
      const ollama = await fakeOllama(envelope(turn));
      await stageContext(root);
      const model = adapter(root, ollama.endpoint);
      try {
        await expect(
          model.invoke("model.invoke_agent", agentParams(), { timeoutMs: 5_000 }),
        ).rejects.toThrow();
      } finally {
        await model.stop();
      }
    }
  });

  it("rejects an output contract the runtime did not ask for", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root);
    const model = adapter(root, ollama.endpoint);
    try {
      await expect(
        model.invoke("model.invoke_agent", agentParams({ outputContractVersion: "1.1.0" }), {
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/output contract/i);
      expect(ollama.requests).toHaveLength(0);
    } finally {
      await model.stop();
    }
  });
});

describe("the fixed 64 KiB autonomy ceiling is gone, and oversize still fails closed", () => {
  it("carries a context far larger than the legacy ceiling", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root, 200 * 1024);
    const model = adapter(root, ollama.endpoint, {
      V31M4_AGENT_MAX_PROMPT_BYTES: String(256 * 1024),
    });
    try {
      await model.invoke(
        "model.invoke_agent",
        agentParams({ contextBudget: { maxPromptBytes: 256 * 1024, maxPromptTokens: 32_768 } }),
        { timeoutMs: 10_000 },
      );
      expect(ollama.requests).toHaveLength(1);
      expect(
        String((ollama.requests[0] as Record<string, unknown>)["prompt"]).length,
      ).toBeGreaterThan(200 * 1024);
    } finally {
      await model.stop();
    }
  });

  it("fails rather than truncating when the configured hard ceiling is exceeded", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root, 200 * 1024);
    const model = adapter(root, ollama.endpoint, {
      V31M4_AGENT_MAX_PROMPT_BYTES: String(128 * 1024),
    });
    try {
      await expect(
        model.invoke("model.invoke_agent", agentParams(), { timeoutMs: 10_000 }),
      ).rejects.toThrow(/oversiz|exceed/i);
      expect(ollama.requests).toHaveLength(0);
    } finally {
      await model.stop();
    }
  });

  it("also fails when the caller's own context budget is the tighter bound", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama(envelope(toolCall));
    await stageContext(root, 100 * 1024);
    const model = adapter(root, ollama.endpoint, {
      V31M4_AGENT_MAX_PROMPT_BYTES: String(256 * 1024),
    });
    try {
      await expect(
        model.invoke(
          "model.invoke_agent",
          agentParams({ contextBudget: { maxPromptBytes: 8_192, maxPromptTokens: 32_768 } }),
          { timeoutMs: 10_000 },
        ),
      ).rejects.toThrow(/oversiz|exceed/i);
      expect(ollama.requests).toHaveLength(0);
    } finally {
      await model.stop();
    }
  });
});

describe("the legacy verified invocation path is preserved", () => {
  it("still answers model.invoke with think disabled and the legacy 64 KiB ceiling", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama({
      model: THINKING_MODEL,
      response: JSON.stringify({ content: "export const legacy = true;\n" }),
      done: true,
    });
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(join(root, "model-inputs/artifact-legacy.txt"), "Implement legacy.", "utf8");
    await writeFile(
      join(root, "model-inputs/artifact-legacy-big.txt"),
      "x".repeat(65 * 1024),
      "utf8",
    );
    const model = adapter(root, ollama.endpoint, {
      V31M4_AGENT_MAX_PROMPT_BYTES: String(256 * 1024),
    });
    const legacy = (promptArtifactId: string, invocationId: string) => ({
      invocationId,
      jobId: "job-legacy-1",
      modelId: THINKING_MODEL,
      promptArtifactId,
      configuration: {
        modelId: THINKING_MODEL,
        strategy: "direct",
        contextArtifactIds: [],
        toolIds: [],
        constraints: [],
      },
      resourceBudget: budget,
    });
    try {
      const result = (await model.invoke(
        "model.invoke",
        legacy("artifact-legacy", "invocation-legacy-1"),
        { timeoutMs: 5_000 },
      )) as Record<string, unknown>;
      expect(result).toMatchObject({ finishReason: "completed", modelId: THINKING_MODEL });
      expect(ollama.requests[0]).toMatchObject({ think: false });
      expect(await readFile(join(root, "model-outputs/invocation-legacy-1.txt"), "utf8")).toBe(
        "export const legacy = true;\n",
      );
      // Raising the agent ceiling must not raise the legacy one.
      await expect(
        model.invoke("model.invoke", legacy("artifact-legacy-big", "invocation-legacy-2"), {
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/oversiz/i);
    } finally {
      await model.stop();
    }
  });
});

describe("the adapter's own reasoning guard cannot drift from the domain rule", () => {
  it("refuses exactly the property names the domain freezes", async () => {
    const protocol = (await import(join(ADAPTER_ROOT, "agent-turn-protocol.mjs"))) as {
      readonly PRIVATE_REASONING_KEYS: readonly string[];
      readonly AGENT_TURN_CONTRACT_VERSION: string;
    };
    expect([...protocol.PRIVATE_REASONING_KEYS].sort()).toEqual([...PRIVATE_REASONING_KEYS].sort());
    expect(protocol.AGENT_TURN_CONTRACT_VERSION).toBe("1.0.0");
  });
});
