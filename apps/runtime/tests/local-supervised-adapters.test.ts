import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SupervisedAdapterProcess } from "@v31m4/infrastructure";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ADAPTER_ROOT = join(REPO_ROOT, "adapters/local-supervised");
const roots: string[] = [];
const servers: Server[] = [];

const budget = {
  maxWallClockMs: 10_000,
  maxModelInvocations: 1,
  maxToolInvocations: 1,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
};

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "v31m4-stage4-adapters-"));
  roots.push(root);
  return root;
}

async function fakeOllama(
  response: object = {
    model: "devstral-small-2:24b",
    response: JSON.stringify({ content: "export function add(a, b) { return a + b; }\n" }),
    done: true,
    prompt_eval_count: 12,
    eval_count: 14,
    total_duration: 25_000_000,
  },
): Promise<{ readonly endpoint: string; readonly requests: object[] }> {
  const requests: object[] = [];
  const server = createServer((request, reply) => {
    if (request.url === "/api/tags") {
      reply.writeHead(200, { "content-type": "application/json" });
      reply.end(
        JSON.stringify({
          models: [
            { name: "provider/name-that-cannot-be-a-durable-id:7b" },
            { name: "devstral-small-2:24b" },
            {
              name: "qwen-coder:7b",
              details: { context_length: 32768 },
              capabilities: ["completion", "vision", "tools"],
            },
          ],
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as object);
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

function adapter(
  id: string,
  script: string,
  environment: Readonly<Record<string, string>>,
): SupervisedAdapterProcess {
  return new SupervisedAdapterProcess({
    id,
    process: {
      command: process.execPath,
      args: [join(ADAPTER_ROOT, script)],
      environment,
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 500,
    },
    maxFrameBytes: 256 * 1024,
  });
}

describe("local supervised adapter processes", () => {
  it("uses a configurable OpenAI-compatible transport without leaking its credential", async () => {
    const root = await temporaryRoot();
    const requests: { authorization?: string; body: Record<string, unknown> }[] = [];
    const server = createServer((request, reply) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          ...(typeof request.headers.authorization === "string"
            ? { authorization: request.headers.authorization }
            : {}),
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        });
        reply.writeHead(200, { "content-type": "application/json" });
        reply.end(
          JSON.stringify({
            model: "remote-code-v1",
            choices: [
              {
                finish_reason: "stop",
                message: { content: '{"content":"export const remote = true;\\n"}' },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 7 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Remote fixture failed");
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(join(root, "model-inputs/artifact-remote.txt"), "Implement remote.", "utf8");
    const remote = adapter("openai-compatible-supervised", "openai-compatible-model-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
      V31M4_REMOTE_ENDPOINT: `http://127.0.0.1:${address.port}`,
      V31M4_REMOTE_MODELS: "remote-code-v1",
      V31M4_REMOTE_API_KEY: "secret-loopback-key",
    });
    try {
      await expect(remote.invoke("model.list", {}, { timeoutMs: 2_000 })).resolves.toMatchObject({
        models: [{ modelId: "remote-code-v1", local: false }],
      });
      await remote.invoke(
        "model.invoke",
        {
          invocationId: "invocation-remote-1",
          jobId: "job-remote-1",
          modelId: "remote-code-v1",
          promptArtifactId: "artifact-remote",
          configuration: {
            modelId: "remote-code-v1",
            strategy: "direct",
            contextArtifactIds: [],
            toolIds: [],
            constraints: [],
          },
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      );
      expect(requests).toEqual([
        expect.objectContaining({
          authorization: "Bearer secret-loopback-key",
          body: expect.objectContaining({ model: "remote-code-v1" }),
        }),
      ]);
      expect(await readFile(join(root, "model-outputs/invocation-remote-1.txt"), "utf8")).toBe(
        "export const remote = true;\n",
      );
    } finally {
      await remote.stop();
    }
  });

  it("discovers installed models and invokes the exact requested installed model", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama({
      model: "qwen-coder:7b",
      response: JSON.stringify({ content: "export const selected = true;\n" }),
      done: true,
    });
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(join(root, "model-inputs/artifact-routing.txt"), "Implement selected.", "utf8");
    const model = adapter("ollama-model", "model-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
      V31M4_OLLAMA_ENDPOINT: ollama.endpoint,
      V31M4_OLLAMA_MODEL: "devstral-small-2:24b",
    });
    try {
      await expect(model.invoke("model.list", {}, { timeoutMs: 2_000 })).resolves.toMatchObject({
        models: [
          { modelId: "devstral-small-2:24b", local: true },
          {
            modelId: "qwen-coder:7b",
            local: true,
            contextLimit: 32768,
            supportedModalities: ["text", "vision"],
          },
        ],
      });
      await model.invoke(
        "model.invoke",
        {
          invocationId: "invocation-routing-1",
          jobId: "job-routing-1",
          modelId: "qwen-coder:7b",
          promptArtifactId: "artifact-routing",
          configuration: {
            modelId: "qwen-coder:7b",
            strategy: "direct",
            contextArtifactIds: [],
            toolIds: [],
            constraints: [],
          },
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      );
      expect(ollama.requests).toEqual([expect.objectContaining({ model: "qwen-coder:7b" })]);
    } finally {
      await model.stop();
    }
  });

  it("performs a real loopback model request and stages bounded candidate output", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama();
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(
      join(root, "model-inputs/artifact-prompt-1.txt"),
      "Implement add(a,b).",
      "utf8",
    );
    const model = adapter("ollama-model", "model-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
      V31M4_OLLAMA_ENDPOINT: ollama.endpoint,
      V31M4_OLLAMA_MODEL: "devstral-small-2:24b",
    });
    try {
      const result = (await model.invoke(
        "model.invoke",
        {
          invocationId: "invocation-real-1",
          jobId: "job-real-1",
          modelId: "devstral-small-2:24b",
          promptArtifactId: "artifact-prompt-1",
          configuration: {
            modelId: "devstral-small-2:24b",
            strategy: "direct",
            contextArtifactIds: [],
            toolIds: [],
            constraints: [],
          },
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      )) as Record<string, unknown>;
      expect(ollama.requests).toHaveLength(1);
      expect(ollama.requests[0]).toMatchObject({
        model: "devstral-small-2:24b",
        stream: false,
        think: false,
        format: {
          type: "object",
          required: ["content"],
          properties: { content: { type: "string" } },
        },
      });
      expect(JSON.stringify(ollama.requests[0])).not.toMatch(
        /additionalProperties|minLength|maxLength/u,
      );
      expect(result).toMatchObject({
        invocationId: "invocation-real-1",
        modelId: "devstral-small-2:24b",
        finishReason: "completed",
        metadata: { adapterId: "ollama-local-supervised", realInference: true },
      });
      expect(await readFile(join(root, "model-outputs/invocation-real-1.txt"), "utf8")).toBe(
        "export function add(a, b) { return a + b; }\n",
      );
    } finally {
      await model.stop();
    }
  });

  it("fails closed on a malformed Ollama response", async () => {
    const root = await temporaryRoot();
    const ollama = await fakeOllama({
      model: "devstral-small-2:24b",
      response: "not-json",
      done: true,
    });
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(join(root, "model-inputs/artifact-prompt-1.txt"), "Implement add.", "utf8");
    const model = adapter("ollama-model", "model-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
      V31M4_OLLAMA_ENDPOINT: ollama.endpoint,
      V31M4_OLLAMA_MODEL: "devstral-small-2:24b",
    });
    try {
      await expect(
        model.invoke(
          "model.invoke",
          {
            invocationId: "invocation-bad-1",
            jobId: "job-real-1",
            modelId: "devstral-small-2:24b",
            promptArtifactId: "artifact-prompt-1",
            configuration: {
              modelId: "devstral-small-2:24b",
              strategy: "direct",
              contextArtifactIds: [],
              toolIds: [],
              constraints: [],
            },
            resourceBudget: budget,
          },
          { timeoutMs: 2_000 },
        ),
      ).rejects.toThrow(/not valid structured JSON/i);
    } finally {
      await model.stop();
    }
  });

  it("uses a strict change-manifest response schema for software production", async () => {
    const root = await temporaryRoot();
    const manifest = {
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "hello world";\n',
        },
      ],
    };
    const ollama = await fakeOllama({
      model: "devstral-small-2:24b",
      response: JSON.stringify(manifest),
      done: true,
    });
    await mkdir(join(root, "model-inputs"), { recursive: true });
    await writeFile(
      join(root, "model-inputs/artifact-software-prompt.txt"),
      "V31M4_SOFTWARE_PRODUCTION_MANIFEST_V1\nUpdate src/greeting.mjs.",
      "utf8",
    );
    const model = adapter("ollama-model", "model-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
      V31M4_OLLAMA_ENDPOINT: ollama.endpoint,
      V31M4_OLLAMA_MODEL: "devstral-small-2:24b",
    });
    try {
      await model.invoke(
        "model.invoke",
        {
          invocationId: "invocation-software-1",
          jobId: "job-software-1",
          modelId: "devstral-small-2:24b",
          promptArtifactId: "artifact-software-prompt",
          configuration: {
            modelId: "devstral-small-2:24b",
            strategy: "direct",
            contextArtifactIds: [],
            toolIds: [],
            constraints: [],
          },
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      );
      expect(ollama.requests[0]).toMatchObject({
        format: { type: "object", required: ["changes"] },
      });
      expect(
        JSON.parse(await readFile(join(root, "model-outputs/invocation-software-1.txt"), "utf8")),
      ).toEqual(manifest);
    } finally {
      await model.stop();
    }
  });

  it("applies a checkpointed candidate once and verifies it with a real child command", async () => {
    const root = await temporaryRoot();
    const kernel = adapter("local-kernel", "kernel-adapter.mjs", { V31M4_STAGE4_ROOT: root });
    const verifier = adapter("local-verifier", "verifier-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
    });
    const startParams = {
      invocationId: "invocation-kernel-start",
      jobId: "job-real-1",
      projectId: "project-real-1",
      missionId: "mission-real-1",
      workflowId: "stage4.tiny-code",
      input: {},
      resourceBudget: budget,
    };
    try {
      await kernel.invoke("kernel.start_job", startParams, { timeoutMs: 2_000 });
      const failed = (await verifier.invoke(
        "tool.invoke",
        {
          invocationId: "invocation-verify-before",
          jobId: "job-real-1",
          toolId: "stage4-deterministic-verifier",
          operation: "verify_candidate",
          inputArtifactIds: [],
          parameters: { candidateId: "candidate-real-1" },
          expectedOutputs: ["verification_report"],
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      )) as Record<string, unknown>;
      expect(failed).toMatchObject({ status: "failed", exitCode: 1 });

      const workspace = join(root, "kernel-workspaces/job-real-1");
      await writeFile(
        join(workspace, "candidate.mjs"),
        "export function add(a, b) { return a + b; }\n",
        "utf8",
      );
      const checkpointId = await kernel.invoke(
        "kernel.checkpoint_job",
        { invocationId: "invocation-checkpoint", jobId: "job-real-1", stage: "candidate_ready" },
        { timeoutMs: 2_000 },
      );
      await kernel.invoke(
        "kernel.resume_job",
        { invocationId: "invocation-resume", jobId: "job-real-1", checkpointId },
        { timeoutMs: 2_000 },
      );
      await kernel.invoke(
        "kernel.resume_job",
        { invocationId: "invocation-resume-retry", jobId: "job-real-1", checkpointId },
        { timeoutMs: 2_000 },
      );
      await kernel.invoke(
        "kernel.stop_job",
        {
          invocationId: "invocation-stop-after-apply",
          jobId: "job-real-1",
          mode: "emergency_stop",
        },
        { timeoutMs: 2_000 },
      );
      await expect(
        kernel.invoke(
          "kernel.resume_job",
          { invocationId: "invocation-resume-after-stop", jobId: "job-real-1", checkpointId },
          { timeoutMs: 2_000 },
        ),
      ).rejects.toThrow(/emergency-stopped completed kernel effect/i);

      const passed = (await verifier.invoke(
        "tool.invoke",
        {
          invocationId: "invocation-verify-after",
          jobId: "job-real-1",
          toolId: "stage4-deterministic-verifier",
          operation: "verify_candidate",
          inputArtifactIds: [],
          parameters: { candidateId: "candidate-real-1" },
          expectedOutputs: ["verification_report"],
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      )) as Record<string, unknown>;
      expect(passed).toMatchObject({ status: "completed", exitCode: 0 });
      expect(
        JSON.parse(await readFile(join(workspace, "kernel-state.json"), "utf8")),
      ).toMatchObject({
        status: "cancelled",
        applyCount: 1,
        checkpointId,
      });
      expect(await readFile(join(workspace, "solution.mjs"), "utf8")).toContain("return a + b");
    } finally {
      await Promise.all([kernel.stop(), verifier.stop()]);
    }
  });

  it("rejects a stale or foreign kernel checkpoint without changing the workspace", async () => {
    const root = await temporaryRoot();
    const kernel = adapter("local-kernel", "kernel-adapter.mjs", { V31M4_STAGE4_ROOT: root });
    try {
      await kernel.invoke(
        "kernel.start_job",
        {
          invocationId: "invocation-start",
          jobId: "job-real-1",
          projectId: "project-real-1",
          missionId: "mission-real-1",
          workflowId: "stage4.tiny-code",
          input: {},
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      );
      await expect(
        kernel.invoke(
          "kernel.resume_job",
          {
            invocationId: "invocation-bad-resume",
            jobId: "job-real-1",
            checkpointId: "checkpoint-foreign",
          },
          { timeoutMs: 2_000 },
        ),
      ).rejects.toThrow(/checkpoint does not exist/i);
      expect(
        await readFile(join(root, "kernel-workspaces/job-real-1/solution.mjs"), "utf8"),
      ).toContain("not implemented");
    } finally {
      await kernel.stop();
    }
  });

  it("applies a bounded multi-file manifest and runs packet-declared verification", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "kernel-workspaces/job-general-1");
    await mkdir(join(workspace, ".v31m4"), { recursive: true });
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "test"), { recursive: true });
    await writeFile(join(workspace, "src/greeting.mjs"), 'export const greeting = "broken";\n');
    await writeFile(
      join(workspace, "test/greeting.test.mjs"),
      [
        'import { strict as assert } from "node:assert";',
        'import { greeting } from "../src/greeting.mjs";',
        'assert.equal(greeting, "hello world");',
      ].join("\n"),
    );
    await writeFile(
      join(workspace, ".v31m4/build-packet.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        projectId: "project-general-1",
        objective: "Repair greeting.",
        requiredOutputs: [{ path: "src/greeting.mjs", mediaType: "text/javascript" }],
        forbiddenChanges: ["README.md"],
        allowedPaths: ["src"],
        allowedOperations: ["read", "update"],
        commands: [
          {
            id: "test",
            executable: "node",
            args: ["test/greeting.test.mjs"],
            cwd: ".",
            timeoutMs: 10_000,
          },
        ],
        mandatoryCommandIds: ["test"],
        resourceBudget: {
          maxFiles: 20,
          maxFileBytes: 8_192,
          maxTotalBytes: 65_536,
          maxRepairRounds: 1,
        },
      }),
    );
    const kernel = adapter("general-kernel", "kernel-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
    });
    const verifier = adapter("general-verifier", "verifier-adapter.mjs", {
      V31M4_STAGE4_ROOT: root,
    });
    try {
      await kernel.invoke(
        "kernel.start_job",
        {
          invocationId: "invocation-general-start",
          jobId: "job-general-1",
          projectId: "project-general-1",
          missionId: "mission-general-1",
          workflowId: "software.production.v1",
          input: {},
          resourceBudget: budget,
        },
        { timeoutMs: 2_000 },
      );
      await writeFile(
        join(workspace, "candidate.json"),
        JSON.stringify({
          changes: [
            {
              path: "src/greeting.mjs",
              operation: "update",
              content: 'export const greeting = "hello world";\n',
            },
          ],
        }),
      );
      const checkpointId = await kernel.invoke(
        "kernel.checkpoint_job",
        {
          invocationId: "invocation-general-checkpoint",
          jobId: "job-general-1",
          stage: "candidate_staged",
        },
        { timeoutMs: 2_000 },
      );
      await kernel.invoke(
        "kernel.resume_job",
        { invocationId: "invocation-general-resume", jobId: "job-general-1", checkpointId },
        { timeoutMs: 2_000 },
      );
      const verified = (await verifier.invoke(
        "tool.invoke",
        {
          invocationId: "invocation-general-verify",
          jobId: "job-general-1",
          toolId: "stage4-deterministic-verifier",
          operation: "verify_candidate",
          inputArtifactIds: [],
          parameters: { candidateId: "candidate-general-1", checkId: "test" },
          expectedOutputs: ["verification_report"],
          resourceBudget: budget,
        },
        { timeoutMs: 12_000 },
      )) as Record<string, unknown>;
      expect(verified).toMatchObject({ status: "completed", exitCode: 0 });
      expect(await readFile(join(workspace, "src/greeting.mjs"), "utf8")).toContain("hello world");
      expect(
        JSON.parse(
          await readFile(join(root, "verifier-reports/invocation-general-verify.json"), "utf8"),
        ),
      ).toMatchObject({ checkId: "test", exitCode: 0 });
    } finally {
      await Promise.all([kernel.stop(), verifier.stop()]);
    }
  });
});
