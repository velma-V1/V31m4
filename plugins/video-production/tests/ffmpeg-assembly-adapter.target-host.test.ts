import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationError,
  createOperationContext,
  isApplicationError,
} from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { contentHash, type GeneratedShot } from "../src/contracts.js";
import { FfmpegAssemblyAdapter } from "../src/ffmpeg-assembly-adapter.js";

/**
 * Real-tool validation path (see docs/reviews/target-host-validation.md). Runs the actual `ffmpeg`
 * executable on this machine; skips clearly rather than masquerading as a reference test when
 * V31M4_TARGET_HOST=1 is unset or ffmpeg is unavailable. Never claims execution it did not perform.
 * Fixtures are deliberately tiny (64x64, 1s, testsrc/color) — this proves the contract, not encoder
 * throughput.
 */
const TARGET_HOST = process.env["V31M4_TARGET_HOST"] === "1";

function resolveFfmpeg(): string | undefined {
  for (const candidate of ["ffmpeg.exe", "ffmpeg"]) {
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (probe.error === undefined || probe.error === null) return candidate;
  }
  return undefined;
}

const resolvedFfmpegPath = TARGET_HOST ? resolveFfmpeg() : undefined;
const run = TARGET_HOST && resolvedFfmpegPath !== undefined ? describe : describe.skip;
// Only used when `run` is `describe` (i.e. TARGET_HOST and ffmpeg were both confirmed above); the
// fallback keeps this a plain `string` for exactOptionalPropertyTypes without changing behavior.
const ffmpegPath: string = resolvedFfmpegPath ?? "ffmpeg";

if (TARGET_HOST && resolvedFfmpegPath === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    "V31M4_TARGET_HOST=1 but no ffmpeg/ffmpeg.exe found on PATH — skipping real ffmpeg tests.",
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

run("FfmpegAssemblyAdapter (real ffmpeg, target host)", () => {
  it("concatenates real shot files into a real, checksum-verified output in shot order", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-shots-"));
    const outputDir = await mkdtemp(join(tmpdir(), "v31m4-output-"));
    const shots: GeneratedShot[] = [
      { shotId: "shot-1", attempt: 1, outputRef: "a".repeat(64), descriptor: "d1" },
      { shotId: "shot-2", attempt: 1, outputRef: "b".repeat(64), descriptor: "d2" },
    ];
    await makeShotFile(shotsDir, shots[0]!.outputRef, "red");
    await makeShotFile(shotsDir, shots[1]!.outputRef, "blue");

    const adapter = new FfmpegAssemblyAdapter({ shotsDir, outputDir, ffmpegPath });
    const output = await adapter.assemble("production-real-1", shots, newContext("req-ffmpeg-1"));

    expect(output.checksum).toBe(
      contentHash({ shotRefs: shots.map((s) => s.outputRef), kind: "checksum" }),
    );
    expect(output.shotRefs).toEqual(shots.map((s) => s.outputRef));

    const finalPath = join(outputDir, "production-real-1.mp4");
    const stats = await stat(finalPath);
    expect(stats.size).toBeGreaterThan(0);

    const bytes = await readFile(finalPath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    expect(output.outputRef).toBe(actualHash);
  });

  it("fails closed with DEPENDENCY_FAILURE when a shot's media file is missing, without producing output", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-shots-"));
    const outputDir = await mkdtemp(join(tmpdir(), "v31m4-output-"));
    const shots: GeneratedShot[] = [
      { shotId: "shot-missing", attempt: 1, outputRef: "c".repeat(64), descriptor: "d3" },
    ];
    // Deliberately do not create the shot file: the adapter must fail closed before invoking ffmpeg.

    const adapter = new FfmpegAssemblyAdapter({ shotsDir, outputDir, ffmpegPath });
    const error = await expectApplicationError(
      adapter.assemble("production-real-2", shots, newContext("req-ffmpeg-2")),
    );
    expect(error.code).toBe("DEPENDENCY_FAILURE");
    await expect(stat(join(outputDir, "production-real-2.mp4"))).rejects.toThrow();
  });

  it("surfaces a real ffmpeg decode failure (non-zero exit) as DEPENDENCY_FAILURE, without producing output", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-shots-"));
    const outputDir = await mkdtemp(join(tmpdir(), "v31m4-output-"));
    const shots: GeneratedShot[] = [
      { shotId: "shot-corrupt", attempt: 1, outputRef: "d".repeat(64), descriptor: "d4" },
    ];
    // A file that exists but is not decodable media: ffmpeg must actually run and actually fail.
    await writeFile(join(shotsDir, `${shots[0]!.outputRef}.mp4`), "not a real video file");

    const adapter = new FfmpegAssemblyAdapter({ shotsDir, outputDir, ffmpegPath });
    const error = await expectApplicationError(
      adapter.assemble("production-real-3", shots, newContext("req-ffmpeg-3")),
    );
    expect(error.code).toBe("DEPENDENCY_FAILURE");
    await expect(stat(join(outputDir, "production-real-3.mp4"))).rejects.toThrow();
  });

  it("fails closed with DEPENDENCY_FAILURE when the ffmpeg executable itself cannot be started", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-shots-"));
    const outputDir = await mkdtemp(join(tmpdir(), "v31m4-output-"));
    const shots: GeneratedShot[] = [
      { shotId: "shot-1", attempt: 1, outputRef: "e".repeat(64), descriptor: "d5" },
    ];
    await makeShotFile(shotsDir, shots[0]!.outputRef, "green");

    const adapter = new FfmpegAssemblyAdapter({
      shotsDir,
      outputDir,
      ffmpegPath: join(tmpdir(), "v31m4-no-such-ffmpeg-binary"),
    });
    const error = await expectApplicationError(
      adapter.assemble("production-real-4", shots, newContext("req-ffmpeg-4")),
    );
    expect(error.code).toBe("DEPENDENCY_FAILURE");
  });

  it("honors a cancellation signal that is already aborted, without invoking ffmpeg", async () => {
    const shotsDir = await mkdtemp(join(tmpdir(), "v31m4-shots-"));
    const outputDir = await mkdtemp(join(tmpdir(), "v31m4-output-"));
    const shots: GeneratedShot[] = [
      { shotId: "shot-1", attempt: 1, outputRef: "f".repeat(64), descriptor: "d6" },
    ];
    await makeShotFile(shotsDir, shots[0]!.outputRef, "yellow");

    const controller = new AbortController();
    controller.abort();
    const adapter = new FfmpegAssemblyAdapter({ shotsDir, outputDir, ffmpegPath });
    const error = await expectApplicationError(
      adapter.assemble("production-real-5", shots, newContext("req-ffmpeg-5", controller.signal)),
    );
    expect(error.code).toBe("CANCELLED");
    await expect(stat(join(outputDir, "production-real-5.mp4"))).rejects.toThrow();
  });
});
