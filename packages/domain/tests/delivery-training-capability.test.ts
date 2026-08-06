import { describe, expect, it } from "vitest";
import {
  ChampionDecision,
  DeliveryReceipt,
  DomainError,
  PromotionRecord,
  TrainingPacket,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";
const HASH = "c".repeat(64);

describe("decision, delivery, training, and promotion domain", () => {
  it("creates champion and no-solution decisions", () => {
    const champion = ChampionDecision.createChampion({
      id: "decision-1",
      missionId: "mission-1",
      candidateId: "candidate-1",
      paretoCandidateIds: ["candidate-1"],
      evidenceIds: ["evidence-1"],
      rationale: [
        {
          dimension: "correctness",
          statement: "All mandatory checks passed.",
          evidenceIds: ["evidence-1"],
        },
      ],
      decidedAt: T0,
    });
    const noSolution = ChampionDecision.createNoVerifiedSolution({
      id: "decision-2",
      missionId: "mission-1",
      paretoCandidateIds: [],
      evidenceIds: ["evidence-2"],
      rationale: [
        {
          dimension: "correctness",
          statement: "Every candidate failed a mandatory check.",
          evidenceIds: ["evidence-2"],
        },
      ],
      decidedAt: T0,
    });

    expect(champion.candidateId).toBe("candidate-1");
    expect(noSolution.decision).toBe("no_verified_solution");
  });

  it("requires complete coverage for champion delivery", () => {
    expect(() =>
      DeliveryReceipt.create({
        id: "receipt-1",
        missionId: "mission-1",
        decision: "champion",
        deliveredArtifactIds: ["artifact-output"],
        requirementsCovered: 1,
        requirementsTotal: 2,
        mandatoryChecksPassed: 2,
        mandatoryChecksTotal: 2,
        evidenceIds: ["evidence-1"],
        createdAt: T0,
      }),
    ).toThrowError(DomainError);

    const receipt = DeliveryReceipt.create({
      id: "receipt-1",
      missionId: "mission-1",
      decision: "champion",
      deliveredArtifactIds: ["artifact-output"],
      requirementsCovered: 2,
      requirementsTotal: 2,
      mandatoryChecksPassed: 2,
      mandatoryChecksTotal: 2,
      evidenceIds: ["evidence-1"],
      createdAt: T0,
    });
    expect(receipt.decision).toBe("champion");
  });

  it("enforces training quarantine, leakage checks, and promotion order", () => {
    const unchecked = TrainingPacket.createQuarantined({
      id: "packet-unchecked",
      missionId: "mission-1",
      taskArtifactId: "artifact-task",
      contextArtifactIds: ["artifact-context"],
      originalCandidateIds: ["candidate-1", "candidate-2"],
      preferredCandidateId: "candidate-1",
      rejectedCandidateIds: ["candidate-2"],
      verificationEvidenceIds: ["evidence-1"],
      trainingViews: [{ kind: "preference", artifactId: "artifact-view" }],
      provenanceHash: HASH,
      evaluationLeakageChecked: false,
    });
    expect(() => TrainingPacket.markVerified(unchecked)).toThrowError(DomainError);

    const packet = TrainingPacket.createQuarantined({
      id: "packet-1",
      missionId: "mission-1",
      taskArtifactId: "artifact-task",
      contextArtifactIds: ["artifact-context"],
      originalCandidateIds: ["candidate-1", "candidate-2"],
      preferredCandidateId: "candidate-3",
      rejectedCandidateIds: ["candidate-2"],
      issueIds: ["issue-1"],
      repairIds: ["repair-1"],
      verificationEvidenceIds: ["evidence-1"],
      trainingViews: [
        { kind: "preference", artifactId: "artifact-view" },
        { kind: "repair", artifactId: "artifact-repair-view" },
      ],
      provenanceHash: HASH,
      evaluationLeakageChecked: true,
    });
    const verified = TrainingPacket.markVerified(packet);
    const promoted = TrainingPacket.promote(verified);

    expect(packet.status).toBe("quarantined");
    expect(promoted.status).toBe("promoted");
  });

  it("requires held-out and regression evidence for promotion records", () => {
    const record = PromotionRecord.create({
      id: "promotion-1",
      capabilityId: "capability-domain",
      sourcePacketIds: ["packet-1"],
      heldOutEvidenceIds: ["evidence-held-out"],
      regressionEvidenceIds: ["evidence-regression"],
      decision: "promoted",
      createdAt: T0,
    });
    expect(record.decision).toBe("promoted");
  });
});
