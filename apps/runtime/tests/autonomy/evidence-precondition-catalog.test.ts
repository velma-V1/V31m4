import type { PreconditionRequirement } from "@v31m4/application";
import type { TaskPhase } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  PRECONDITION_RESOURCE_KINDS,
  resolveEvidencePrecondition,
} from "../../src/autonomy/evidence-precondition-catalog.js";
import { operationsProducing } from "../../src/autonomy/governed-observation.js";
import {
  getSemanticOperation,
  SEMANTIC_OPERATION_IDS,
  type SemanticOperationId,
} from "../../src/autonomy/semantic-operation-catalog.js";

/**
 * Resolving one operation's evidence precondition.
 *
 * The predicate is over operation, task class, and risk — deterministic in all three, and derived
 * from the closed catalog rather than restated anywhere. Three properties are load-bearing: the
 * read path that produces evidence is never gated, every requirement is something the *current*
 * governed path can actually establish, and the raw escape hatch can never be cheaper than the
 * semantic operation it could impersonate.
 */
const PHASES: readonly TaskPhase[] = Object.freeze([
  "investigate",
  "plan",
  "execute",
  "verify",
  "repair",
]);

function resolve(operationId: SemanticOperationId, phase: TaskPhase = "execute") {
  return resolveEvidencePrecondition(getSemanticOperation(operationId), phase);
}

/** The operations that exist to establish facts; gating them would be the circular prerequisite. */
const PRODUCERS: ReadonlySet<string> = new Set(
  Object.values(PRECONDITION_RESOURCE_KINDS).flatMap((resourceKind) => [
    ...operationsProducing(resourceKind),
  ]),
);

function kinds(requirements: readonly PreconditionRequirement[]): string[] {
  return requirements
    .map((requirement) =>
      requirement.kind === "ledger_observation"
        ? requirement.resourceKind
        : `evidence:${requirement.subjectType}`,
    )
    .sort();
}

