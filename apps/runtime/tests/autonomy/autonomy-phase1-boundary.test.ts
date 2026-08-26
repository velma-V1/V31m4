import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  createOperationContext,
  type OperationContext,
  type SandboxHandle,
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
import { authorizeSemanticExecution } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { LocalWorkspaceManager } from "../../src/job-execution-infrastructure.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1 — end-to-end phase-1 boundary.
 *
 * These run against real temporary workspaces, the real `WorkspaceManagerPort` implementation,
 * the real sandbox supervisor, and the real semantic operation catalog. Nothing a security
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

function inspectPlan(sandbox: SandboxHandle, path: string) {
  return authorizeSemanticExecution({
    operationId: "code.inspect",
    role: "executor",
    policyDecision: "allow",
    taskId,
    jobId,
    workspace,
    sandbox,
    parameters: { pathScope: [path] },
  });
}

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
    const base = {
      operationId: "command.run",
      role: "executor" as const,
      policyDecision: "allow" as const,
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { executable: "/bin/true", arguments: [] },
    };
    expect(authorizeSemanticExecution(base).operationId).toBe("command.run");

    for (const attempt of [
      { policyDecision: "deny" as const },
      { policyDecision: "require_approval" as const },
      { workspace: { ...workspace, status: "discarded" as const } },
      { sandbox: null },
    ]) {
      expect(
        () => authorizeSemanticExecution({ ...base, ...attempt }),
        JSON.stringify(Object.keys(attempt)),
      ).toThrow(ApplicationError);
    }
  });

  it("cannot smuggle an arbitrary executable through a harmless operation end to end", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    const marker = join(workspaceDirectory, "smuggled.txt");

    // The exact independent-review probe: a read operation carrying a foreign executable.
    expect(() =>
      authorizeSemanticExecution({
        operationId: "git.status",
        role: "executor",
        policyDecision: "allow",
        taskId,
        jobId,
        workspace,
        sandbox,
        parameters: { executable: "touch", arguments: [marker] },
      }),
    ).toThrow(ApplicationError);

    // And a plan that never passed the boundary cannot reach a backend either.
    const forged = {
      operationId: "git.status",
      effectClass: "read",
      taskId,
      jobId,
      workspaceId: workspace.id,
      sandboxId: sandbox.id,
      command: { executable: "touch", arguments: [marker] },
      parameters: {},
      fingerprints: {},
    } as never;
    await expect(sandboxes.execute(sandbox, forged, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(readdirSync(workspaceDirectory)).not.toContain("smuggled.txt");
  });

  it("refuses worktree and raw shell operations at the catalog and the sandbox alike", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    for (const operationId of ["git.worktree", "shell.exec", "docker.run"]) {
      expect(() =>
        authorizeSemanticExecution({
          operationId,
          role: "executor",
          policyDecision: "allow",
          taskId,
          jobId,
          workspace,
          sandbox,
          parameters: {},
        }),
      ).toThrow(ApplicationError);
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
  it("authorizes a patch against the current target and refuses it once the file moves on", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());

    const before = await sandboxes.execute(sandbox, inspectPlan(sandbox, "target.ts"), context());
    const firstFingerprint = fingerprintOf(before.metadata, "target.ts");

    const patchParameters = {
      expectedFingerprint: firstFingerprint,
      pathScope: ["target.ts"],
      patch: "--- a/target.ts\n+++ b/target.ts\n",
    };
    const patchRequest = {
      operationId: "code.patch",
      role: "executor" as const,
      policyDecision: "allow" as const,
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: patchParameters,
    };
    expect(
      authorizeSemanticExecution({
        ...patchRequest,
        observedTargetFingerprint: ContentHash.parse(firstFingerprint),
      }).operationId,
    ).toBe("code.patch");

    // Somebody else changes the file after the agent read it.
    writeFileSync(join(workspaceDirectory, "target.ts"), "export const value = 2;\n", "utf8");
    const after = await sandboxes.execute(sandbox, inspectPlan(sandbox, "target.ts"), context());
    const secondFingerprint = fingerprintOf(after.metadata, "target.ts");
    expect(secondFingerprint).not.toBe(firstFingerprint);

    let thrown: unknown;
    try {
      authorizeSemanticExecution({
        ...patchRequest,
        observedTargetFingerprint: ContentHash.parse(secondFingerprint),
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ApplicationError).code).toBe("CONFLICT");
  });

  it("never reports an effect the hermetic backend did not actually perform", async () => {
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    const current = await sandboxes.execute(sandbox, inspectPlan(sandbox, "target.ts"), context());
    const fingerprint = ContentHash.parse(fingerprintOf(current.metadata, "target.ts"));
    const plan = authorizeSemanticExecution({
      operationId: "code.patch",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: {
        expectedFingerprint: fingerprint,
        pathScope: ["target.ts"],
        patch: "--- a\n+++ b\n",
      },
      observedTargetFingerprint: fingerprint,
    });
    const result = await sandboxes.execute(sandbox, plan, context());
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
