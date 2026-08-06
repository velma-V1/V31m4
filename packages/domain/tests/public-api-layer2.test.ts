import { describe, expect, it } from "vitest";
import * as domain from "../src/index.js";

describe("Layer 2 public API", () => {
  it("exports every durable entity and extended identifier parser", () => {
    const expected = [
      "Artifact",
      "AvatarState",
      "CapabilityProfile",
      "ChampionDecision",
      "Checkpoint",
      "Claim",
      "DeliveryReceipt",
      "EvidenceRecord",
      "IssueRecord",
      "Job",
      "MissionContract",
      "ModelProfile",
      "PluginProfile",
      "PracticeTask",
      "ProductionTwin",
      "Project",
      "PromotionRecord",
      "RepairRecord",
      "Requirement",
      "SolverCandidate",
      "ToolProfile",
      "TrainingPacket",
      "VerificationResult",
      "AchievementRuleId",
      "AvatarId",
      "ClaimId",
      "DeliveryReceiptId",
      "PracticeTaskId",
      "PromotionId",
      "RepairId",
      "TrainingPacketId",
      "TwinEdgeId",
      "TwinNodeId",
      "VerificationPlanId",
      "VerificationResultId",
    ] as const;

    for (const exportName of expected) {
      expect(domain).toHaveProperty(exportName);
    }
  });
});
