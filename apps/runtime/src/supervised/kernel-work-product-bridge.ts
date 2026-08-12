import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactStorePort, OperationContext } from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";
import { ArtifactId } from "@v31m4/domain";
import { PathPolicy } from "@v31m4/infrastructure";

const MAX_CANDIDATE_BYTES = 64 * 1024;

/** Materializes one authoritative candidate artifact into the kernel's owned inbox. */
export class KernelWorkProductBridge {
  #policy: Promise<PathPolicy> | undefined;

  constructor(
    private readonly artifacts: ArtifactStorePort,
    private readonly root: string,
  ) {}

  async materialize(
    jobId: string,
    artifactId: string,
    context: OperationContext,
    workflowId = "stage4.tiny-code",
  ): Promise<void> {
    const policy = await this.#pathPolicy();
    const directory = await policy.resolve("project", `kernel-workspaces/${jobId}`);
    await mkdir(directory, { recursive: true });
    const candidateName =
      workflowId === "software.production.v1" ? "candidate.json" : "candidate.mjs";
    const target = await policy.resolve("project", `kernel-workspaces/${jobId}/${candidateName}`);
    const bytes = await readBounded(this.artifacts, ArtifactId.parse(artifactId), context);
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new ApplicationError("PERMISSION_DENIED", "Kernel candidate target is unsafe.");
      }
      const current = await readBoundedFile(target);
      if (!current.equals(bytes)) {
        throw new ApplicationError(
          "CONFLICT",
          "Kernel candidate retry conflicts with staged work.",
        );
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = join(directory, `candidate.${process.pid}.tmp`);
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  }

  async #pathPolicy(): Promise<PathPolicy> {
    if (this.#policy !== undefined) return this.#policy;
    const artifactRoot = join(this.root, "artifact-boundary");
    const backupRoot = join(this.root, "backup-boundary");
    await Promise.all([
      mkdir(this.root, { recursive: true }),
      mkdir(artifactRoot, { recursive: true }),
      mkdir(backupRoot, { recursive: true }),
    ]);
    this.#policy = PathPolicy.create({
      project: this.root,
      artifact: artifactRoot,
      backup: backupRoot,
    });
    return this.#policy;
  }
}

async function readBounded(
  artifacts: ArtifactStorePort,
  id: ArtifactId,
  context: OperationContext,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await artifacts.open(id, context)) {
    size += chunk.byteLength;
    if (size > MAX_CANDIDATE_BYTES) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Candidate artifact exceeds kernel limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const result = Buffer.concat(chunks);
  if (result.length === 0) throw new ApplicationError("INTEGRITY_FAILURE", "Candidate is empty.");
  return result;
}

async function readBoundedFile(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  if (bytes.length > MAX_CANDIDATE_BYTES) {
    throw new ApplicationError("INTEGRITY_FAILURE", "Staged kernel candidate is oversized.");
  }
  return bytes;
}
