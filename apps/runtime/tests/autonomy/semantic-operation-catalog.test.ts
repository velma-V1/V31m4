import { ApplicationError } from "@v31m4/application";
import { ContentHash, SandboxId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  assertCodePatchTargetIsCurrent,
  assertSemanticEffectIsExecutable,
  assertSemanticOperationAllowedForRole,
  getSemanticOperation,
  parseCodePatchScope,
  SEMANTIC_OPERATION_CATALOG,
  SEMANTIC_OPERATION_IDS,
  type SemanticEffectExecutionRequest,
} from "../../src/autonomy/semantic-operation-catalog.js";

const EXPECTED_OPERATION_IDS = [
  "repo.map_task",
  "repo.search",
  "repo.symbol",
  "repo.references",
  "repo.impact",
  "repo.history",
  "code.inspect",
  "code.patch",
  "build.check",
  "test.targeted",
  "test.regression",
  "debug.reproduce",
  "failure.explain",
  "git.status",
  "git.diff",
  "git.history",
  "command.run",
  "browser.inspect",
  "browser.verify",
] as const;

const currentFingerprint = "a".repeat(64);
const otherFingerprint = "b".repeat(64);

function effectRequest(
  overrides: Partial<SemanticEffectExecutionRequest> = {},
): SemanticEffectExecutionRequest {
  return {
    operationId: "code.patch",
    role: "executor",
    policyDecision: "allow",
    assignedWorkspaceId: "workspace-1",
    sandboxId: SandboxId.parse("sandbox:1"),
    ...overrides,
  };
}

describe("semantic operation catalog", () => {
  it("exposes exactly the approved model-facing operation vocabulary", () => {
    expect([...SEMANTIC_OPERATION_IDS]).toEqual([...EXPECTED_OPERATION_IDS]);
    expect(Object.keys(SEMANTIC_OPERATION_CATALOG).sort()).toEqual(
      [...EXPECTED_OPERATION_IDS].sort(),
    );
  });

  it("gives the model no worktree or workspace-lifecycle authority", () => {
    for (const forbidden of [
      "git.worktree",
      "git.clone",
      "git.commit",
      "git.push",
      "workspace.create",
    ]) {
      expect((SEMANTIC_OPERATION_IDS as readonly string[]).includes(forbidden)).toBe(false);
      expect(() => getSemanticOperation(forbidden)).toThrow(ApplicationError);
    }
  });

  it("encodes the full definition required by the autonomy architecture", () => {
    for (const id of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(id);
      expect(definition.operationId).toBe(id);
      expect(definition.inputSchemaVersion).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(definition.resultSchemaVersion).toMatch(/^\d+\.\d+\.\d+$/u);
      expect([
        "read",
        "workspace_write",
        "process_execute",
        "network_read",
        "network_effect",
      ]).toContain(definition.effectClass);
      expect(["low", "moderate", "high", "critical"]).toContain(definition.riskClass);
      expect(["none", "required"]).toContain(definition.sandboxRequirement);
      expect(definition.allowedRoles.length).toBeGreaterThan(0);
      expect(definition.evidencePreconditionPolicyId).toMatch(/^evidence\./u);
      expect(definition.resourcePolicy.maxWallClockMs).toBeGreaterThan(0);
      expect(Object.isFrozen(definition)).toBe(true);
    }
  });

  it("keeps role permissions operation-level and the auditor read-only", () => {
    for (const id of SEMANTIC_OPERATION_IDS) {
      const definition = getSemanticOperation(id);
      if (definition.effectClass === "read") {
        expect(definition.allowedRoles).toContain("auditor");
      } else {
        expect(definition.allowedRoles).not.toContain("auditor");
        expect(definition.allowedRoles).not.toContain("manager");
        expect(definition.sandboxRequirement).toBe("required");
      }
    }
    expect(() => assertSemanticOperationAllowedForRole("code.patch", "auditor")).toThrow(
      ApplicationError,
    );
    expect(() => assertSemanticOperationAllowedForRole("command.run", "manager")).toThrow(
      ApplicationError,
    );
    expect(assertSemanticOperationAllowedForRole("repo.search", "auditor").operationId).toBe(
      "repo.search",
    );
  });

  it("classifies raw command.run as the highest-risk sandboxed escape hatch", () => {
    const commandRun = getSemanticOperation("command.run");
    expect(commandRun.effectClass).toBe("process_execute");
    expect(commandRun.riskClass).toBe("critical");
    expect(commandRun.sandboxRequirement).toBe("required");
  });
});

describe("code.patch staleness contract", () => {
  it("requires an expected fingerprint and an explicit path scope", () => {
    const scope = parseCodePatchScope({
      expectedFingerprint: currentFingerprint,
      pathScope: ["src/index.ts"],
      patch: "--- a\n+++ b\n",
    });
    expect(scope.expectedFingerprint).toBe(currentFingerprint);
    expect(scope.pathScope).toEqual(["src/index.ts"]);

    for (const parameters of [
      { pathScope: ["src/index.ts"], patch: "x" },
      { expectedFingerprint: currentFingerprint, patch: "x" },
      { expectedFingerprint: "not-a-hash", pathScope: ["src/index.ts"], patch: "x" },
      { expectedFingerprint: currentFingerprint, pathScope: [], patch: "x" },
      { expectedFingerprint: currentFingerprint, pathScope: ["../escape.ts"], patch: "x" },
      { expectedFingerprint: currentFingerprint, pathScope: ["/abs.ts"], patch: "x" },
      { expectedFingerprint: currentFingerprint, pathScope: ["src/index.ts"] },
    ]) {
      expect(() => parseCodePatchScope(parameters)).toThrow(ApplicationError);
    }
  });

  it("rejects a stale edit rather than silently overwriting newer work", () => {
    const scope = parseCodePatchScope({
      expectedFingerprint: currentFingerprint,
      pathScope: ["src/index.ts"],
      patch: "--- a\n+++ b\n",
    });
    expect(() =>
      assertCodePatchTargetIsCurrent(scope, ContentHash.parse(currentFingerprint)),
    ).not.toThrow();
    let thrown: unknown;
    try {
      assertCodePatchTargetIsCurrent(scope, ContentHash.parse(otherFingerprint));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as ApplicationError).code).toBe("CONFLICT");
  });
});

describe("no model-direct effect bypass", () => {
  it("permits a governed effect only with policy, an assigned workspace, and a sandbox", () => {
    expect(() => assertSemanticEffectIsExecutable(effectRequest())).not.toThrow();

    for (const override of [
      { policyDecision: "deny" as const },
      { policyDecision: "require_approval" as const },
      { assignedWorkspaceId: null },
      { sandboxId: null },
    ]) {
      let thrown: unknown;
      try {
        assertSemanticEffectIsExecutable(effectRequest(override));
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(override)).toBeInstanceOf(ApplicationError);
      expect(["PERMISSION_DENIED", "POLICY_REJECTED", "APPROVAL_REQUIRED"]).toContain(
        (thrown as ApplicationError).code,
      );
    }
  });

  it("still allows read operations to acquire the evidence an effect needs", () => {
    expect(() =>
      assertSemanticEffectIsExecutable(
        effectRequest({
          operationId: "repo.search",
          role: "manager",
          assignedWorkspaceId: "workspace-1",
          sandboxId: null,
        }),
      ),
    ).not.toThrow();
  });

  it("refuses an unknown operation before any execution path is reached", () => {
    expect(() =>
      assertSemanticEffectIsExecutable(effectRequest({ operationId: "git.worktree" })),
    ).toThrow(ApplicationError);
  });
});
