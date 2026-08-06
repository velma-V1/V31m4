import { describe, expect, it } from "vitest";
import {
  Artifact,
  Claim,
  DomainError,
  EvidenceRecord,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";
const T1 = "2026-08-06T20:01:00.000Z";
const HASH = "b".repeat(64);

describe("artifact, evidence, and claim domain", () => {
  it("creates immutable content-addressed artifact metadata", () => {
    const artifact = Artifact.create({
      id: "artifact-1",
      projectId: "project-1",
      kind: "source",
      logicalPath: "packages/domain/src/index.ts",
      contentHash: HASH,
      byteSize: 128,
      mediaType: "text/typescript",
      createdAt: T0,
    });

    expect(artifact.contentHash).toBe(HASH);
    expect(Object.isFrozen(artifact.parentArtifactIds)).toBe(true);
  });

  it("prevents self-parent artifact lineage", () => {
    expect(() =>
      Artifact.create({
        id: "artifact-1",
        projectId: "project-1",
        kind: "source",
        logicalPath: "packages/domain/src/index.ts",
        contentHash: HASH,
        byteSize: 128,
        mediaType: "text/typescript",
        createdAt: T0,
        parentArtifactIds: ["artifact-1"],
      }),
    ).toThrowError(DomainError);
  });

  it("creates append-only evidence that references artifacts", () => {
    const evidence = EvidenceRecord.create({
      id: "evidence-1",
      projectId: "project-1",
      kind: "unit_test",
      subjectType: "domain-entity",
      subjectId: "project",
      status: "passed",
      summary: "Project lifecycle tests passed.",
      artifactIds: ["artifact-report"],
      verifierId: "vitest",
      verifierVersion: "4.1.10",
      createdAt: T0,
    });

    expect(evidence.immutable).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("moves a claim from proposed to evidence-backed status", () => {
    const claim = Claim.create({
      id: "claim-1",
      projectId: "project-1",
      statement: "The domain layer passes its tests.",
      createdAt: T0,
    });
    const supported = Claim.evaluate(claim, "supported", ["evidence-1"], T1);

    expect(claim.status).toBe("proposed");
    expect(supported.status).toBe("supported");
    expect(supported.evidenceIds).toEqual(["evidence-1"]);
  });
});
