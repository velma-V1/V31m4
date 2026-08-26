import {
  ApplicationError,
  createOperationContext,
  decideRetry,
  type PolicyDecision,
  projectLedger,
  type SandboxHandle,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  ExecutionLedgerEntry,
  JobId,
  ProjectId,
  SafePath,
  SandboxId,
  sha256Hex,
  TaskId,
} from "@v31m4/domain";
import { SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import { describe, expect, it } from "vitest";
import { SqliteTaskCapsuleRepository } from "../../src/autonomy/autonomy-state-infrastructure.js";
import { createSemanticAuthorizationBoundary } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { runtimeDatabase, context as taskContext } from "../fixtures.js";

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
  it("no model-direct effect bypass", async () => {
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
    const policy = (decision: PolicyDecision = "allow") => ({
      async evaluate() {
        return {
          decision,
          policyId: `policy:test-${decision}`,
          reasons: [],
          requiredApprovalScopes: [],
        };
      },
    });
    const operationContext = createOperationContext({
      requestId: "request:invariant",
      idempotencyKey: "key:invariant",
      actor: { id: "runtime", kind: "system", roles: ["runtime"] },
      startedAt: "2026-08-25T00:00:00.000Z",
    });
    const boundary = createSemanticAuthorizationBoundary({ policy: policy() });
    const authorizeSemanticExecution = boundary.authorize;
    const allowed = {
      operationId: "command.run",
      role: "executor" as const,
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { executable: "/bin/true", arguments: [] },
    };
    const capability = await authorizeSemanticExecution(allowed, operationContext);
    expect(capability.sandboxId).toBe(sandbox.id);
    // Only the paired boundary accepts it, and only once.
    expect(boundary.capabilities.verify(capability)).toBe(capability);
    expect(() =>
      createSemanticAuthorizationBoundary({ policy: policy() }).capabilities.verify(capability),
    ).toThrow(ApplicationError);
    boundary.capabilities.consume(capability);
    expect(() => boundary.capabilities.consume(capability)).toThrow(ApplicationError);

    for (const missing of [
      { ...allowed, workspace: { ...workspace, status: "discarded" as const } },
      { ...allowed, sandbox: null },
      { ...allowed, role: "auditor" as const },
      { ...allowed, operationId: "git.worktree" },
      // A harmless operation carrying a foreign executable is a denial, not a silent drop.
      { ...allowed, operationId: "git.status", parameters: { executable: "touch" } },
    ]) {
      await expect(
        authorizeSemanticExecution(missing, operationContext),
        JSON.stringify(missing.operationId),
      ).rejects.toThrow(ApplicationError);
    }
    for (const decision of ["deny", "require_approval"] as const) {
      await expect(
        createSemanticAuthorizationBoundary({ policy: policy(decision) }).authorize(
          allowed,
          operationContext,
        ),
      ).rejects.toThrow(ApplicationError);
    }
  });

  /**
   * Owned by Task 2. Full coverage against real SQLite — atomic revision/head movement, a
   * brand-new database instance, and replay from stored revisions — lives in `task-state.test.ts`.
   * This is the inventory entry's own executable check that durable state is reconstructible from
   * persisted revisions alone, with no conversation and no in-memory carry-over.
   */
  it("task state survives restart without chat history", async () => {
    const database = runtimeDatabase();
    const path = database.path;
    const draft = {
      taskId: "task:restart",
      jobId: "job:1",
      projectId: "project:1",
      objective: "Prove state outlives the process.",
      phase: "investigate" as const,
      maxAttempts: 3,
      stopCondition: "stop after three attempts",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    const before = new TaskManager({
      unitOfWork: database.unitOfWork,
      capsules: new SqliteTaskCapsuleRepository(database),
      evidence: new SqliteEvidenceRepository(database),
    });
    const created = await before.createTask(draft, taskContext);
    const moved = await before.proposeTransition(
      {
        taskId: draft.taskId,
        expectedHeadRevision: created.head.revision,
        expectedCapsuleRevision: created.capsule.capsuleRevision,
        from: "investigate",
        to: "plan",
        evidenceIds: [],
        reason: "the reproduction is understood",
      },
      { updatedAt: "2026-08-26T00:01:00.000Z" },
      taskContext,
    );
    database.close();

    // A brand-new database instance: nothing survives except what was persisted.
    const reopened = new SqliteRuntimeDatabase(path);
    try {
      const recovered = await new TaskManager({
        unitOfWork: reopened.unitOfWork,
        capsules: new SqliteTaskCapsuleRepository(reopened),
        evidence: new SqliteEvidenceRepository(reopened),
      }).loadCurrent(TaskId.parse(draft.taskId), taskContext);
      expect(recovered?.capsule).toEqual(moved.capsule);
      expect(recovered?.capsule.fingerprint).toBe(moved.capsule.fingerprint);
      expect(recovered?.capsule.capsuleRevision).toBe(2);
      expect(recovered?.capsule.phase).toBe("plan");
    } finally {
      reopened.close();
    }
  });
  /**
   * Owned by Task 3. Full lifecycle coverage — attempt before dispatch, verified post-state, and
   * restart recovery against real SQLite — lives in `execution-ledger.test.ts`. This is the
   * inventory entry's own executable check that an effect nobody could prove blocks the same
   * intent from being tried again, and that only a verified non-application clears it.
   */
  it("ambiguous effect is reconciled before retry", () => {
    const intent = ExecutionLedgerEntry.intentFingerprint({
      taskId: "task:root",
      operationId: "code.patch",
      workspaceId: "workspace-1",
      command: null,
      parameters: { pathScope: ["src/index.ts"] },
    });
    const attempt = ExecutionLedgerEntry.create({
      id: "ledger:attempt",
      taskId: "task:root",
      jobId: "job:1",
      recordedAt: "2026-08-26T00:00:00.000Z",
      detail: "attempting code.patch",
      kind: "effect_attempt",
      intentFingerprint: intent,
      operationId: "code.patch",
      workspaceId: "workspace-1",
      sandboxId: "sandbox:1",
    });
    const outcome = (kind: string, facts: readonly unknown[]) =>
      ExecutionLedgerEntry.create({
        id: `ledger:${kind}`,
        taskId: "task:root",
        jobId: "job:1",
        recordedAt: "2026-08-26T00:00:01.000Z",
        detail: `code.patch resolved as ${kind}`,
        kind,
        attemptEntryId: attempt.id,
        facts,
      });
    const verified = [
      { resourceKind: "workspace_file", locator: "src/index.ts", fingerprint: sha256Hex("x") },
    ];

    // Unresolved, indeterminate, and already-applied all block another attempt.
    expect(decideRetry(projectLedger([attempt]), intent).allowed).toBe(false);
    expect(
      decideRetry(projectLedger([attempt, outcome("reconciliation_indeterminate", [])]), intent)
        .allowed,
    ).toBe(false);
    expect(
      decideRetry(projectLedger([attempt, outcome("effect_confirmation", verified)]), intent)
        .allowed,
    ).toBe(false);
    // Only a verified non-application clears the way.
    expect(
      decideRetry(projectLedger([attempt, outcome("effect_nonapplication", verified)]), intent)
        .allowed,
    ).toBe(true);
  });
  it.todo("agent turn cannot invoke disallowed operation");
  it.todo("auditor cannot mutate candidate");
  it.todo("stale workspace index cannot enter context");
  it.todo("stale memory is not injected as current fact");
  it.todo("deterministic failure cannot be overridden by neural verifier");
  it.todo("quality floor abstains outside calibrated envelope");
});