describe("every requirement is one the governed path can actually establish", () => {
  it("names no ledger observation that no governed operation produces", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      for (const phase of PHASES) {
        for (const requirement of resolve(operationId, phase).requirements) {
          if (requirement.kind !== "ledger_observation") continue;
          expect(
            operationsProducing(requirement.resourceKind).length,
            `${operationId} in ${phase} requires ${requirement.resourceKind}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never requires an observation only the blocked operation itself could produce", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      for (const phase of PHASES) {
        for (const requirement of resolve(operationId, phase).requirements) {
          if (requirement.kind !== "ledger_observation") continue;
          const producers = operationsProducing(requirement.resourceKind).filter(
            (producer) => producer !== operationId,
          );
          expect(
            producers.length,
            `${operationId} in ${phase} can only satisfy ${requirement.resourceKind} with itself`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("the investigation path stays open", () => {
  it("gates no operation that exists to produce a required observation", () => {
    expect([...PRODUCERS].sort()).toEqual(["browser.inspect", "code.inspect"]);
    for (const operationId of PRODUCERS) {
      for (const phase of PHASES) {
        expect(
          resolve(operationId as SemanticOperationId, phase).requirements,
          `${operationId} in ${phase}`,
        ).toHaveLength(0);
      }
    }
  });

  it("gates no read operation at all", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(operationId);
      if (definition.effectClass !== "read") continue;
      expect(resolve(operationId).requirements).toHaveLength(0);
    }
  });

  it("leaves the operations that produce evidence ungated in every task class", () => {
    for (const operationId of ["build.check", "test.targeted", "test.regression"] as const) {
      for (const phase of PHASES) {
        expect(resolve(operationId, phase).requirements).toHaveLength(0);
      }
    }
  });
});

describe("a consequential operation names exactly what it needs", () => {
  it("requires a current governed read of the workspace before a patch", () => {
    expect(kinds(resolve("code.patch").requirements)).toEqual([
      PRECONDITION_RESOURCE_KINDS.workspaceFile,
    ]);
    for (const requirement of resolve("code.patch").requirements) {
      expect(requirement.kind).toBe("ledger_observation");
      expect(
        requirement.kind === "ledger_observation" && requirement.requireCurrentFingerprint,
      ).toBe(true);
    }
  });

  it("requires an inspected target before verification, and never the reverse", () => {
    expect(kinds(resolve("browser.verify").requirements)).toEqual([
      PRECONDITION_RESOURCE_KINDS.browseTarget,
    ]);
    expect(resolve("browser.inspect").requirements).toHaveLength(0);
  });

  it("gates every high and critical risk operation without exception", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(operationId);
      if (definition.riskClass !== "high" && definition.riskClass !== "critical") continue;
      // A producer is the exception, and only because gating it would be circular by construction.
      if (PRODUCERS.has(operationId)) continue;
      expect(resolve(operationId).requirements.length, operationId).toBeGreaterThan(0);
    }
  });
});

describe("both canonical authorities are live", () => {
  it("consumes immutable EvidenceRecord semantics for the critical escape hatch", () => {
    const evidence = resolve("command.run").requirements.filter(
      (requirement) => requirement.kind === "evidence",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ subjectType: "acceptance_criterion", requirePassed: true });
    expect(evidence[0]?.kind === "evidence" ? [...evidence[0].allowedEvidenceKinds] : []).toContain(
      "unit_test",
    );
  });

  it("consumes current Ledger state alongside it", () => {
    expect(kinds(resolve("command.run").requirements)).toContain(
      PRECONDITION_RESOURCE_KINDS.workspaceFile,
    );
  });

  it("requires both together for a world-changing effect during repair", () => {
    const repair = resolve("code.patch", "repair").requirements;
    expect(repair.some((requirement) => requirement.kind === "evidence")).toBe(true);
    expect(repair.some((requirement) => requirement.kind === "ledger_observation")).toBe(true);
  });
});

describe("the raw escape hatch cannot be the cheap way round", () => {
  it("carries at least every requirement any executable operation carries", () => {
    const escapeHatch = new Set(kinds(resolve("command.run").requirements));
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      if (operationId === "command.run") continue;
      if (!getSemanticOperation(operationId).hasTrustedExecutionBinding) continue;
      for (const requirement of kinds(resolve(operationId).requirements)) {
        expect(escapeHatch.has(requirement), `${operationId} -> ${requirement}`).toBe(true);
      }
    }
  });

  it("is strictly stronger than the strongest operation it could impersonate", () => {
    expect(resolve("command.run").requirements.length).toBeGreaterThan(
      resolve("code.patch").requirements.length,
    );
  });

  it("inherits nothing from an operation nothing can execute, and everything once it can", () => {
    // `browser.verify` has no trusted execution binding, so it cannot be bypassed and contributes
    // nothing — requiring its prerequisite for a raw command would block execution for a reason
    // unrelated to risk. The declared binding is what decides, so the day it is bound it joins.
    expect(getSemanticOperation("browser.verify").hasTrustedExecutionBinding).toBe(false);
    expect(kinds(resolve("command.run").requirements)).not.toContain(
      PRECONDITION_RESOURCE_KINDS.browseTarget,
    );
  });
});

describe("the task class is part of the predicate", () => {
  it("requires verified task evidence before a world-changing effect during repair", () => {
    expect(kinds(resolve("code.patch", "repair").requirements)).toContain(
      "evidence:acceptance_criterion",
    );
    expect(kinds(resolve("code.patch", "execute").requirements)).not.toContain(
      "evidence:acceptance_criterion",
    );
  });

  it("does not impose the repair requirement on a read", () => {
    expect(resolve("code.inspect", "repair").requirements).toHaveLength(0);
  });

  it("names the operation, task class, and risk in the resolved policy id", () => {
    const policy = resolve("code.patch", "repair");
    expect(policy.policyId).toMatch(/evidence\.patch_requires_current_target\.v1/u);
    expect(policy.policyId).toMatch(/repair/u);
    expect(policy.policyId).toMatch(/high/u);
  });
});

describe("resolution is deterministic and immutable", () => {
  it("produces an identical frozen policy for identical inputs", () => {
    const first = resolve("code.patch", "repair");
    const second = resolve("code.patch", "repair");
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.requirements)).toBe(true);
  });

  it("de-duplicates a requirement inherited from more than one source", () => {
    const requirements = kinds(resolve("command.run", "repair").requirements);
    expect(new Set(requirements).size).toBe(requirements.length);
  });
});
