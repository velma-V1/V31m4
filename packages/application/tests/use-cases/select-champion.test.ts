import { MissionId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { selectChampionUseCase } from "../../src/index.js";
import { makeVerification } from "../services/fixtures.js";
import { context, Harness, T0 } from "./fixtures.js";

/**
 * Regression coverage for a defect found while proving the negative-verification path: when no
 * candidate qualifies, `selectChampion` (the pure service) returns a `no_verified_solution` reason
 * with empty `evidenceIds` (it is a summary statement, not attributed to one candidate), but
 * `ChampionDecision.create` unconditionally requires every decision - including a no-solution one -
 * to carry non-empty, reason-consistent evidence. Before the fix, `selectChampionUseCase` passed
 * that empty array straight through, so the entire no_verified_solution path threw
 * INVALID_CHAMPION_DECISION and could never actually produce a decision record.
 */
describe("selectChampionUseCase no-verified-solution path", () => {
  it("produces a durable no_verified_solution decision instead of throwing when no candidate qualifies", async () => {
    const harness = new Harness();
    const verification = makeVerification("failed");
    const decision = await selectChampionUseCase(
      { unitOfWork: harness.unitOfWork, candidates: harness.candidateRepository },
      {
        decisionId: "decision-no-solution-1",
        missionId: MissionId.parse("mission-1"),
        decidedAt: T0,
        candidates: [
          {
            candidateId: verification.candidateId,
            verification,
            metrics: {
              correctness: 0,
              coverage: 0,
              security: 1,
              performance: 1,
              complexity: 0,
              evidenceStrength: 0,
            },
            unresolvedCriticalRisks: [],
            evidenceIds: [...verification.evidenceIds],
          },
        ],
      },
      context,
    );

    expect(decision.value.decision).toBe("no_verified_solution");
    expect(decision.value.candidateId).toBeUndefined();
    expect(decision.value.paretoCandidateIds).toEqual([]);
    // The decision must reference real evidence (the failed verification's), not be empty.
    expect(decision.value.evidenceIds.length).toBeGreaterThan(0);
    expect(decision.value.evidenceIds).toEqual([...verification.evidenceIds]);
    // Every rationale reason must reference evidence included in the decision (the domain's own
    // invariant); this is what previously threw before the fix.
    for (const reason of decision.value.rationale) {
      expect(reason.evidenceIds.length).toBeGreaterThan(0);
      for (const id of reason.evidenceIds) {
        expect(decision.value.evidenceIds).toContain(id);
      }
    }

    const stored = await harness.candidateRepository.getChampionDecision(
      decision.value.missionId,
      context,
    );
    expect(stored?.value.decision).toBe("no_verified_solution");
  });
});
