import type { PreconditionRequirement } from "@v31m4/application";
import type { TaskPhase } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  PRECONDITION_RESOURCE_KINDS,
  resolveEvidencePrecondition,
} from "../../src/autonomy/evidence-precondition-catalog.js";
import {
  getSemanticOperation,
  SEMANTIC_OPERATION_IDS,
  type SemanticOperationId,
} from "../../src/autonomy/semantic-operation-catalog.js";

/**
 * Resolving one operation's evidence precondition.
 *
 * The predicate is over operation, task class, and risk — deterministic in all three, and derived
 * from the closed catalog rather than restated anywhere. Two properties are load-bearing: the read
 * path that produces evidence is never gated, and the raw escape hatch can never be cheaper than
 * the semantic operation it could impersonate.
 */
function resolve(operationId: SemanticOperationId, phase: TaskPhase = "execute") {
  return resolveEvidencePrecondition(getSemanticOperation(operationId), phase);
}

function kinds(requirements: readonly PreconditionRequirement[]): string[] {
  return requirements
    .map((requirement) =>
      requirement.kind === "ledger_observation"
        ? requirement.resourceKind
        : `evidence:${requirement.subjectType}`,
    )
    .sort();
}

describe("the investigation path stays open", () => {
  it("gates no read operation, so missing evidence can always be acquired", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(operationId);
      if (definition.effectClass !== "read") continue;
      expect(resolve(operationId).requirements).toHaveLength(0);
    }
  });

  it("leaves the check and test operations that produce evidence ungated", () => {
    for (const operationId of ["build.check", "test.targeted", "test.regression"] as const) {
      expect(resolve(operationId).requirements).toHaveLength(0);
    }
  });
});

describe("a consequential operation names exactly what it needs", () => {
  it("requires current definition, impact, and test prerequisites before a patch", () => {
    expect(kinds(resolve("code.patch").requirements)).toEqual([
      PRECONDITION_RESOURCE_KINDS.impactAnalysis,
      PRECONDITION_RESOURCE_KINDS.symbolDefinition,
      PRECONDITION_RESOURCE_KINDS.testSelection,
    ]);
    for (const requirement of resolve("code.patch").requirements) {
      expect(requirement.kind).toBe("ledger_observation");
      expect(
        requirement.kind === "ledger_observation" && requirement.requireCurrentFingerprint,
      ).toBe(true);
    }
  });

  it("requires a current target before a browser path is taken", () => {
    for (const operationId of ["browser.inspect", "browser.verify"] as const) {
      expect(kinds(resolve(operationId).requirements)).toEqual([
        PRECONDITION_RESOURCE_KINDS.verificationTarget,
      ]);
    }
  });

  it("gates every high and critical risk operation without exception", () => {
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(operationId);
      if (definition.riskClass !== "high" && definition.riskClass !== "critical") continue;
      expect(resolve(operationId).requirements.length).toBeGreaterThan(0);
    }
  });
});

describe("the raw escape hatch cannot be the cheap way round", () => {
  it("carries at least every requirement any other operation carries", () => {
    const escapeHatch = new Set(kinds(resolve("command.run").requirements));
    for (const operationId of SEMANTIC_OPERATION_IDS) {
      if (operationId === "command.run") continue;
      for (const requirement of kinds(resolve(operationId).requirements)) {
        expect(escapeHatch.has(requirement)).toBe(true);
      }
    }
  });

  it("carries a requirement of its own beyond the union it inherits", () => {
    expect(kinds(resolve("command.run").requirements)).toContain(
      PRECONDITION_RESOURCE_KINDS.failureReport,
    );
  });

  it("is strictly stronger than the strongest semantic operation it could impersonate", () => {
    expect(resolve("command.run").requirements.length).toBeGreaterThan(
      resolve("code.patch").requirements.length,
    );
  });
});

describe("the task class is part of the predicate", () => {
  it("requires a current failure before an effect is attempted during repair", () => {
    expect(kinds(resolve("code.patch", "repair").requirements)).toContain(
      PRECONDITION_RESOURCE_KINDS.failureReport,
    );
    expect(kinds(resolve("code.patch", "execute").requirements)).not.toContain(
      PRECONDITION_RESOURCE_KINDS.failureReport,
    );
  });

  it("does not impose the repair requirement on a read", () => {
    expect(resolve("code.inspect", "repair").requirements).toHaveLength(0);
  });

  it("leaves the operations that produce a failure report ungated in every task class", () => {
    for (const operationId of ["build.check", "test.targeted", "test.regression"] as const) {
      for (const phase of ["execute", "repair", "verify", "investigate"] as const) {
        expect(resolve(operationId, phase).requirements).toHaveLength(0);
      }
    }
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
