import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  createOperationContext,
  type OperationContext,
  SandboxIsolationPolicy,
  type WorkspaceHandle,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import {
  ADAPTER_PROTOCOL_VERSION,
  ADAPTER_PROTOCOL_VERSION_1_1,
  negotiateAdapterProtocolVersion,
} from "@v31m4/contracts";
import { ContentHash, JobId, ProjectId, ResourceBudget, TaskId } from "@v31m4/domain";
import { ReferenceSandboxBackend, SandboxSupervisor } from "@v31m4/infrastructure";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertCodePatchTargetIsCurrent,
  assertSemanticEffectIsExecutable,
  parseCodePatchScope,
  SEMANTIC_OPERATION_IDS,
} from "../../src/autonomy/semantic-operation-catalog.js";
import { LocalWorkspaceManager } from "../../src/job-execution-infrastructure.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1 — end-to-end phase-1 boundary.
 *
 * These run against real temporary workspaces, the real `WorkspaceManagerPort` implementation,
 * the real sandbox supervisor, and the real semantic operation catalog. Nothing that a security
 * claim depends on is mocked.
 */
const projectId = ProjectId.parse("project:autonomy");
const jobId = JobId.parse("job:autonomy");
const taskId = TaskId.parse("task:root");
const budget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 0,
  maxToolInvocations: 8,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});
const policy = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });

function context(): OperationContext {
  return createOperationContext({
    requestId: "request:autonomy",
    idempotencyKey: "key:autonomy",
    actor: { id: "runtime", kind: "system", roles: ["runtime"] },
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z"),
  });
}

let workspacesRoot: string;
let workspaces: WorkspaceManagerPort;
let workspace: WorkspaceHandle;
let workspaceDirectory: string;
let sandboxes: SandboxSupervisor;
let nextSandbox = 0;

beforeEach(async () => {
  workspacesRoot = mkdtempSync(join(tmpdir(), "v31m4-phase1-"));
  workspaces = new LocalWorkspaceManager(workspacesRoot);
  workspace = await workspaces.create(projectId, "tool_execution", context());
  workspaceDirectory = join(workspacesRoot, workspace.id);
  writeFileSync(join(workspaceDirectory, "target.ts"), "export const value = 1;\n", "utf8");
  nextSandbox = 0;
  sandboxes = new SandboxSupervisor({
    backend: new ReferenceSandboxBackend(),
    workspaces,
    // The closed set comes from the single V31M4-owned catalog; infrastructure never keeps a
    // second copy of the operation registry.
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async (workspaceId) => join(workspacesRoot, workspaceId),
    generateSandboxId: () => `sandbox:${++nextSandbox}`,
  });
});

describe("no model-direct effect bypass", () => {
  it("keeps autonomy runtime source free of any direct shell, browser, container, or network path", () => {
    const autonomyRoot = join(import.meta.dirname, "../../src/autonomy");
    const forbidden =
      /from\s+["'](?:node:(?:child_process|net|http|https|dgram|worker_threads|vm)|playwright|puppeteer|dockerode|ws)["']/u;
    const files = collectSources(autonomyRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(forbidden);
    }
  });

  it("has no execution path for an effect without policy, an assigned workspace, and a sandbox", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());

    expect(
      assertSemanticEffectIsExecutable({
        operationId: "code.patch",
        role: "executor",
        policyDecision: "allow",
        assignedWorkspaceId: workspace.id,
        sandboxId: sandbox.id,
      }).operationId,
    ).toBe("code.patch");

    for (const attempt of [
      { policyDecision: "deny" as const, assignedWorkspaceId: workspace.id, sandboxId: sandbox.id },
      { policyDecision: "allow" as const, assignedWorkspaceId: null, sandboxId: sandbox.id },
      { policyDecision: "allow" as const, assignedWorkspaceId: workspace.id, sandboxId: null },
    ]) {
      expect(() =>
        assertSemanticEffectIsExecutable({
          operationId: "code.patch",
          role: "executor",
          ...attempt,
        }),
      ).toThrow(ApplicationError);
    }
  });

  it("refuses worktree and raw shell operations at the sandbox boundary as well as the gate", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    for (const operation of ["git.worktree", "shell.exec", "docker.run"]) {
      expect(() =>
        assertSemanticEffectIsExecutable({
          operationId: operation,
          role: "executor",
          policyDecision: "allow",
          assignedWorkspaceId: workspace.id,
          sandboxId: sandbox.id,
        }),
      ).toThrow(ApplicationError);
      await expect(sandboxes.execute(sandbox, operation, {}, context())).rejects.toBeInstanceOf(
        ApplicationError,
      );
    }
  });
});

describe("workspace authority", () => {
  it("prepares sandboxes only for workspaces the workspace manager still owns", async () => {
    const sealed = await workspaces.seal(workspace.id, context());
    await expect(
      sandboxes.prepare(taskId, jobId, sealed, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
});

describe("code.patch staleness across a real workspace", () => {
  it("accepts a patch against the current target and rejects it once the file moves on", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());

    const before = await sandboxes.execute(
      sandbox,
      "code.inspect",
      { pathScope: ["target.ts"] },
      context(),
    );
    const firstFingerprint = fingerprintOf(before.metadata, "target.ts");

    const scope = parseCodePatchScope({
      expectedFingerprint: firstFingerprint,
      pathScope: ["target.ts"],
      patch: "--- a/target.ts\n+++ b/target.ts\n",
    });
    expect(() =>
      assertCodePatchTargetIsCurrent(scope, ContentHash.parse(firstFingerprint)),
    ).not.toThrow();

    // Somebody else changes the file after the agent read it.
    writeFileSync(join(workspaceDirectory, "target.ts"), "export const value = 2;\n", "utf8");
    const after = await sandboxes.execute(
      sandbox,
      "code.inspect",
      { pathScope: ["target.ts"] },
      context(),
    );
    const secondFingerprint = fingerprintOf(after.metadata, "target.ts");
    expect(secondFingerprint).not.toBe(firstFingerprint);

    let thrown: unknown;
    try {
      assertCodePatchTargetIsCurrent(scope, ContentHash.parse(secondFingerprint));
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ApplicationError).code).toBe("CONFLICT");
  });

  it("never reports an effect the hermetic backend did not actually perform", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    const result = await sandboxes.execute(
      sandbox,
      "code.patch",
      { pathScope: ["target.ts"], patch: "--- a\n+++ b\n" },
      context(),
    );
    expect(result.status).toBe("failed");
    expect(readFileSync(join(workspaceDirectory, "target.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });
});

describe("adapter protocol negotiation", () => {
  it("selects an exact mutually supported version and rejects everything else", () => {
    expect(negotiateAdapterProtocolVersion([ADAPTER_PROTOCOL_VERSION_1_1])).toBe("1.1.0");
    expect(negotiateAdapterProtocolVersion([ADAPTER_PROTOCOL_VERSION])).toBe("1.0.0");
    expect(negotiateAdapterProtocolVersion(["1.0.0", "1.1.0"])).toBe("1.1.0");
    expect(() => negotiateAdapterProtocolVersion(["1.2.0"])).toThrow();
  });
});

function collectSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? collectSources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function fingerprintOf(metadata: Readonly<Record<string, unknown>>, path: string): string {
  const fingerprints = metadata["fingerprints"] as Record<string, string> | undefined;
  const value = fingerprints?.[path];
  if (value === undefined || value.length === 0) {
    throw new Error(`No fingerprint recorded for ${path}`);
  }
  return value;
}
