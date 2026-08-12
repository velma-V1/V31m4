import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { requireCanonicalId, requirePlainObject, runRpcHost } from "./rpc-host.mjs";

const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const root = resolve(requiredEnvironment("V31M4_STAGE4_ROOT"));
const endpoint = parseEndpoint(requiredEnvironment("V31M4_OLLAMA_ENDPOINT"));
const model = requiredEnvironment("V31M4_OLLAMA_MODEL");
const inputs = join(root, "model-inputs");
const outputs = join(root, "model-outputs");
const active = new Map();
await Promise.all([mkdir(inputs, { recursive: true }), mkdir(outputs, { recursive: true })]);

runRpcHost({
  "adapter.health": async () => ({ status: "healthy", model, endpoint: endpoint.origin }),
  "adapter.cancel": async (params) => {
    const invocationId = requireCanonicalId(params.invocationId, "invocationId");
    active.get(invocationId)?.abort();
    return null;
  },
  "model.list": discoverModels,
  "model.invoke": invokeModel,
});

async function discoverModels() {
  const installed = await discoverInstalledModels();
  return {
    models: installed.map((entry) => ({
      modelId: entry.modelId,
      adapterId: "ollama-local-supervised",
      displayName: entry.modelId,
      status: "available",
      local: true,
      ...(entry.contextLimit === undefined ? {} : { contextLimit: entry.contextLimit }),
      measuredCapabilities: [],
      supportedModalities: entry.modalities,
    })),
  };
}

async function invokeModel(raw) {
  const params = requirePlainObject(raw, "model.invoke params");
  const invocationId = requireCanonicalId(params.invocationId, "invocationId");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const modelId = requireCanonicalId(params.modelId, "modelId");
  const promptArtifactId = requireCanonicalId(params.promptArtifactId, "promptArtifactId");
  const installed = await discoverInstalledModels();
  if (!installed.some((entry) => entry.modelId === modelId)) {
    throw new Error("Requested model is not installed.");
  }
  const cached = await readCached(invocationId);
  if (cached !== null) return cached;

  const promptPath = contained(inputs, `${promptArtifactId}.txt`);
  const promptStat = await lstat(promptPath);
  if (!promptStat.isFile() || promptStat.isSymbolicLink() || promptStat.size > MAX_PROMPT_BYTES) {
    throw new Error("Prompt materialization is invalid or oversized.");
  }
  const prompt = await readFile(promptPath, "utf8");
  const softwareProduction = prompt.includes("V31M4_SOFTWARE_PRODUCTION_MANIFEST_V1");
  const controller = new AbortController();
  active.set(invocationId, controller);
  const started = performance.now();
  try {
    const response = await fetch(new URL("/api/generate", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        think: false,
        prompt: modelInstructions(prompt),
        format: responseSchema(softwareProduction),
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw retryable(`Ollama returned HTTP ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) throw new Error("Ollama response exceeds limit.");
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
      throw new Error("Ollama response exceeds limit.");
    const envelope = JSON.parse(text);
    if (
      envelope?.done !== true ||
      envelope?.model !== modelId ||
      typeof envelope?.response !== "string"
    ) {
      throw new Error("Ollama response envelope is malformed.");
    }
    const output = parseStructuredOutput(JSON.parse(envelope.response), softwareProduction);
    const outputPath = contained(outputs, `${invocationId}.txt`);
    await atomicWrite(outputPath, output);
    const artifactId = `artifact-model-${digest(invocationId).slice(0, 32)}`;
    const result = {
      invocationId,
      modelId,
      responseArtifactId: artifactId,
      outputArtifactIds: [artifactId],
      finishReason: "completed",
      usage: {
        inputTokens: optionalCount(envelope.prompt_eval_count),
        outputTokens: optionalCount(envelope.eval_count),
        wallClockMs: Math.max(1, Math.round(performance.now() - started)),
      },
      metadata: {
        adapterId: "ollama-local-supervised",
        realInference: true,
        model: modelId,
        outputFile: `${invocationId}.txt`,
        jobId,
      },
    };
    await atomicWrite(contained(outputs, `${invocationId}.json`), JSON.stringify(result));
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw retryable("Ollama invocation was cancelled.");
    if (error instanceof SyntaxError)
      throw new Error("Ollama response is not valid structured JSON.");
    throw error;
  } finally {
    active.delete(invocationId);
  }
}

async function discoverInstalledModels() {
  const response = await fetch(new URL("/api/tags", endpoint), { method: "GET" });
  if (!response.ok) throw retryable(`Ollama discovery returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Ollama discovery response exceeds limit.");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error("Ollama discovery response exceeds limit.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("Ollama discovery response is malformed.", { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.models)) {
    throw new Error("Ollama discovery response is malformed.");
  }
  const installed = parsed.models.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== "object" || typeof candidate.name !== "string") {
      throw new Error("Ollama discovery response is malformed.");
    }
    const modelId = canonicalModelId(candidate.name);
    if (modelId === null) return [];
    const contextLimit = candidate.details?.context_length;
    if (contextLimit !== undefined && (!Number.isSafeInteger(contextLimit) || contextLimit <= 0)) {
      throw new Error("Ollama discovery response is malformed.");
    }
    if (
      candidate.capabilities !== undefined &&
      (!Array.isArray(candidate.capabilities) ||
        !candidate.capabilities.every((capability) => typeof capability === "string"))
    ) {
      throw new Error("Ollama discovery response is malformed.");
    }
    const capabilities = candidate.capabilities ?? [];
    return [
      {
        modelId,
        ...(contextLimit === undefined ? {} : { contextLimit }),
        modalities: Object.freeze(["text", ...(capabilities.includes("vision") ? ["vision"] : [])]),
      },
    ];
  });
  if (
    installed.length > 500 ||
    new Set(installed.map((entry) => entry.modelId)).size !== installed.length
  ) {
    throw new Error("Ollama discovery response is malformed.");
  }
  return installed;
}

function canonicalModelId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    return null;
  }
  return value;
}

