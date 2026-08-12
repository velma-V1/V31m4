import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ArtifactStorePort,
  ModelGatewayPort,
  OperationContext,
  ProductionKernelPort,
  UnitOfWorkPort,
  VerifierPort,
} from "@v31m4/application";
import type { ModelId, ProjectId } from "@v31m4/domain";
import { ModelProfile, ToolProfile } from "@v31m4/domain";
import {
  SupervisedAdapterProcess,
  SupervisedModelGateway,
  SupervisedProductionKernel,
  SupervisedToolGateway,
} from "@v31m4/infrastructure";
import type { RuntimeConfig } from "../runtime-config.js";
import { KernelWorkProductBridge } from "./kernel-work-product-bridge.js";
import { ModelArtifactGateway } from "./model-artifact-gateway.js";
import { SoftwareProductionWorkspace } from "./software-production-workspace.js";
import { SupervisedVerifier } from "./supervised-verifier.js";

export interface LocalExecutionComposition {
  readonly modelId: ModelId;
  readonly verifierId: string;
  readonly kernel: ProductionKernelPort;
  model(projectId: ProjectId): ModelGatewayPort;
  verifier(projectId: ProjectId, jobId: string): VerifierPort;
  materializeCandidate(
    jobId: string,
    artifactId: string,
    context: OperationContext,
    workflowId: string,
    allowReplacement?: boolean,
  ): Promise<void>;
  prepareSoftwareJob(projectPath: string, projectId: ProjectId, jobId: string): Promise<void>;
  softwarePrompt(jobId: string, missionTitle: string, missionObjective: string): Promise<string>;
  softwareRepairRounds(jobId: string): Promise<number>;
  close(): Promise<void>;
}

/** Owns the three optional supervised child processes for the explicit local profile. */
export function createLocalExecutionComposition(
  config: RuntimeConfig,
  artifacts: ArtifactStorePort,
  unitOfWork: UnitOfWorkPort,
): LocalExecutionComposition {
  const local = config.supervisedLocal;
  if (local === undefined) throw new Error("Supervised local configuration is required.");
  const root = join(dirname(config.databasePath), "supervised");
  const adapterRoot = fileURLToPath(
    new URL("../../../../adapters/local-supervised/", import.meta.url),
  );
  const common = { V31M4_STAGE4_ROOT: root };
  const modelProcess = new SupervisedAdapterProcess({
    id: "ollama-local-supervised",
    process: {
      command: process.execPath,
      args: [join(adapterRoot, "model-adapter.mjs")],
      environment: {
        ...common,
        V31M4_OLLAMA_ENDPOINT: local.ollamaEndpoint,
        V31M4_OLLAMA_MODEL: local.model,
      },
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 1_000,
    },
    maxFrameBytes: 256 * 1024,
  });
  const kernelProcess = new SupervisedAdapterProcess({
    id: "stage4-local-kernel",
    process: {
      command: process.execPath,
      args: [join(adapterRoot, "kernel-adapter.mjs")],
      environment: common,
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 1_000,
    },
    maxFrameBytes: 256 * 1024,
  });
  const verifierProcess = new SupervisedAdapterProcess({
    id: "stage4-local-verifier-adapter",
    process: {
      command: process.execPath,
      args: [join(adapterRoot, "verifier-adapter.mjs")],
      environment: common,
      stderrLimitBytes: 64 * 1024,
      shutdownTimeoutMs: 1_000,
    },
    maxFrameBytes: 256 * 1024,
  });
  const modelId = local.model as ModelId;
  const modelGateway = new SupervisedModelGateway(
    [
      ModelProfile.create({
        modelId,
        adapterId: modelProcess.id,
        displayName: `Local Ollama ${local.model}`,
        status: "available",
        local: true,
        supportedModalities: ["text"],
      }),
    ],
    new Map([[modelId, { primary: modelProcess }]]),
  );
  const verifierToolId = "stage4-deterministic-verifier";
  const toolGateway = new SupervisedToolGateway(
    [
      ToolProfile.create({
        toolId: verifierToolId,
        adapterId: verifierProcess.id,
        displayName: "Stage 4 Independent Node Verifier",
        status: "available",
        operations: ["verify_candidate"],
        installedVersion: process.version,
        automationMethod: "cli",
      }),
    ],
    new Map([[verifierToolId, { primary: verifierProcess }]]),
  );
  const bridge = new KernelWorkProductBridge(artifacts, root);
  const software = new SoftwareProductionWorkspace(
    join(dirname(config.databasePath), "projects"),
    root,
  );
  return Object.freeze({
    modelId,
    verifierId: "stage4-node-verifier",
    kernel: new SupervisedProductionKernel({ primary: kernelProcess }),
    model: (projectId: ProjectId) =>
      new ModelArtifactGateway(modelGateway, artifacts, unitOfWork, projectId, root),
    verifier: (projectId: ProjectId, jobId: string) =>
      new SupervisedVerifier(toolGateway, artifacts, unitOfWork, projectId, jobId, root),
    materializeCandidate: (
      jobId: string,
      artifactId: string,
      context: OperationContext,
      workflowId: string,
      allowReplacement = false,
    ) => bridge.materialize(jobId, artifactId, context, workflowId, allowReplacement),
    async prepareSoftwareJob(
      projectPath: string,
      projectId: ProjectId,
      jobId: string,
    ): Promise<void> {
      const packet = await software.load(projectPath);
      if (packet.projectId !== projectId) {
        throw new Error("Software build packet belongs to a different project.");
      }
      await software.prepare(projectPath, jobId, packet);
    },
    softwarePrompt: (jobId: string, missionTitle: string, missionObjective: string) =>
      software.prompt(jobId, missionTitle, missionObjective),
    softwareRepairRounds: (jobId: string) => software.repairRounds(jobId),
    async close(): Promise<void> {
      await Promise.all([modelProcess.stop(), kernelProcess.stop(), verifierProcess.stop()]);
    },
  });
}
