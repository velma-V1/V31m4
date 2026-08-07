import {
  ArtifactId,
  CapabilityId,
  EvidenceRecord,
  type EvidenceRecord as EvidenceRecordType,
  JobId,
  ModelId,
  PluginId,
  ResourceBudget,
  SafePath,
  ToolId,
  type VerificationPlan,
  VerificationResult,
  type VerificationResult as VerificationResultType,
} from "@v31m4/domain";
import {
  createOperationContext,
  type ModelInvocationRequest,
  type OperationContext,
  type PluginManifest,
  type ToolInvocationRequest,
  type UnitOfWorkPort,
  type UnitOfWorkTransaction,
  type Versioned,
  type WriteCondition,
} from "../../src/index.js";

export const T0 = "2026-08-06T20:00:00.000Z";
export const T1 = "2026-08-06T20:01:00.000Z";
export const T2 = "2026-08-06T20:02:00.000Z";

export const context: OperationContext = createOperationContext({
  requestId: "request-1",
  idempotencyKey: "idem-1",
  actor: { id: "user-1", kind: "user", roles: ["owner"] },
  startedAt: T0,
});

export function budget() {
  return ResourceBudget.create({
    maxWallClockMs: 60_000,
    maxModelInvocations: 8,
    maxToolInvocations: 8,
    maxRepairRounds: 3,
    maxConcurrentWorkers: 4,
    maxInputTokens: 20_000,
    maxOutputTokens: 10_000,
    maxRamBytes: 16_000_000_000,
    maxVramBytes: 8_000_000_000,
  });
}

export function versioned<Value>(value: Value, revision = "1"): Versioned<Value> {
  return Object.freeze({ value, revision });
}

export function nextRevision(current?: Versioned<unknown>): string {
  return String(current === undefined ? 1 : Number(current.revision) + 1);
}

export function assertCondition<Value>(
  current: Versioned<Value> | undefined,
  condition: WriteCondition,
): void {
  if (condition.kind === "must_not_exist" && current !== undefined)
    throw new Error("record already exists");
  if (condition.kind === "match_revision" && current?.revision !== condition.revision)
    throw new Error("revision conflict");
}

export class TestUnitOfWork implements UnitOfWorkPort {
  commits = 0;
  rollbacks = 0;

  async execute<Result>(
    operation: OperationContext,
    work: (transaction: UnitOfWorkTransaction) => Promise<Result>,
  ): Promise<Result> {
    const afterCommit: Array<() => void | Promise<void>> = [];
    const afterRollback: Array<() => void | Promise<void>> = [];
    const transaction: UnitOfWorkTransaction = {
      id: `tx-${this.commits + this.rollbacks + 1}`,
      startedAt: operation.startedAt,
      afterCommit(action) {
        afterCommit.push(action);
      },
      afterRollback(action) {
        afterRollback.push(action);
      },
    };
    try {
      const result = await work(transaction);
      this.commits += 1;
      for (const action of afterCommit) await action();
      return result;
    } catch (error) {
      this.rollbacks += 1;
      for (const action of afterRollback) await action();
      throw error;
    }
  }
}

export class TestClock {
  private index = 0;
  readonly values = [T0, T1, T2, "2026-08-06T20:03:00.000Z", "2026-08-06T20:04:00.000Z"];
  now(): string {
    return this.values[Math.min(this.index++, this.values.length - 1)] ?? T2;
  }
  monotonicMilliseconds(): number {
    return this.index * 1_000;
  }
  async sleep(): Promise<void> {}
}

export function createEvidence(
  id: string,
  subjectId: string,
  subjectType = "acceptance_criterion",
): EvidenceRecordType {
  return EvidenceRecord.create({
    id,
    projectId: "project-1",
    kind: "unit_test",
    subjectType,
    subjectId,
    status: "passed",
    summary: "passed",
    artifactIds: [`artifact-${id}`],
    verifierId: "verifier-1",
    verifierVersion: "1.0.0",
    createdAt: T0,
  });
}

export function createVerification(
  plan: VerificationPlan,
  candidateId: string,
  evidenceId = `evidence-${candidateId}`,
): VerificationResultType {
  const completedChecks = plan.checks.map((check) => ({
    checkId: check.id,
    status: "passed" as const,
    evidenceIds: [evidenceId],
  }));
  return VerificationResult.calculate({ id: `verification-${candidateId}`, plan, completedChecks });
}

export function approvedPluginManifest(): PluginManifest {
  return {
    pluginId: PluginId.parse("plugin-1"),
    displayName: "Plugin One",
    version: "1.0.0",
    minimumRuntimeVersion: "1.0.0",
    entrypoint: SafePath.parse("plugins/plugin-1/index.js"),
    capabilities: [CapabilityId.parse("capability-1")],
    requiredToolIds: [],
    optionalToolIds: [],
    workflowIds: ["workflow-1"],
    verifierIds: ["verifier-1"],
    permissions: { filesystem: ["project_read"], network: false, process: [] },
  };
}

export function modelRequest(): ModelInvocationRequest {
  return {
    invocationId: "model-invoke-1",
    jobId: JobId.parse("job-1"),
    modelId: ModelId.parse("model-1"),
    promptArtifactId: ArtifactId.parse("prompt-1"),
    configuration: {
      modelId: ModelId.parse("model-1"),
      strategy: "direct",
      contextArtifactIds: [],
      toolIds: [],
      constraints: [],
    },
    resourceBudget: budget(),
    metadata: {},
  };
}

export function toolRequest(): ToolInvocationRequest {
  return {
    invocationId: "tool-invoke-1",
    jobId: JobId.parse("job-1"),
    toolId: ToolId.parse("tool-1"),
    operation: "validate",
    inputArtifactIds: [],
    parameters: {},
    expectedOutputs: ["report"],
    resourceBudget: budget(),
  };
}