function modelInstructions(prompt) {
  const outputInstruction = prompt.includes("V31M4_SOFTWARE_PRODUCTION_MANIFEST_V1")
    ? "The content must be the requested JSON change manifest with no Markdown fences."
    : "The content must be a complete JavaScript ES module with no Markdown fences.";
  return ["Return only JSON matching the supplied schema.", outputInstruction, prompt].join("\n\n");
}

function responseSchema(softwareProduction) {
  if (!softwareProduction) {
    return {
      type: "object",
      required: ["content"],
      properties: { content: { type: "string" } },
    };
  }
  return {
    type: "object",
    required: ["changes"],
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "operation"],
          properties: {
            path: { type: "string" },
            operation: { type: "string", enum: ["create", "update", "delete"] },
            content: { type: "string" },
          },
        },
      },
    },
  };
}

function parseStructuredOutput(structured, softwareProduction) {
  if (softwareProduction) {
    const output = JSON.stringify(structured);
    if (
      structured === null ||
      typeof structured !== "object" ||
      Array.isArray(structured) ||
      Object.keys(structured).length !== 1 ||
      !Array.isArray(structured.changes) ||
      structured.changes.length === 0 ||
      Buffer.byteLength(output) > MAX_OUTPUT_BYTES ||
      output.includes("\0")
    ) {
      throw new Error("Ollama change manifest is malformed.");
    }
    return output;
  }
  if (
    structured === null ||
    typeof structured !== "object" ||
    Array.isArray(structured) ||
    Object.keys(structured).length !== 1 ||
    typeof structured.content !== "string" ||
    structured.content.trim().length === 0 ||
    Buffer.byteLength(structured.content) > MAX_OUTPUT_BYTES ||
    structured.content.includes("```") ||
    structured.content.includes("\0")
  ) {
    throw new Error("Ollama structured output is malformed.");
  }
  return structured.content;
}

async function readCached(invocationId) {
  try {
    return JSON.parse(await readFile(contained(outputs, `${invocationId}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requiredEnvironment(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}

function parseEndpoint(value) {
  const parsed = new URL(value);
  const host = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
  if (parsed.protocol !== "http:" || !new Set(["127.0.0.1", "::1", "localhost"]).has(host)) {
    throw new Error("Ollama endpoint must be loopback HTTP.");
  }
  return parsed;
}

function contained(parent, name) {
  requireCanonicalId(name.replace(/\.(?:txt|json)$/u, ""), "staged file identity");
  const target = resolve(parent, name);
  if (!target.startsWith(resolve(parent) + sep)) throw new Error("Staged path escapes its root.");
  return target;
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function optionalCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function retryable(message) {
  const error = new Error(message);
  error.retryable = true;
  return error;
}
