import {
  type ArtifactStorePort,
  type CandidateRepositoryPort,
  type CandidateVerificationOutcome,
  type EvidenceRepositoryPort,
  ImprovementPolicy,
  type ModelGatewayPort,
  type OperationContext,
  recordIssues,
  repairCandidate,
  type UnitOfWorkPort,
  type VerifierPort,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import {
  ArtifactId,
  type JobId,
  type ProjectId,
  SafePath,
  type SolverCandidate,
  type SolverConfiguration,
  type VerificationCheck,
  VerificationPlanId,
  VerificationResult,
} from "@v31m4/domain";
import { stableDigest } from "../job-command-helpers.js";
import { supervisedEvidenceId } from "./supervised-verifier.js";

const MAX_FAILURE_CONTEXT_BYTES = 16 * 1024;

export interface RepairOrchestratorDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly artifacts: ArtifactStorePort;
  readonly candidates: CandidateRepositoryPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly models: ModelGatewayPort;
  readonly verifier: VerifierPort;
  readonly workspaces: WorkspaceManagerPort;
  readonly applyWorkProduct: (candidate: SolverCandidate, round: number) => Promise<void>;
  readonly createBasePrompt: () => Promise<string>;
}

export interface RepairOrchestratorInput {
  readonly projectId: ProjectId;
  readonly jobId: JobId;
  readonly source: CandidateVerificationOutcome;
  readonly configuration: SolverConfiguration;
  readonly check: VerificationCheck;
  readonly maxRepairRounds: number;
  readonly resourceBudget: {
    readonly maxWallClockMs: number;
    readonly maxModelInvocations: number;
    readonly maxToolInvocations: number;
    readonly maxRepairRounds: number;
    readonly maxConcurrentWorkers: number;
  };
  readonly createdAt: string;
}

export interface RepairOrchestratorResult {
  readonly candidate: SolverCandidate;
  readonly verification: CandidateVerificationOutcome;
  readonly completedRounds: number;
}

/** Composes existing immutable issue/repair use cases around the supervised work-product bridge. */
export async function runBoundedRepairRounds(
  dependencies: RepairOrchestratorDependencies,
  input: RepairOrchestratorInput,
  context: OperationContext,
): Promise<RepairOrchestratorResult> {
  let current = input.source;
  let completedRounds = 0;
  while (current.result.status !== "passed" && completedRounds < input.maxRepairRounds) {
    const round = completedRounds + 1;
    const remaining = remainingBudget(input.resourceBudget, completedRounds);
    const issueId = `issue-${stableDigest(`${input.jobId}:repair:${round}`).slice(0, 32)}`;
    const decision = ImprovementPolicy.decide({
      proposals: [
        {
          issueId,
          severity: "high",
          concreteWeakness: current.evidence.map((record) => record.summary).join(" "),
          expectedBenefit: 1,
          verificationMethod: `Rerun independent check ${input.check.id}.`,
          kind: "repair",
          wordingOnly: false,
          priorFailedAttempts: completedRounds,
        },
      ],
      completedRounds,
      maxRepairRounds: input.maxRepairRounds,
      remainingBudget: remaining,
    });
    if (decision.outcome === "stop" || remaining.maxToolInvocations < 2) break;

    if ((await dependencies.candidates.getIssue(issueId as never, context)) === null) {
      await recordIssues(
        { unitOfWork: dependencies.unitOfWork, candidates: dependencies.candidates },
        current.candidate.id,
        [
          {
            id: issueId,
            title: `Independent verification failed in repair round ${round}`,
            exactDeficiency: current.evidence.map((record) => record.summary).join(" "),
            severity: "high",
            evidenceIds: current.evidence.map((record) => record.id),
            expectedConsequence: "The candidate cannot be selected or delivered.",
            proposedCorrection: "Apply a bounded change justified by the verifier evidence.",
            verificationMethod: `Rerun independent check ${input.check.id}.`,
            regressionRisk: "The mandatory independent check must remain authoritative.",
          },
        ],
        context,
      );
    }

    const identity = stableDigest(`${input.jobId}:repair:${round}`).slice(0, 32);
    const candidateId = `candidate-repair-${identity}`;
    const focusedPlan = repairPlan(`plan-focused-${identity}`, candidateId, input);
    const regressionPlan = repairPlan(`plan-regression-${identity}`, candidateId, input);
    const recovered = await recoverVerification(
      dependencies,
      candidateId,
      focusedPlan,
      regressionPlan,
      context,
    );
    if (recovered !== null) {
      current = recovered;
      completedRounds = round;
      continue;
    }

    const promptArtifactId = ArtifactId.parse(`artifact-repair-prompt-${identity}`);
    await writeRepairPrompt(dependencies, input, promptArtifactId, current, round, context);
    let applied = false;
    const applyingVerifier: VerifierPort = {
      supports: (verifierId, operation) => dependencies.verifier.supports(verifierId, operation),
      execute: async (plan, candidate, operation) => {
        if (!applied) {
          await dependencies.applyWorkProduct(candidate, round);
          applied = true;
        }
        return dependencies.verifier.execute(plan, candidate, operation);
      },
      cancel: (planId, operation) => dependencies.verifier.cancel(planId, operation),
    };
    const outcome = await repairCandidate(
      {
        unitOfWork: dependencies.unitOfWork,
        candidates: dependencies.candidates,
        evidence: dependencies.evidence,
        models: dependencies.models,
        verifier: applyingVerifier,
        workspaces: dependencies.workspaces,
      },
      {
        projectId: input.projectId,
        jobId: input.jobId,
        issueId: issueId as never,
        sourceCandidate: current.candidate,
        repairedCandidateId: candidateId,
        repairId: `repair-${identity}`,
        invocationId: `invocation-repair-${identity}`,
        promptArtifactId,
        configuration: input.configuration,
        focusedPlan,
        regressionPlan,
        createdAt: input.createdAt,
        resourceBudget: { ...remaining, maxModelInvocations: 1, maxToolInvocations: 2 },
      },
      context,
    );
    current = Object.freeze({
      candidate: outcome.candidate,
      result: outcome.regression.result,
      evidence: Object.freeze([...outcome.focused.evidence, ...outcome.regression.evidence]),
    });
    completedRounds = round;
  }
  return Object.freeze({ candidate: current.candidate, verification: current, completedRounds });
}

