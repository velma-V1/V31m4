import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  ArtifactStorePort,
  ModelGatewayPort,
  ModelInvocationRequest,
  ModelInvocationResult,
  OperationContext,
  PortHealth,
  PortPage,
  PortPageRequest,
  UnitOfWorkPort,
} from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";
import type { ModelId, ModelProfile, ProjectId } from "@v31m4/domain";
import { ArtifactId, SafePath } from "@v31m4/domain";

const MAX_MATERIALIZED_BYTES = 64 * 1024;

/** Runtime-owned materialization around the provider-neutral supervised model gateway. */
export class ModelArtifactGateway implements ModelGatewayPort {
  constructor(
    private readonly gateway: ModelGatewayPort,
    private readonly artifacts: ArtifactStorePort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly projectId: ProjectId,
    private readonly root: string,
  ) {}

  list(request: PortPageRequest, context: OperationContext): Promise<PortPage<ModelProfile>> {
    return this.gateway.list(request, context);
  }

  get(modelId: ModelId, context: OperationContext): Promise<ModelProfile | null> {
    return this.gateway.get(modelId, context);
  }

  async invoke(
    request: ModelInvocationRequest,
    context: OperationContext,
  ): Promise<ModelInvocationResult> {
    await this.#materializePrompt(request.promptArtifactId, context);
    const external = await this.gateway.invoke(request, context);
    const responseArtifactId = ArtifactId.parse(external.responseArtifactId);
    const existing = await this.artifacts.get(responseArtifactId, context);
    if (existing === null) {
      const outputFile = external.metadata["outputFile"];
      if (typeof outputFile !== "string" || outputFile !== `${request.invocationId}.txt`) {
        throw new ApplicationError(
          "INTEGRITY_FAILURE",
          "Model adapter output identity is invalid.",
        );
      }
      const bytes = await this.#readStagedOutput(outputFile);
      async function* source(): AsyncIterable<Uint8Array> {
        yield bytes;
      }
      await this.unitOfWork.execute(context, async (transaction) => {
        await this.artifacts.write(
          {
            id: responseArtifactId,
            projectId: this.projectId,
            jobId: request.jobId,
            kind: "source",
            logicalPath: SafePath.parse(
              `job-${request.jobId}/candidate-${request.invocationId}.mjs`,
            ),
            mediaType: "text/javascript",
            parentArtifactIds: [request.promptArtifactId],
            bytes: source(),
          },
          context,
          transaction,
        );
      });
    }
    return Object.freeze({
      ...external,
      responseArtifactId,
      outputArtifactIds: Object.freeze([responseArtifactId]),
    });
  }

  cancel(invocationId: string, context: OperationContext): Promise<void> {
    return this.gateway.cancel(invocationId, context);
  }

  health(modelId: ModelId, context: OperationContext): Promise<PortHealth> {
    return this.gateway.health(modelId, context);
  }

  async #materializePrompt(artifactId: string, context: OperationContext): Promise<void> {
    const directory = this.#contained("model-inputs");
    await mkdir(directory, { recursive: true });
    const target = this.#contained(join("model-inputs", `${artifactId}.txt`));
    try {
      const existing = await lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("unsafe prompt target");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const bytes = await readArtifact(this.artifacts, ArtifactId.parse(artifactId), context);
    if (bytes.length === 0 || bytes.length > MAX_MATERIALIZED_BYTES) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Prompt artifact is empty or oversized.");
    }
    await atomicWrite(target, bytes);
  }

  async #readStagedOutput(file: string): Promise<Buffer> {
    const path = this.#contained(join("model-outputs", file));
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size === 0 ||
      stat.size > MAX_MATERIALIZED_BYTES
    ) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "Model adapter output is empty or oversized.",
      );
    }
    return readFile(path);
  }

  #contained(relative: string): string {
    const root = resolve(this.root);
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) {
      throw new ApplicationError("PERMISSION_DENIED", "Supervised model path escapes its root.");
    }
    return target;
  }
}

async function readArtifact(
  artifacts: ArtifactStorePort,
  id: ArtifactId,
  context: OperationContext,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await artifacts.open(id, context)) {
    size += chunk.byteLength;
    if (size > MAX_MATERIALIZED_BYTES) break;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}
