import { ApplicationError, type SandboxHandle, type WorkspaceHandle } from "@v31m4/application";
import { JobId, ProjectId, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { authorizeSemanticExecution } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";

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
   * and the real catalog — lives in `autonomy-phase1-boundary.test.ts`,
   * `semantic-execution-authorization.test.ts`, and the infrastructure sandbox suite. This is
   * the inventory entry's own executable check that the model-facing vocabulary grants no
   * direct effect authority, that the governed boundary fails closed on every missing
   * precondition, and that a harmless operation cannot smuggle an arbitrary executable.
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

    const taskId = TaskId.parse("task:root");
    const jobId = JobId.parse("job:1");
    const workspace: WorkspaceHandle = Object.freeze({
      id: "workspace-1",
      projectId: ProjectId.parse("project:1"),
      purpose: "tool_execution" as const,
      rootPath: SafePath.parse("workspace-1"),
      status: "active" as const,
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    const sandbox: SandboxHandle = Object.freeze({
      id: SandboxId.parse("sandbox:1"),
      jobId,
      taskId,
      workspaceId: workspace.id,
      backendId: "reference",
      status: "ready" as const,
    });
    const allowed = {
      operationId: "command.run",
      role: "executor" as const,
      policyDecision: "allow" as const,
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { executable: "/bin/true", arguments: [] },
    };
    expect(authorizeSemanticExecution(allowed).sandboxId).toBe(sandbox.id);

    for (const missing of [
      { ...allowed, policyDecision: "deny" as const },
      { ...allowed, policyDecision: "require_approval" as const },
      { ...allowed, workspace: { ...workspace, status: "discarded" as const } },
      { ...allowed, sandbox: null },
      { ...allowed, role: "auditor" as const },
      { ...allowed, operationId: "git.worktree" },
      // A harmless operation carrying a foreign executable is a denial, not a silent drop.
      { ...allowed, operationId: "git.status", parameters: { executable: "touch" } },
    ]) {
      expect(
        () => authorizeSemanticExecution(missing),
        JSON.stringify(missing.operationId),
      ).toThrow(ApplicationError);
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
