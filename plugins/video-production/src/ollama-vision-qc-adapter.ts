import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationError, type OperationContext } from "@v31m4/application";
import type { GeneratedShot, QcFinding, QcReport, ShotSpec, VisionQcAdapter } from "./contracts.js";
import { runExternalProcess } from "./internal/run-external-process.js";

export interface OllamaVisionQcAdapterOptions {
  /** Directory containing real per-shot media files, named `<outputRef>.mp4`. */
  readonly shotsDir: string;
  /** Base URL of a running Ollama server, e.g. `http://localhost:11434`. */
  readonly ollamaBaseUrl?: string;
  /** A model already pulled in Ollama that reports vision capability. */
  readonly model?: string;
  readonly ffmpegPath?: string;
  readonly ffmpegTimeoutMs?: number;
  readonly inferenceTimeoutMs?: number;
}

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen3.5:9b";
const DEFAULT_FFMPEG_TIMEOUT_MS = 30_000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 120_000;

interface OllamaGenerateResponse {
  readonly response?: unknown;
}

function isQcFinding(value: unknown): value is QcFinding {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record["kind"] === "string" && typeof record["detail"] === "string";
}

function parseQcVerdict(raw: string): QcReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Vision-QC model response was not valid JSON.",
      { details: { message: error instanceof Error ? error.message : String(error), raw } },
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Vision-QC model response was not an object.",
      {
        details: { raw },
      },
    );
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["passed"] !== "boolean") {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Vision-QC model response was missing a boolean 'passed' field.",
      { details: { raw } },
    );
  }
  const rawFindings = record["findings"];
  if (rawFindings !== undefined && !Array.isArray(rawFindings)) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Vision-QC model response 'findings' was not an array.",
      { details: { raw } },
    );
  }
  const findings = Array.isArray(rawFindings) ? rawFindings : [];
  if (!findings.every(isQcFinding)) {
    throw new ApplicationError(
      "DEPENDENCY_FAILURE",
      "Vision-QC model response contained a malformed finding.",
      { details: { raw } },
    );
  }
  return Object.freeze({ passed: record["passed"], findings: Object.freeze(findings) });
}

/**
 * Production `VisionQcAdapter` backed by a real ffmpeg frame extraction and a real inference call
 * to a locally installed, vision-capable Ollama model. Fails closed: any missing shot file,
 * unreachable Ollama server, or unparseable/malformed model response is a `DEPENDENCY_FAILURE`
 * rather than a silent pass — this is a QC gate, so an inconclusive result must not be reported as
 * success. The model is asked for strict JSON (`format: "json"`) to make its verdict parseable, but
 * the parsed shape is still validated before being trusted.
 */
export class OllamaVisionQcAdapter implements VisionQcAdapter {
  readonly #shotsDir: string;
  readonly #ollamaBaseUrl: string;
  readonly #model: string;
  readonly #ffmpegPath: string;
  readonly #ffmpegTimeoutMs: number;
  readonly #inferenceTimeoutMs: number;

  constructor(options: OllamaVisionQcAdapterOptions) {
    this.#shotsDir = options.shotsDir;
    this.#ollamaBaseUrl = options.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.#ffmpegTimeoutMs = options.ffmpegTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS;
    this.#inferenceTimeoutMs = options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  }

  async inspect(shot: GeneratedShot, spec: ShotSpec, context: OperationContext): Promise<QcReport> {
    if (context.signal.aborted) {
      throw new ApplicationError("CANCELLED", "Vision QC was cancelled before it started.");
    }

    const mediaPath = join(this.#shotsDir, `${shot.outputRef}.mp4`);
    const exists = await stat(mediaPath).then(
      () => true,
      () => false,
    );
    if (!exists) {
      throw new ApplicationError("DEPENDENCY_FAILURE", "Shot media file is missing for QC.", {
        details: { shotId: shot.shotId, path: mediaPath },
      });
    }

    const framePath = join(tmpdir(), `v31m4-qc-frame-${randomUUID()}.png`);
    try {
      await runExternalProcess({
        command: this.#ffmpegPath,
        args: ["-y", "-i", mediaPath, "-frames:v", "1", "-f", "image2", framePath],
        timeoutMs: this.#ffmpegTimeoutMs,
        context,
        toolLabel: "ffmpeg (frame extraction)",
      });

      const frameBytes = await readFile(framePath);
      return await this.#judge(frameBytes, spec, context);
    } finally {
      await rm(framePath, { force: true });
    }
  }

  async #judge(
    frameBytes: Uint8Array,
    spec: ShotSpec,
    context: OperationContext,
  ): Promise<QcReport> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.#inferenceTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.#ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.#model,
          prompt:
            "You are a strict video-production QC reviewer. You are shown one frame from a " +
            `generated shot. The shot was requested with this prompt: "${spec.prompt}". Judge ` +
            "whether the frame plausibly matches the prompt and is free of obvious visual defects " +
            "(corruption, blank/solid-noise frame, wrong subject). Respond with ONLY a JSON object " +
            'of the exact shape {"passed": boolean, "findings": [{"kind": string, "detail": ' +
            'string}]}. "findings" must be [] when passed is true.',
          images: [Buffer.from(frameBytes).toString("base64")],
          format: "json",
          stream: false,
          // Reasoning ("thinking") models constrained to `format: "json"` can spend their entire
          // output budget on hidden reasoning tokens and never emit a final `response`, because the
          // JSON grammar constrains the reasoning phase too. Disabling thinking makes the model
          // answer directly, which is all this QC judgment needs.
          think: false,
        }),
      });
    } catch (error) {
      if (context.signal.aborted) {
        throw new ApplicationError("CANCELLED", "Vision QC was cancelled.");
      }
      throw new ApplicationError("DEPENDENCY_FAILURE", "Failed to reach the Ollama vision model.", {
        details: { message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      throw new ApplicationError("DEPENDENCY_FAILURE", "Ollama vision-model request failed.", {
        details: { status: response.status, statusText: response.statusText },
      });
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    if (typeof body.response !== "string") {
      throw new ApplicationError(
        "DEPENDENCY_FAILURE",
        "Ollama vision-model response was missing the 'response' text field.",
      );
    }
    return parseQcVerdict(body.response);
  }
}
