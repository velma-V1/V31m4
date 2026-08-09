import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationError,
  createOperationContext,
  isApplicationError,
} from "@v31m4/application";
import { describe, expect, it } from "vitest";
import type { GeneratedShot, ShotSpec } from "../src/contracts.js";
import { OllamaVisionQcAdapter } from "../src/ollama-vision-qc-adapter.js";

/**
 * Real-tool validation path (see docs/reviews/target-host-validation.md). Runs a real ffmpeg frame
 * extraction plus a real inference call to an already-installed, vision-capable Ollama model. Skips
 * clearly rather than masquerading as a reference test when V31M4_TARGET_HOST=1 is unset, ffmpeg is
 * unavailable, the Ollama server is unreachable, or the target model is not installed. Exactly one
 * real model inference call is made across this whole file, to keep GPU/VRAM use minimal.
 */
const TARGET_HOST = process.env["V31M4_TARGET_HOST"] === "1";
const OLLAMA_BASE_URL = process.env["V31M4_OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const MODEL = process.env["V31M4_OLLAMA_VISION_MODEL"] ?? "qwen3.5:9b";

function resolveFfmpeg(): string | undefined {
  for (const candidate of ["ffmpeg.exe", "ffmpeg"]) {
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (probe.error === undefined || probe.error === null) return candidate;
  }
  return undefined;
}

async function resolveOllamaModel(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { models?: readonly { name?: string }[] };
    return (body.models ?? []).some((entry) => entry.name === MODEL);
  } catch {
    return false;
  }
}

const resolvedFfmpegPath = TARGET_HOST ? resolveFfmpeg() : undefined;
const ollamaModelAvailable = TARGET_HOST ? await resolveOllamaModel() : false;
const ready = TARGET_HOST && resolvedFfmpegPath !== undefined && ollamaModelAvailable;
const run = ready ? describe : describe.skip;
const ffmpegPath: string = resolvedFfmpegPath ?? "ffmpeg";

if (TARGET_HOST && !ready) {
  // eslint-disable-next-line no-console
  console.warn(
    `V31M4_TARGET_HOST=1 but prerequisites are missing (ffmpeg: ${String(resolvedFfmpegPath !== undefined)}, ` +
      `Ollama model '${MODEL}' at ${OLLAMA_BASE_URL}: ${String(ollamaModelAvailable)}) — skipping real vision-QC tests.`,
  );
}

function newContext(requestId: string, signal?: AbortSignal) {
  return createOperationContext({
    requestId,
    idempotencyKey: `idem-${requestId}`,
    actor: { id: "operator", kind: "user", roles: ["operator"] },
    startedAt: "2026-08-09T12:00:00.000Z",
    ...(signal === undefined ? {} : { signal }),
  });
}

async function makeShotFile(dir: string, outputRef: string, color: string): Promise<void> {
  const path = join(dir, `${outputRef}.mp4`);
  const result = spawnSync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:size=64x64:rate=5:duration=1`,
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      path,
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new Error(`fixture ffmpeg invocation failed: ${result.stderr.toString("utf8")}`);
  }
}

async function expectApplicationError(promise: Promise<unknown>): Promise<ApplicationError> {
  try {
    await promise;
  } catch (error) {
    if (isApplicationError(error)) return error;
    throw error;
  }
  throw new Error("expected promise to reject with an ApplicationError");
}

const shot: GeneratedShot = {
  shotId: "shot-1",
  attempt: 1,
  outputRef: "1".repeat(64),
  descriptor: "d1",
};
const spec: ShotSpec = {
  shotId: "shot-1",
  prompt: "a plain solid red square",
  qualityTier: "draft",
  seed: 1,
};

run("OllamaVisionQcAdapter (real ffmpeg + real Ollama vision model, target host)", () => {
  it("runs a real frame extraction and a real model inference, returning a well-shaped verdict", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-qc-shots-"));
    await makeShotFile(shotsDir, shot.outputRef, "red");

    const adapter = new OllamaVisionQcAdapter({
      shotsDir,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      model: MODEL,
      ffmpegPath,
    });

    const started = Date.now();
    const report = await adapter.inspect(shot, spec, newContext("req-qc-1"));
    const elapsedMs = Date.now() - started;

    expect(typeof report.passed).toBe("boolean");
    expect(Array.isArray(report.findings)).toBe(true);
    for (const finding of report.findings) {
      expect(typeof finding.kind).toBe("string");
      expect(typeof finding.detail).toBe("string");
    }
    // Real inference evidence, not a correctness assertion on the model's judgment: log it.
    // eslint-disable-next-line no-console
    console.log(
      `[real-ollama-vision-qc] model=${MODEL} elapsedMs=${elapsedMs} passed=${String(report.passed)} ` +
        `findings=${JSON.stringify(report.findings)}`,
    );
    expect(elapsedMs).toBeGreaterThan(0);
  }, 180_000);

  it("fails closed with DEPENDENCY_FAILURE when the shot media file is missing, without calling Ollama", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-qc-shots-"));
    const adapter = new OllamaVisionQcAdapter({
      shotsDir,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      model: MODEL,
      ffmpegPath,
    });
    const error = await expectApplicationError(adapter.inspect(shot, spec, newContext("req-qc-2")));
    expect(error.code).toBe("DEPENDENCY_FAILURE");
  });

  it("surfaces a real ffmpeg frame-extraction failure as DEPENDENCY_FAILURE for undecodable media", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-qc-shots-"));
    await writeFile(join(shotsDir, `${shot.outputRef}.mp4`), "not a real video file");
    const adapter = new OllamaVisionQcAdapter({
      shotsDir,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      model: MODEL,
      ffmpegPath,
    });
    const error = await expectApplicationError(adapter.inspect(shot, spec, newContext("req-qc-3")));
    expect(error.code).toBe("DEPENDENCY_FAILURE");
  });

  it("fails closed with DEPENDENCY_FAILURE when the Ollama server is unreachable", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-qc-shots-"));
    await makeShotFile(shotsDir, shot.outputRef, "blue");
    const adapter = new OllamaVisionQcAdapter({
      shotsDir,
      ollamaBaseUrl: "http://127.0.0.1:1",
      model: MODEL,
      ffmpegPath,
      inferenceTimeoutMs: 3_000,
    });
    const error = await expectApplicationError(adapter.inspect(shot, spec, newContext("req-qc-4")));
    expect(error.code).toBe("DEPENDENCY_FAILURE");
  });

  it("honors a cancellation signal that is already aborted, without invoking ffmpeg or Ollama", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-qc-shots-"));
    await makeShotFile(shotsDir, shot.outputRef, "green");
    const controller = new AbortController();
    controller.abort();
    const adapter = new OllamaVisionQcAdapter({
      shotsDir,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      model: MODEL,
      ffmpegPath,
    });
    const error = await expectApplicationError(
      adapter.inspect(shot, spec, newContext("req-qc-5", controller.signal)),
    );
    expect(error.code).toBe("CANCELLED");
  });
});
