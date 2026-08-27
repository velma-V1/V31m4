import { ApplicationError } from "@v31m4/application";
import { ContentHash } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  assertCodePatchTargetIsCurrent,
  assertSemanticOperationAllowedForRole,
  getSemanticOperation,
  parseCodePatchScope,
  SEMANTIC_OPERATION_CATALOG,
  SEMANTIC_OPERATION_IDS,
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

  it("lets exactly one operation carry a caller-supplied command", () => {
    const commandable = SEMANTIC_OPERATION_IDS.filter(
      (id) => getSemanticOperation(id).allowsCallerSuppliedCommand,
    );
    expect(commandable).toEqual(["command.run"]);
  });
});

describe("code.patch staleness contract", () => {
  it("requires an expected fingerprint and an explicit path scope", () => {
    const valid = {
      expectedFingerprint: currentFingerprint,
      targetPath: "src/index.ts",
      pathScope: ["src/index.ts"],
      patch: "--- a\n+++ b\n",
    };
    const scope = parseCodePatchScope(valid);
    expect(scope.expectedFingerprint).toBe(currentFingerprint);
    expect(scope.targetPath).toBe("src/index.ts");
    expect(scope.pathScope).toEqual(["src/index.ts"]);

    for (const parameters of [
      { ...valid, expectedFingerprint: undefined },
      { ...valid, pathScope: undefined },
      { ...valid, targetPath: undefined },
      { ...valid, patch: undefined },
      { ...valid, expectedFingerprint: "not-a-hash" },
      { ...valid, pathScope: [] },
      { ...valid, pathScope: ["../escape.ts"], targetPath: "../escape.ts" },
      { ...valid, pathScope: ["/abs.ts"], targetPath: "/abs.ts" },
      // A target outside its own declared scope is refused.
      { ...valid, targetPath: "src/other.ts" },
    ]) {
      expect(() => parseCodePatchScope(parameters), JSON.stringify(parameters)).toThrow(
        ApplicationError,
      );
    }
  });

  it("rejects a stale edit rather than silently overwriting newer work", () => {
    const scope = parseCodePatchScope({
      expectedFingerprint: currentFingerprint,
      targetPath: "src/index.ts",
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
