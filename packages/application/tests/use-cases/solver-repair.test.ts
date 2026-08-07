import { ArtifactId, CandidateId, IssueId, JobId, MissionId, ModelId, ProjectId, ToolId, VerificationResult } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { recordIssues, repairCandidate, runSolverForge, verifyCandidates } from "../../src/index.js";
import { Harness, T0, budget, context } from "./fixtures.js";

function configuration() {
  return { modelId: ModelId.parse("model-1"), strategy: "failure_first" as const, contextArtifactIds: [ArtifactId.parse("context-1")], toolIds: [ToolId.parse("tool-1")], constraints: ["Preserve architecture."] };
}

function plan(id: string, candidateId: string) {
  return VerificationResult.createPlan({ id, missionId: "mission-1", candidateId, checks: [{ id: `check-${id}`, criterionIds: ["criterion-1"], verifierId: "verifier-1", kind: "unit_test", mandatory: true, hidden: false, timeoutMs: 1_000 }] });
}

describe("solver, verification, issue, and repair use cases", () => {
  it("stores immutable candidates and independent verification evidence", async () => {
    const harness = new Harness();
    const candidates = await runSolverForge({ unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository, models: harness.modelGateway, workspaces: harness.workspaces }, { jobId: JobId.parse("job-1"), missionId: MissionId.parse("mission-1"), projectId: ProjectId.parse("project-1"), promptArtifactId: ArtifactId.parse("prompt-1"), configurations: [configuration()], candidateIds: ["candidate-1"], invocationIds: ["invoke-1"], createdAt: T0, resourceBudget: budget() }, context);
    const outcomes = await verifyCandidates({ unitOfWork: harness.unitOfWork, evidence: harness.evidenceRepository, verifier: harness.verifier }, [{ plan: plan("plan-1", "candidate-1"), candidate: candidates[0]! }], context);
    expect(outcomes[0]?.result.status).toBe("passed");
    expect(harness.evidenceRecords.size).toBe(1);
  });

  it("records an issue and persists a verified targeted repair", async () => {
    const harness = new Harness();
    const source = (await runSolverForge({ unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository, models: harness.modelGateway, workspaces: harness.workspaces }, { jobId: JobId.parse("job-1"), missionId: MissionId.parse("mission-1"), projectId: ProjectId.parse("project-1"), promptArtifactId: ArtifactId.parse("prompt-1"), configurations: [configuration()], candidateIds: ["candidate-1"], invocationIds: ["invoke-1"], createdAt: T0, resourceBudget: budget() }, context))[0]!;
    await recordIssues({ unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository }, CandidateId.parse("candidate-1"), [{ id: "issue-1", title: "Defect", exactDeficiency: "Output fails a required case.", severity: "high", evidenceIds: ["evidence-issue-1"], expectedConsequence: "Incorrect output.", proposedCorrection: "Repair exact case.", verificationMethod: "unit", regressionRisk: "Low" }], context);
    const outcome = await repairCandidate({ unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository, evidence: harness.evidenceRepository, models: harness.modelGateway, verifier: harness.verifier, workspaces: harness.workspaces }, { projectId: ProjectId.parse("project-1"), jobId: JobId.parse("job-1"), issueId: IssueId.parse("issue-1"), sourceCandidate: source, repairedCandidateId: "candidate-2", repairId: "repair-1", invocationId: "invoke-repair", promptArtifactId: ArtifactId.parse("prompt-repair"), configuration: configuration(), focusedPlan: plan("focused", "candidate-2"), regressionPlan: plan("regression", "candidate-2"), createdAt: T0, resourceBudget: budget() }, context);
    expect(outcome.repair.status).toBe("passed");
    expect(harness.issues.get("issue-1")?.value.status).toBe("repaired");
    expect(harness.evidenceRecords.size).toBe(2);
  });
});
