import { IssueRecord, RepairRecord, SolverCandidate, type ArtifactId, type IssueId, type JobId, type ProjectId, type RepairRecord as RepairRecordType, type ResourceBudget, type SolverCandidate as SolverCandidateType, type SolverConfiguration, type VerificationPlan } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type { ModelGatewayPort } from "../ports/model-gateway.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { VerifierPort } from "../ports/verifier.port.js";
import type { WorkspaceManagerPort } from "../ports/workspace-manager.port.js";
import { WriteConditions } from "../port-types.js";
import { requireValue } from "./use-case-support.js";

export interface RepairCandidateDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly models: ModelGatewayPort;
  readonly verifier: VerifierPort;
  readonly workspaces: WorkspaceManagerPort;
}

export interface RepairCandidateCommand {
  readonly projectId: ProjectId;
  readonly jobId: JobId;
  readonly issueId: IssueId;
  readonly sourceCandidate: SolverCandidateType;
  readonly repairedCandidateId: string;
  readonly repairId: string;
  readonly invocationId: string;
  readonly promptArtifactId: ArtifactId;
  readonly configuration: SolverConfiguration;
  readonly focusedPlan: VerificationPlan;
  readonly regressionPlan: VerificationPlan;
  readonly createdAt: string;
  readonly resourceBudget: ResourceBudget;
}

export interface RepairCandidateOutcome {
  readonly candidate: SolverCandidateType;
  readonly repair: RepairRecordType;
}

export async function repairCandidate(
  dependencies: RepairCandidateDependencies,
  command: RepairCandidateCommand,
  context: OperationContext,
): Promise<RepairCandidateOutcome> {
  const workspace = await dependencies.workspaces.create(command.projectId, "repair", context);
  try {
    const invocation = await dependencies.models.invoke({
      invocationId: command.invocationId,
      jobId: command.jobId,
      modelId: command.configuration.modelId,
      promptArtifactId: command.promptArtifactId,
      configuration: command.configuration,
      resourceBudget: command.resourceBudget,
      metadata: { workspaceId: workspace.id, issueId: command.issueId },
    }, context);
    if (invocation.finishReason !== "completed" || invocation.outputArtifactIds.length === 0) {
      throw new ApplicationError("DEPENDENCY_FAILURE", "Repair invocation did not produce a candidate.");
    }
    const candidate = SolverCandidate.createReconstructed({
      id: command.repairedCandidateId,
      missionId: command.sourceCandidate.missionId,
      configuration: {
        modelId: command.configuration.modelId,
        strategy: command.configuration.strategy,
        contextArtifactIds: command.configuration.contextArtifactIds,
        toolIds: command.configuration.toolIds,
        ...(command.configuration.temperature === undefined ? {} : { temperature: command.configuration.temperature }),
        ...(command.configuration.seed === undefined ? {} : { seed: command.configuration.seed }),
        constraints: command.configuration.constraints,
      },
      responseArtifactId: invocation.responseArtifactId,
      outputArtifactIds: invocation.outputArtifactIds,
      createdAt: command.createdAt,
    }, [String(command.sourceCandidate.id)]);
    assertApplication(command.focusedPlan.candidateId === candidate.id && command.regressionPlan.candidateId === candidate.id, "INTEGRITY_FAILURE", "Repair verification plans must target the repaired candidate.");
    const focused = await dependencies.verifier.execute(command.focusedPlan, candidate, context);
    const regression = await dependencies.verifier.execute(command.regressionPlan, candidate, context);
    const passed = focused.result.status === "passed" && regression.result.status === "passed";
    const repair = RepairRecord.create({
      id: command.repairId,
      issueId: command.issueId,
      sourceCandidateId: command.sourceCandidate.id,
      repairedCandidateId: candidate.id,
      changedArtifactIds: invocation.outputArtifactIds,
      focusedEvidenceIds: focused.result.evidenceIds,
      regressionEvidenceIds: regression.result.evidenceIds,
      status: passed ? "passed" : "failed",
    });
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      const storedIssue = requireValue(await dependencies.candidates.getIssue(command.issueId, context, transaction), "Repair issue does not exist.");
      await dependencies.candidates.appendCandidate(candidate, context, transaction);
      for (const record of [...focused.evidence, ...regression.evidence]) await dependencies.evidence.append(record, context, transaction);
      await dependencies.candidates.appendRepair(repair, context, transaction);
      if (passed) {
        const accepted = storedIssue.value.status === "open" ? IssueRecord.accept(storedIssue.value) : storedIssue.value;
        const repairedIssue = IssueRecord.markRepaired(accepted);
        await dependencies.candidates.saveIssue(repairedIssue, WriteConditions.matchRevision(storedIssue.revision), context, transaction);
      }
    });
    await dependencies.workspaces.seal(workspace.id, context);
    return Object.freeze({ candidate, repair });
  } catch (error) {
    await dependencies.workspaces.discard(workspace.id, context);
    throw error;
  }
}
