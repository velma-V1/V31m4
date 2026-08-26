import { ApplicationError } from "@v31m4/application";
import { SandboxId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import {
  assertSemanticEffectIsExecutable,
  SEMANTIC_OPERATION_IDS,
} from "../../src/autonomy/semantic-operation-catalog.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 — program acceptance inventory.
 *
 * Each entry becomes a real regression when its owning task lands; the remaining `it.todo()`
 * entries are named future invariants only, and none may be marked done outside its owning
 * implementation task. See docs/reviews/autonomy-baseline-v2.md and
 * docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md.
 */
describe("autonomy program invariants", () => {
  /**
   * Owned by Task 1. Full end-to-end coverage — real workspaces, the real sandbox supervisor,
   * and the real catalog — lives in `autonomy-phase1-boundary.test.ts` and
   * `semantic-operation-catalog.test.ts`; this is the inventory entry's own executable check
   * that the model-facing vocabulary grants no direct effect authority and that the governed
   * gate fails closed on every missing precondition.
   */
  it("no model-direct effect bypass", () => {
    for (const forbidden of [
      "git.worktree",
      "shell.exec",
      "command.exec",
      "docker.run",
      "sandbox.create",
      "browser.launch",
      "mcp.call",
      "workspace.create",
    ]) {
      expect((SEMANTIC_OPERATION_IDS as readonly string[]).includes(forbidden)).toBe(false);
    }

    const allowed = {
      operationId: "code.patch",
      role: "executor",
      policyDecision: "allow",
      assignedWorkspaceId: "workspace-1",
      sandboxId: SandboxId.parse("sandbox:1"),
    } as const;
    expect(assertSemanticEffectIsExecutable(allowed).sandboxRequirement).toBe("required");

    for (const missing of [
      { ...allowed, policyDecision: "deny" as const },
      { ...allowed, policyDecision: "require_approval" as const },
      { ...allowed, assignedWorkspaceId: null },
      { ...allowed, sandboxId: null },
      { ...allowed, role: "auditor" as const },
      { ...allowed, operationId: "git.worktree" },
    ]) {
      expect(() => assertSemanticEffectIsExecutable(missing)).toThrow(ApplicationError);
    }
  });

  it.todo("task state survives restart without chat history");
  it.todo("ambiguous effect is reconciled before retry");
  it.todo("agent turn cannot invoke disallowed operation");
  it.todo("auditor cannot mutate candidate");
  it.todo("stale workspace index cannot enter context");
  it.todo("stale memory is not injected as current fact");
  it.todo("deterministic failure cannot be overridden by neural verifier");
  it.todo("quality floor abstains outside calibrated envelope");
});
