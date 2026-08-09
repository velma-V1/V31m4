import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationError, type OperationContext } from "@v31m4/application";
import {
  type AssemblyAdapter,
  contentHash,
  type GeneratedShot,
  type RenderOutput,
} from "./contracts.js";
import { runExternalProcess } from "./internal/run-external-process.js";

export interface FfmpegAssemblyAdapterOptions {
  /** Directory containing real per-shot media files, named `<outputRef>.mp4`. */
  readonly shotsDir: string;
  /** Directory the assembled production output is written into. */
  readonly outputDir: string;
  readonly ffmpegPath?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Production `AssemblyAdapter` backed by the real `ffmpeg` executable: concatenates the accepted
 * shots' real media files (video-only, filter_complex concat) into one output file. `checksum` is
 * still computed identically to `ReferenceAssemblyAdapter` (over shot output references) because
 * `VideoDepartment` independently recomputes and verifies it; `outputRef` is the SHA-256 of the
 * actual bytes ffmpeg produced, so cache identity tracks real output even though ffmpeg's own
 * encoding is not bit-for-bit deterministic across runs.
 */
export class FfmpegAssemblyAdapter implements AssemblyAdapter {
  readonly #shotsDir: string;
  readonly #outputDir: string;
  readonly #ffmpegPath: string;
  readonly #timeoutMs: number;

  constructor(options: FfmpegAssemblyAdapterOptions) {
    this.#shotsDir = options.shotsDir;
    this.#outputDir = options.outputDir;
    this.#ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async assemble(
    productionId: string,
    shots: readonly GeneratedShot[],
    context: OperationContext,
  ): Promise<RenderOutput> {
    if (shots.length === 0) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Assembly requires at least one accepted shot.",
      );
    }
    if (context.signal.aborted) {
      throw new ApplicationError("CANCELLED", "Assembly was cancelled before it started.");
    }

    const inputPaths = shots.map((shot) => join(this.#shotsDir, `${shot.outputRef}.mp4`));
    for (const [index, path] of inputPaths.entries()) {
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      if (!exists) {
        throw new ApplicationError(
          "DEPENDENCY_FAILURE",
          "Shot media file is missing for assembly.",
          {
            details: { shotId: shots[index]?.shotId ?? "", path },
          },
        );
      }
    }

    await mkdir(this.#outputDir, { recursive: true });
    const temporaryPath = join(this.#outputDir, `.tmp-${randomUUID()}.mp4`);
    const filterInputs = shots.map((_, index) => `[${index}:v:0]`).join("");
    const args = [
      "-y",
      ...inputPaths.flatMap((path) => ["-i", path]),
      "-filter_complex",
      `${filterInputs}concat=n=${shots.length}:v=1:a=0[outv]`,
      "-map",
      "[outv]",
      "-pix_fmt",
      "yuv420p",
      temporaryPath,
    ];

    try {
      await runExternalProcess({
        command: this.#ffmpegPath,
        args,
        timeoutMs: this.#timeoutMs,
        context,
        toolLabel: "ffmpeg",
      });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    const outputStat = await stat(temporaryPath).catch(() => undefined);
    if (outputStat === undefined || outputStat.size === 0) {
      await rm(temporaryPath, { force: true });
      throw new ApplicationError("DEPENDENCY_FAILURE", "ffmpeg produced no output.", {
        details: { productionId },
      });
    }

    const outputRef = await this.#hashFile(temporaryPath);
    const finalPath = join(this.#outputDir, `${productionId}.mp4`);
    await rm(finalPath, { force: true });
    await rename(temporaryPath, finalPath);

    const shotRefs = shots.map((shot) => shot.outputRef);
    return Object.freeze({
      outputRef,
      checksum: contentHash({ shotRefs, kind: "checksum" }),
      shotRefs: Object.freeze(shotRefs),
    });
  }

  async #hashFile(path: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  }
}
