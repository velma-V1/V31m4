import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOperationContext, routeModels } from "@v31m4/application";
import { ResourceBudget } from "@v31m4/domain";
import { SupervisedAdapterProcess, SupervisedModelGateway } from "@v31m4/infrastructure";
import { expect, it } from "vitest";

const enabled = process.env["V31M4_RUN_REAL_MODEL_ROUTING"] === "1";
const realTest = enabled ? it : it.skip;
const adapterRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/local-supervised",
);

realTest(
  "discovers, routes, and invokes two installed local models with exact provenance",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "v31m4-real-routing-"));
    const models = (process.env["V31M4_ROUTING_MODELS"] ?? "qwen3:8b,qwen2.5-coder:14b")
      .split(",")
      .map((model) => model.trim());
    expect(new Set(models).size).toBe(2);
    await mkdir(join(root, "model-inputs"), { recursive: true });
    const adapter = new SupervisedAdapterProcess({
      id: "ollama-local-supervised",
      process: {
        command: process.execPath,
        args: [join(adapterRoot, "model-adapter.mjs")],
        environment: {
          V31M4_STAGE4_ROOT: root,
          V31M4_OLLAMA_ENDPOINT: process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434",
          V31M4_OLLAMA_MODEL: models[0] ?? "qwen3:8b",
        },
        stderrLimitBytes: 64 * 1024,
        shutdownTimeoutMs: 1_000,
      },
      maxFrameBytes: 256 * 1024,
    });
    const gateway = new SupervisedModelGateway([], new Map(), 180_000, { primary: adapter });
    const context = createOperationContext({
      requestId: "real-routing-request",
      idempotencyKey: "real-routing-idempotency",
      actor: { id: "operator", kind: "user", roles: ["operator"] },
      startedAt: new Date().toISOString(),
    });
    const budget = ResourceBudget.create({
      maxWallClockMs: 180_000,
      maxModelInvocations: 2,
      maxToolInvocations: 0,
      maxRepairRounds: 0,
      maxConcurrentWorkers: 1,
    });
    try {
      const catalog = await gateway.list({ limit: 500 }, context);
      for (const modelId of models) {
        expect(catalog.items.some((profile) => profile.modelId === modelId)).toBe(true);
      }
      for (let index = 0; index < models.length; index += 1) {
        const modelId = models[index];
        if (modelId === undefined) throw new Error("Real routing model is missing.");
        const plan = routeModels({
          profiles: catalog.items.filter((profile) => models.includes(profile.modelId)),
          requiredModality: "text",
          minimumContextTokens: 1024,
          preferredModelId: modelId,
          maxInvocations: 1,
        });
        expect(plan.modelIds).toEqual([modelId]);
        const promptArtifactId = `artifact-real-routing-${index}`;
        await writeFile(
          join(root, "model-inputs", `${promptArtifactId}.txt`),
          "Return a JavaScript module exporting const routed = true.",
          "utf8",
        );
        const result = await gateway.invoke(
          {
            invocationId: `invocation-real-routing-${index}`,
            jobId: "job-real-routing" as never,
            modelId: modelId as never,
            promptArtifactId: promptArtifactId as never,
            configuration: {
              modelId: modelId as never,
              strategy: "direct",
              contextArtifactIds: [],
              toolIds: [],
              constraints: [],
            },
            resourceBudget: budget,
            metadata: {},
          },
          context,
        );
        expect(result).toMatchObject({
          modelId,
          finishReason: "completed",
          metadata: { realInference: true, model: modelId },
        });
        expect(
          await readFile(
            join(root, "model-outputs", `invocation-real-routing-${index}.txt`),
            "utf8",
          ),
        ).not.toMatch(/reference-response/u);
      }
    } finally {
      await adapter.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
  360_000,
);
