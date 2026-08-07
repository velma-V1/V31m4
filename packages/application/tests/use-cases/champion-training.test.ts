import {
  ArtifactId,
  CapabilityId,
  CapabilityProfile,
  EvidenceId,
  MissionId,
  TrainingPacket,
  TrainingPacketId,
} from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  compileTrainingPacket,
  deliverResult,
  promoteCapability,
  selectChampionUseCase,
  WriteConditions,
} from "../../src/index.js";
import { makeVerification } from "../services/fixtures.js";
import { context, Harness, T0 } from "./fixtures.js";

const HASH = "b".repeat(64);

describe("champion, delivery, training, and promotion use cases", () => {
  it("stores a verified champion and complete delivery receipt", async () => {
    const harness = new Harness();
    const result = makeVerification("passed");
    const decision = await selectChampionUseCase(
      { unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository },
      {
        decisionId: "decision-1",
        missionId: MissionId.parse("mission-1"),
        decidedAt: T0,
        candidates: [
          {
            candidateId: result.candidateId,
            verification: result,
            metrics: {
              correctness: 1,
              coverage: 1,
              security: 1,
              performance: 0.8,
              complexity: 0.2,
              evidenceStrength: 1,
            },
            unresolvedCriticalRisks: [],
            evidenceIds: result.evidenceIds,
          },
        ],
      },
      context,
    );
    expect(decision.value.decision).toBe("champion");
    const receipt = await deliverResult(
      {
        unitOfWork: harness.unitOfWork,
        candidates: harness.candidateRepository,
        clock: harness.clock,
      },
      {
        receiptId: "receipt-1",
        decision: decision.value,
        deliveredArtifactIds: [ArtifactId.parse("artifact-output-1")],
        requirementsCovered: 1,
        requirementsTotal: 1,
        mandatoryChecksPassed: 1,
        mandatoryChecksTotal: 1,
        unresolvedRiskIds: [],
        evidenceIds: [...decision.value.evidenceIds],
      },
      context,
    );
    expect(receipt.value.requirementsCovered).toBe(1);
  });

  it("keeps learning quarantined until verification, then promotes it with evidence-backed capability history", async () => {
    const harness = new Harness();
    const packet = await compileTrainingPacket(
      { unitOfWork: harness.unitOfWork, training: harness.trainingStore },
      {
        id: "packet-1",
        missionId: "mission-1",
        taskArtifactId: "artifact-task-1",
        contextArtifactIds: ["artifact-context-1"],
        originalCandidateIds: ["candidate-1", "candidate-2"],
        preferredCandidateId: "candidate-1",
        rejectedCandidateIds: ["candidate-2"],
        issueIds: [],
        repairIds: [],
        verificationEvidenceIds: ["evidence-training-1"],
        trainingViews: [{ kind: "sft", artifactId: "artifact-view-1" }],
        provenanceHash: HASH,
        evaluationLeakageChecked: true,
      },
      context,
    );
    expect(packet.value.status).toBe("quarantined");
    const verified = TrainingPacket.markVerified(packet.value);
    await harness.unitOfWork.execute(context, (transaction) =>
      harness.trainingStore.save(
        verified,
        WriteConditions.matchRevision(packet.revision),
        context,
        transaction,
      ),
    );
    const profile = CapabilityProfile.create({
      capabilityId: "capability-1",
      displayName: "Capability One",
      domain: "software",
      initialScore: {
        capabilityId: "capability-1",
        score: 0.4,
        sampleSize: 4,
        difficultyRange: [0.2, 0.7],
        evidenceIds: ["evidence-old-1"],
        measuredAt: T0,
      },
    });
    harness.capabilities.set("capability-1", { value: profile, revision: "1" });
    const promotion = await promoteCapability(
      {
        unitOfWork: harness.unitOfWork,
        capabilities: harness.capabilityRepository,
        training: harness.trainingStore,
        clock: harness.clock,
      },
      {
        promotionId: "promotion-1",
        capabilityId: CapabilityId.parse("capability-1"),
        sourcePacketIds: [TrainingPacketId.parse("packet-1")],
        heldOutEvidenceIds: ["evidence-held-out"],
        regressionEvidenceIds: ["evidence-regression"],
        measurements: [
          {
            evidenceId: EvidenceId.parse("evidence-observation-1"),
            outcomeScore: 1,
            difficulty: 0.8,
            measuredAt: T0,
            source: "production",
            verified: true,
            evaluationLeakage: false,
          },
          {
            evidenceId: EvidenceId.parse("evidence-observation-2"),
            outcomeScore: 0.8,
            difficulty: 0.7,
            measuredAt: T0,
            source: "production",
            verified: true,
            evaluationLeakage: false,
          },
        ],
        minimumSampleSize: 2,
      },
      context,
    );
    expect(promotion.promotion.value.decision).toBe("promoted");
    expect(harness.packets.get("packet-1")?.value.status).toBe("promoted");
    expect(harness.capabilities.get("capability-1")?.value.history).toHaveLength(2);
  });
});
