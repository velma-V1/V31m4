import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { requireCanonicalId, requirePlainObject, runRpcHost } from "./rpc-host.mjs";

const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const root = resolve(requiredEnvironment("V31M4_STAGE4_ROOT"));
const endpoint = parseEndpoint(requiredEnvironment("V31M4_REMOTE_ENDPOINT"));
const apiKey = requiredEnvironment("V31M4_REMOTE_API_KEY");
const models = parseModels(requiredEnvironment("V31M4_REMOTE_MODELS"));
const inputs = join(root, "model-inputs");
const outputs = join(root, "model-outputs");
const active = new Map();
await Promise.all([mkdir(inputs, { recursive: true }), mkdir(outputs, { recursive: true })]);

runRpcHost({
  "adapter.health": async () => ({ status: "healthy", endpoint: endpoint.origin }),
  "adapter.cancel": async (raw) => {
    const params = requirePlainObject(raw, "adapter.cancel params");
    active.get(requireCanonicalId(params.invocationId, "invocationId"))?.abort();
    return null;
  },
  "model.list": async () => ({
    models: models.map((modelId) => ({
      modelId,
      adapterId: "openai-compatible-supervised",
      displayName: modelId,
      status: "available",
      local: false,
      measuredCapabilities: [],
      supportedModalities: ["text"],
    })),
  }),
  "model.invoke": invokeModel,
});

async function invokeModel(raw) {
  const params = requirePlainObject(raw, "model.invoke params");
  const invocationId = requireCanonicalId(params.invocationId, "invocationId");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const modelId = requireCanonicalId(params.modelId, "modelId");
  const promptArtifactId = requireCanonicalId(params.promptArtifactId, "promptArtifactId");
  if (!models.includes(modelId)) throw new Error("Requested remote model is not configured.");
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
    const response = await fetch(new URL("/v1/chat/completions", endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              "Return only strict JSON. Do not include Markdown fences.",
              softwareProduction
                ? 'Return the requested change manifest as {"changes":[...]} .'
                : 'Return the complete module as {"content":"..."} .',
              prompt,
            ].join("\n\n"),
          },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw retryable(`Remote model returned HTTP ${response.status}.`);
    const text = await boundedText(response);
    const envelope = JSON.parse(text);
    const choice = envelope?.choices?.[0];
    if (
      envelope?.model !== modelId ||
      typeof choice?.message?.content !== "string" ||
      choice?.finish_reason !== "stop"
    ) {
      throw new Error("Remote model response envelope is malformed.");
    }
    const output = parseStructuredOutput(JSON.parse(choice.message.content), softwareProduction);
    await atomicWrite(contained(outputs, `${invocationId}.txt`), output);
    const artifactId = `artifact-model-${digest(invocationId).slice(0, 32)}`;
    const result = {
      invocationId,
      modelId,
      responseArtifactId: artifactId,
      outputArtifactIds: [artifactId],
      finishReason: "completed",
      usage: {
        inputTokens: optionalCount(envelope?.usage?.prompt_tokens),
        outputTokens: optionalCount(envelope?.usage?.completion_tokens),
        wallClockMs: Math.max(1, Math.round(performance.now() - started)),
      },
      metadata: {
        adapterId: "openai-compatible-supervised",
        remoteTransport: true,
        model: modelId,
        outputFile: `${invocationId}.txt`,
        jobId,
      },
    };
    await atomicWrite(contained(outputs, `${invocationId}.json`), JSON.stringify(result));
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw retryable("Remote model invocation was cancelled.");
    if (error instanceof SyntaxError) throw new Error("Remote model response is not valid JSON.");
    throw error;
  } finally {
    active.delete(invocationId);
  }
}

async function boundedText(response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Remote model response exceeds limit.");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error("Remote model response exceeds limit.");
  }
  return text;
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
      throw new Error("Remote change manifest is malformed.");
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
    throw new Error("Remote model structured output is malformed.");
  }
  return structured.content;
}

function parseModels(value) {
  const parsed = value.split(",").map((candidate) => requireCanonicalId(candidate.trim(), "model"));
  if (parsed.length === 0 || parsed.length > 100 || new Set(parsed).size !== parsed.length) {
    throw new Error("Remote model configuration is invalid.");
  }
  return Object.freeze(parsed);
}

function parseEndpoint(value) {
  const parsed = new URL(value);
  const host = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]).has(host);
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("Remote endpoint must be HTTPS or loopback HTTP origin.");
  }
  return parsed;
}

async function readCached(invocationId) {
  try {
    return JSON.parse(await readFile(contained(outputs, `${invocationId}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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

function requiredEnvironment(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}

function optionalCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function retryable(message) {
  const error = new Error(message);
  error.retryable = true;
  return error;
}
