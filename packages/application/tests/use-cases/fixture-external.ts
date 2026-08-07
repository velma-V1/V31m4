import {
  ArtifactId,
  CheckpointId,
  ProjectId,
  SafePath,
  Score,
} from "@v31m4/domain";
import type {
  ModelGatewayPort,
  PluginRegistryPort,
  ProductionKernelPort,
  ResourceMonitorPort,
  ToolGatewayPort,
  VerifierPort,
  WorkspaceManagerPort,
} from "../../src/index.js";
import { T0, createEvidence, createVerification, type TestClock } from "./fixture-core.js";

export interface ExternalState {
  readonly clock: TestClock;
  readonly discardedWorkspaces: string[];
  readonly pluginRegistry: PluginRegistryPort;
  kernelFailure: Error | undefined;
  modelFailure: Error | undefined;
  toolFailure: Error | undefined;
}

export function createExternalPorts(state: ExternalState) {
  const kernel: ProductionKernelPort = {
    start: async (_request, operation) => {
      if (state.kernelFailure !== undefined) throw state.kernelFailure;
      return { operationId: "kernel-start-1", acceptedAt: state.clock.now(), idempotencyKey: operation.idempotencyKey };
    },
    checkpoint: async () => {
      if (state.kernelFailure !== undefined) throw state.kernelFailure;
      return CheckpointId.parse("checkpoint-1");
    },
    resume: async (_jobId, _checkpointId, operation) => ({
      operationId: "kernel-resume-1",
      acceptedAt: state.clock.now(),
      idempotencyKey: operation.idempotencyKey,
    }),
    stop: async () => { if (state.kernelFailure !== undefined) throw state.kernelFailure; },
    status: async (jobId) => ({ jobId, status: "running", stage: "running", progress: Score.parse(0.5), details: {} }),
    health: async () => ({ status: "healthy", checkedAt: state.clock.now(), details: {} }),
  };

  const workspaces: WorkspaceManagerPort = {
    create: async (projectId, purpose) => ({
      id: `workspace-${purpose}`,
      projectId,
      purpose,
      rootPath: SafePath.parse(`workspaces/${purpose}`),
      status: "active",
      createdAt: state.clock.now(),
    }),
    get: async () => null,
    snapshot: async (workspaceId) => ({ workspaceId, artifactIds: [], createdAt: state.clock.now() }),
    seal: async (workspaceId) => ({
      id: workspaceId,
      projectId: ProjectId.parse("project-1"),
      purpose: "candidate",
      rootPath: SafePath.parse("workspaces/candidate"),
      status: "sealed",
      createdAt: T0,
    }),
    discard: async (workspaceId) => { state.discardedWorkspaces.push(workspaceId); },
  };

  const modelGateway: ModelGatewayPort = {
    list: async () => ({ items: [] }),
    get: async () => null,
    invoke: async (request) => {
      if (state.modelFailure !== undefined) throw state.modelFailure;
      return {
        invocationId: request.invocationId,
        modelId: request.modelId,
        responseArtifactId: ArtifactId.parse(`response-${request.invocationId}`),
        outputArtifactIds: [ArtifactId.parse(`output-${request.invocationId}`)],
        finishReason: "completed",
        usage: { wallClockMs: 10 },
        metadata: {},
      };
    },
    cancel: async () => {},
    health: async () => ({ status: "healthy", checkedAt: state.clock.now(), details: {} }),
  };

  const toolGateway: ToolGatewayPort = {
    list: async () => ({ items: [] }),
    get: async () => null,
    invoke: async (request) => {
      if (state.toolFailure !== undefined) throw state.toolFailure;
      return {
        invocationId: request.invocationId,
        toolId: request.toolId,
        status: "completed",
        outputArtifactIds: [ArtifactId.parse(`output-${request.invocationId}`)],
        logArtifactIds: [],
        metadata: {},
      };
    },
    cancel: async () => {},
    health: async () => ({ status: "healthy", checkedAt: state.clock.now(), details: {} }),
  };

  const verifier: VerifierPort = {
    supports: async () => true,
    execute: async (plan, candidate) => ({
      candidateId: candidate.id,
      result: createVerification(plan, candidate.id, `evidence-${plan.id}`),
      evidence: [createEvidence(`evidence-${plan.id}`, candidate.id, "candidate")],
    }),
    cancel: async () => {},
  };

  const resourceMonitor: ResourceMonitorPort = {
    read: async () => ({
      cpuUtilization: Score.parse(0.1),
      ramUsedBytes: 1_000,
      ramTotalBytes: 16_000_000_000,
      gpuUtilization: Score.parse(0.1),
      vramUsedBytes: 1_000,
      vramTotalBytes: 8_000_000_000,
      storageFreeBytes: 1_000_000_000,
      idleForMs: 3_600_000,
      capturedAt: state.clock.now(),
      details: {},
    }),
    watch: async () => ({ id: "resources-1", async close() {} }),
  };

  return Object.freeze({ kernel, workspaces, modelGateway, toolGateway, verifier, resourceMonitor });
}
