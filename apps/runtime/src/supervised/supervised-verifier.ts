import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactStorePort,
  OperationContext,
  ToolGatewayPort,
  UnitOfWorkPort,
  VerificationExecutionResult,
  VerifierPort,
} from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";
import type { ProjectId, SolverCandidate, VerificationPlan } from "@v31m4/domain";
import { ArtifactId, EvidenceId, SafePath, ToolId, VerificationResult } from "@v31m4/domain";

const TOOL_ID = ToolId.parse("stage4-deterministic-verifier");

/** Independent verifier bridge: tool exit status becomes immutable authoritative evidence. */
export class SupervisedVerifier implements VerifierPort {
  constructor(
    private readonly tools: ToolGatewayPort,
    private readonly artifacts: ArtifactStorePort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly projectId: ProjectId,
    private readonly jobId: string,
    private readonly root: string,
  ) {}

  async supports(verifierId: string): Promise<boolean> {
    return verifierId === "stage4-node-verifier";
  }

  async execute(
    plan: VerificationPlan,
    candidate: SolverCandidate,
    context: OperationContext,
  ): Promise<VerificationExecutionResult> {
    const check = plan.checks[0];
    if (
      check === undefined ||
      plan.checks.length !== 1 ||
      check.verifierId !== "stage4-node-verifier"
    ) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Unsupported verification plan.");
    }
    const invocationId = `invocation-verify-${candidate.id}`;
    const execution = await this.tools.invoke(
      {
        invocationId,
        jobId: this.jobId as never,
        toolId: TOOL_ID,
        operation: "verify_candidate",
        inputArtifactIds: candidate.outputArtifactIds,
        parameters: { candidateId: candidate.id },
        expectedOutputs: ["verification_report"],
        resourceBudget: {
          maxWallClockMs: check.timeoutMs,
          maxModelInvocations: 0,
          maxToolInvocations: 1,
          maxRepairRounds: 0,
          maxConcurrentWorkers: 1,
        } as never,
      },
      context,
    );
    const reportFile = execution.metadata["reportFile"];
    if (typeof reportFile !== "string" || reportFile !== `${invocationId}.json`) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verifier report identity is invalid.");
    }
    const reportBytes = await readFile(join(this.root, "verifier-reports", reportFile));
    const report = JSON.parse(reportBytes.toString("utf8")) as Record<string, unknown>;
    if (
      report["verifierId"] !== "stage4-node-verifier" ||
      report["verifierVersion"] !== "1.0.0" ||
      report["checkId"] !== "stage4.tiny-code.tests" ||
      report["exitCode"] !== execution.exitCode
    ) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Verifier report is malformed.");
    }
    const rawReportArtifactId = execution.outputArtifactIds[0];
    if (rawReportArtifactId === undefined) {
      throw new ApplicationError(
        "INTEGRITY_FAILURE",
        "Verifier did not produce a report artifact.",
      );
    }
    const reportArtifactId = ArtifactId.parse(rawReportArtifactId);
    if ((await this.artifacts.get(reportArtifactId, context)) === null) {
      async function* bytes(): AsyncIterable<Uint8Array> {
        yield reportBytes;
      }
      await this.unitOfWork.execute(context, async (transaction) => {
        await this.artifacts.write(
          {
            id: reportArtifactId,
            projectId: this.projectId,
            jobId: this.jobId as never,
            kind: "test_report",
            logicalPath: SafePath.parse(`job-${this.jobId}/verification-${candidate.id}.json`),
            mediaType: "application/json",
            parentArtifactIds: candidate.outputArtifactIds,
            bytes: bytes(),
          },
          context,
          transaction,
        );
      });
    }
    const passed = execution.status === "completed" && execution.exitCode === 0;
    const evidenceId = EvidenceId.parse(`evidence-${candidate.id}`);
    const evidence = Object.freeze({
      id: evidenceId,
      projectId: this.projectId,
      jobId: this.jobId as never,
      kind: "unit_test" as const,
      subjectType: "candidate",
      subjectId: candidate.id,
      status: passed ? ("passed" as const) : ("failed" as const),
      summary: passed
        ? "Independent Stage 4 Node verification passed."
        : `Independent Stage 4 Node verification failed with exit ${execution.exitCode ?? 1}.`,
      artifactIds: Object.freeze([reportArtifactId]),
      verifierId: "stage4-node-verifier",
      verifierVersion: "1.0.0",
      createdAt: context.startedAt,
      immutable: true as const,
    });
    const result = VerificationResult.calculate({
      id: `verification-${candidate.id}`,
      plan,
      completedChecks: [{ checkId: check.id, status: evidence.status, evidenceIds: [evidence.id] }],
    });
    return Object.freeze({
      candidateId: candidate.id,
      result,
      evidence: Object.freeze([evidence]),
    });
  }

  cancel(planId: string, context: OperationContext): Promise<void> {
    return this.tools.cancel(`invocation-verify-${planId}`, context);
  }
}
