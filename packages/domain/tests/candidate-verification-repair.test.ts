import { describe, expect, it } from "vitest";
import {
  DomainError,
  IssueRecord,
  RepairRecord,
  SolverCandidate,
  VerificationResult,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";

describe("candidate, verification, issue, and repair domain", () => {
  it("preserves original and reconstructed candidate lineage", () => {
    const original = SolverCandidate.createOriginal({
      id: "candidate-1",
      missionId: "mission-1",
      configuration: {
        modelId: "model-1",
        strategy: "clean_room",
        contextArtifactIds: ["artifact-context"],
        toolIds: ["tool-1"],
        seed: 1,
        constraints: ["Do not inspect another candidate."],
      },
      responseArtifactId: "artifact-response",
      outputArtifactIds: ["artifact-output"],
      toolTraceArtifactId: "artifact-trace",
      createdAt: T0,
    });
    const repaired = SolverCandidate.createReconstructed(
      {
        id: "candidate-2",
        missionId: "mission-1",
        configuration: {
          modelId: "model-1",
          strategy: "minimal_change",
          contextArtifactIds: ["artifact-context"],
        },
        responseArtifactId: "artifact-repair-response",
        outputArtifactIds: ["artifact-repaired-output"],
        createdAt: "2026-08-06T20:01:00.000Z",
      },
      [original.id],
    );

    expect(original.original).toBe(true);
    expect(repaired.parentCandidateIds).toEqual(["candidate-1"]);
  });

  it("rejects reconstructed candidates without parents", () => {
    expect(() =>
      SolverCandidate.createReconstructed(
        {
          id: "candidate-2",
          missionId: "mission-1",
          configuration: {
            modelId: "model-1",
            strategy: "minimal_change",
            contextArtifactIds: [],
          },
          responseArtifactId: "artifact-response",
          outputArtifactIds: ["artifact-output"],
          createdAt: T0,
        },
        [],
      ),
    ).toThrowError(DomainError);
  });

  it("calculates failed, inconclusive, and passing verification results", () => {
    const plan = VerificationResult.createPlan({
      id: "verification-plan-1",
      missionId: "mission-1",
      candidateId: "candidate-1",
      checks: [
        {
          id: "check-required",
          criterionIds: ["criterion-1"],
          verifierId: "vitest",
          kind: "unit_test",
          mandatory: true,
          hidden: false,
          timeoutMs: 1000,
        },
        {
          id: "check-optional",
          criterionIds: ["criterion-2"],
          verifierId: "benchmark",
          kind: "benchmark",
          mandatory: false,
          hidden: false,
          timeoutMs: 1000,
        },
      ],
    });

    const failed = VerificationResult.calculate({
      id: "verification-result-1",
      plan,
      completedChecks: [
        {
          checkId: "check-required",
          status: "failed",
          evidenceIds: ["evidence-1"],
        },
      ],
    });
    const inconclusive = VerificationResult.calculate({
      id: "verification-result-2",
      plan,
      completedChecks: [
        {
          checkId: "check-optional",
          status: "passed",
          evidenceIds: ["evidence-2"],
        },
      ],
    });
    const passed = VerificationResult.calculate({
      id: "verification-result-3",
      plan,
      completedChecks: [
        {
          checkId: "check-required",
          status: "passed",
          evidenceIds: ["evidence-3"],
        },
        {
          checkId: "check-optional",
          status: "passed",
          evidenceIds: ["evidence-4"],
        },
      ],
    });

    expect(failed.status).toBe("failed");
    expect(inconclusive.status).toBe("inconclusive");
    expect(passed.status).toBe("passed");
  });

  it("requires accepted issues and evidence-backed repair results", () => {
    const issue = IssueRecord.create({
      id: "issue-1",
      candidateId: "candidate-1",
      title: "Missing invariant",
      exactDeficiency: "The output accepts an invalid state.",
      severity: "high",
      evidenceIds: ["evidence-1"],
      expectedConsequence: "Invalid state can enter persistence.",
      proposedCorrection: "Add a domain guard.",
      verificationMethod: "Run the failing property test.",
      regressionRisk: "Existing valid inputs could be rejected.",
    });
    const accepted = IssueRecord.accept(issue);
    const repairedIssue = IssueRecord.markRepaired(accepted);
    const repair = RepairRecord.create({
      id: "repair-1",
      issueId: repairedIssue.id,
      sourceCandidateId: "candidate-1",
      repairedCandidateId: "candidate-2",
      changedArtifactIds: ["artifact-output"],
      focusedEvidenceIds: ["evidence-focused"],
      regressionEvidenceIds: ["evidence-regression"],
      status: "passed",
    });

    expect(repairedIssue.status).toBe("repaired");
    expect(repair.status).toBe("passed");
  });
});