function remainingBudget(
  budget: RepairOrchestratorInput["resourceBudget"],
  completedRounds: number,
) {
  return Object.freeze({
    ...budget,
    maxModelInvocations: Math.max(0, budget.maxModelInvocations - completedRounds - 1),
    maxToolInvocations: Math.max(0, budget.maxToolInvocations - completedRounds * 2 - 1),
    maxRepairRounds: Math.max(0, budget.maxRepairRounds - completedRounds),
  });
}

function repairPlan(id: string, candidateId: string, input: RepairOrchestratorInput) {
  return VerificationResult.createPlan({
    id: VerificationPlanId.parse(id),
    missionId: input.source.candidate.missionId,
    candidateId,
    checks: [{ ...input.check }],
  });
}

async function recoverVerification(
  dependencies: RepairOrchestratorDependencies,
  candidateId: string,
  focusedPlan: ReturnType<typeof repairPlan>,
  regressionPlan: ReturnType<typeof repairPlan>,
  context: OperationContext,
): Promise<CandidateVerificationOutcome | null> {
  const stored = await dependencies.candidates.getCandidate(candidateId as never, context);
  if (stored === null) return null;
  const focused = await dependencies.evidence.getById(
    supervisedEvidenceId(focusedPlan.id, candidateId) as never,
    context,
  );
  const regression = await dependencies.evidence.getById(
    supervisedEvidenceId(regressionPlan.id, candidateId) as never,
    context,
  );
  if (focused === null || regression === null) return null;
  const result = VerificationResult.calculate({
    id: `verification-recovered-${stableDigest(candidateId).slice(0, 32)}`,
    plan: regressionPlan,
    completedChecks: [
      {
        checkId: regressionPlan.checks[0]?.id ?? "repair.regression",
        status: regression.value.status,
        evidenceIds: [regression.value.id],
      },
    ],
  });
  return Object.freeze({
    candidate: stored.value,
    result,
    evidence: Object.freeze([focused.value, regression.value]),
  });
}

async function writeRepairPrompt(
  dependencies: RepairOrchestratorDependencies,
  input: RepairOrchestratorInput,
  id: ArtifactId,
  verification: CandidateVerificationOutcome,
  round: number,
  context: OperationContext,
): Promise<void> {
  if ((await dependencies.artifacts.get(id, context)) !== null) return;
  const reports: string[] = [];
  for (const record of verification.evidence) {
    for (const artifactId of record.artifactIds) {
      reports.push(await readBoundedArtifact(dependencies.artifacts, artifactId, context));
    }
  }
  const text = [
    await dependencies.createBasePrompt(),
    `REPAIR ROUND ${round}`,
    "The previous candidate failed independent verification. Repair only the evidenced defect.",
    ...verification.evidence.map((record) => `Evidence ${record.id}: ${record.summary}`),
    ...reports.map((report) => `Verifier report:\n${report}`),
  ].join("\n\n");
  async function* bytes(): AsyncIterable<Uint8Array> {
    yield Buffer.from(text, "utf8");
  }
  await dependencies.unitOfWork.execute(context, async (transaction) => {
    await dependencies.artifacts.write(
      {
        id,
        projectId: input.projectId,
        jobId: input.jobId,
        kind: "document",
        logicalPath: SafePath.parse(`job-${input.jobId}/repair-${round}.txt`),
        mediaType: "text/plain",
        parentArtifactIds: verification.evidence.flatMap((record) => record.artifactIds),
        bytes: bytes(),
      },
      context,
      transaction,
    );
  });
}

async function readBoundedArtifact(
  artifacts: ArtifactStorePort,
  id: ArtifactId,
  context: OperationContext,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await artifacts.open(id, context)) {
    size += chunk.byteLength;
    if (size > MAX_FAILURE_CONTEXT_BYTES) break;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
