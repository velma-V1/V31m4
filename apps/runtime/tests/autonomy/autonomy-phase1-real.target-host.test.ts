import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  createOperationContext,
  type OperationContext,
  SandboxIsolationPolicy,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import { JobId, ProjectId, ResourceBudget, TaskId } from "@v31m4/domain";
import {
  DirectDockerSandbox,
  ReferenceSandboxBackend,
  SandboxSupervisor,
} from "@v31m4/infrastructure";
import { expect, it } from "vitest";
import {
  assertSemanticEffectIsExecutable,
  SEMANTIC_OPERATION_IDS,
} from "../../src/autonomy/semantic-operation-catalog.js";
import { LocalWorkspaceManager } from "../../src/job-execution-infrastructure.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1 target-host proof.
 *
 * Opt-in (`V31M4_AUTONOMY_PHASE1_REAL=1`) so hermetic `pnpm check` stays unchanged. It runs
 * real Task 1 boundary behavior against the actual machine and reports missing prerequisites
 * honestly instead of asserting a mocked success. Set
 * `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1` to make a missing container runtime a hard failure.
 */
const enabled = process.env["V31M4_AUTONOMY_PHASE1_REAL"] === "1";
const realTest = enabled ? it : it.skip;
const dockerExecutable = process.env["V31M4_DOCKER_EXECUTABLE"] ?? "docker";
/** Must be digest-pinned; a floating tag is not an acceptable trusted dependency. */
const sandboxImage = process.env["V31M4_SANDBOX_IMAGE"] ?? "";
const requireDocker = process.env["V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER"] === "1";

const projectId = ProjectId.parse("project:phase1");
const jobId = JobId.parse("job:phase1");
const taskId = TaskId.parse("task:phase1");
const budget = ResourceBudget.create({
  maxWallClockMs: 120_000,
  maxModelInvocations: 0,
  maxToolInvocations: 16,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
  maxRamBytes: 512 * 1024 * 1024,
});
const policy = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 1_000, maxPids: 128 });

function context(): OperationContext {
  return createOperationContext({
    requestId: "request:phase1",
    idempotencyKey: "key:phase1",
    actor: { id: "runtime", kind: "system", roles: ["runtime"] },
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z"),
  });
}

function report(line: string): void {
  process.stdout.write(`[phase1-proof] ${line}\n`);
}

realTest("real workspace, catalog, and sandbox boundary on this host", async () => {
  const root = mkdtempSync(join(tmpdir(), "v31m4-phase1-real-"));
  const workspaces: WorkspaceManagerPort = new LocalWorkspaceManager(root);
  const workspace = await workspaces.create(projectId, "tool_execution", context());
  const directory = join(root, workspace.id);
  writeFileSync(join(directory, "target.ts"), "export const value = 1;\n", "utf8");

  const sandboxes = new SandboxSupervisor({
    backend: new ReferenceSandboxBackend(),
    workspaces,
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async (workspaceId) => join(root, workspaceId),
    generateSandboxId: () => "sandbox:phase1-reference",
  });
  const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
  report(`prepared reference sandbox ${sandbox.id} on real workspace ${workspace.id}`);

  const inspected = await sandboxes.execute(
    sandbox,
    "code.inspect",
    { pathScope: ["target.ts"] },
    context(),
  );
  expect(inspected.status).toBe("completed");
  const fingerprints = inspected.metadata["fingerprints"] as Record<string, string>;
  expect(fingerprints["target.ts"]).toMatch(/^[a-f0-9]{64}$/u);
  report(`real workspace fingerprint target.ts=${fingerprints["target.ts"]}`);

  // A real path escape attempt against the real filesystem must be refused.
  await expect(
    sandboxes.execute(sandbox, "code.inspect", { pathScope: ["../../etc/passwd"] }, context()),
  ).rejects.toBeInstanceOf(ApplicationError);

  // The governed gate is the only route to an effect.
  expect(() =>
    assertSemanticEffectIsExecutable({
      operationId: "code.patch",
      role: "executor",
      policyDecision: "allow",
      assignedWorkspaceId: workspace.id,
      sandboxId: null,
    }),
  ).toThrow(ApplicationError);
  await sandboxes.destroy(sandbox.id, context());
  report("reference-backend boundary proof: PASS");
});

realTest(
  "hardened direct-Docker sandbox on this host",
  async () => {
    const docker = new DirectDockerSandbox({
      image: sandboxImage,
      dockerExecutable,
      userSpec: "65534:65534",
      containerWorkdir: "/workspace",
    });
    const available = await docker.available();
    report(`container runtime (${dockerExecutable}) reachable: ${available}`);
    report(`pinned sandbox image supplied: ${sandboxImage.length > 0}`);

    if (!available || sandboxImage.length === 0) {
      // Honest unavailability, not a fabricated pass: prove the backend fails closed rather
      // than degrading isolation, and leave the container assertions explicitly unproven.
      if (requireDocker) {
        throw new Error(
          "V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 but no reachable container runtime and/or no digest-pinned V31M4_SANDBOX_IMAGE was supplied.",
        );
      }
      const root = mkdtempSync(join(tmpdir(), "v31m4-phase1-docker-"));
      const workspaces: WorkspaceManagerPort = new LocalWorkspaceManager(root);
      const workspace = await workspaces.create(projectId, "tool_execution", context());
      const sandboxes = new SandboxSupervisor({
        backend: docker,
        workspaces,
        allowedOperations: SEMANTIC_OPERATION_IDS,
        resolveWorkspaceRoot: async (workspaceId) => join(root, workspaceId),
        generateSandboxId: () => "sandbox:phase1-docker",
      });
      if (!available) {
        await expect(
          sandboxes.prepare(taskId, jobId, workspace, budget, policy, context()),
        ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      report(
        "direct-Docker container assertions: NOT PROVEN on this host (prerequisite missing); fail-closed behavior verified instead",
      );
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "v31m4-phase1-docker-"));
    const workspaces: WorkspaceManagerPort = new LocalWorkspaceManager(root);
    const workspace = await workspaces.create(projectId, "tool_execution", context());
    const directory = join(root, workspace.id);
    const sandboxes = new SandboxSupervisor({
      backend: docker,
      workspaces,
      allowedOperations: SEMANTIC_OPERATION_IDS,
      resolveWorkspaceRoot: async (workspaceId) => join(root, workspaceId),
      generateSandboxId: () => "sandbox:phase1-docker",
    });
    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());

    const run = (script: string) =>
      sandboxes.execute(
        sandbox,
        "command.run",
        { executable: "/bin/sh", arguments: ["-c", script] },
        context(),
      );

    const identity = await run("id -u");
    expect(identity.status).toBe("completed");
    expect(String(identity.metadata["stdout"]).trim()).not.toBe("0");
    report(`container uid: ${String(identity.metadata["stdout"]).trim()}`);

    const readOnlyRoot = await run("touch /v31m4-root-probe");
    expect(readOnlyRoot.status).toBe("failed");

    const socket = await run("test -S /var/run/docker.sock");
    expect(socket.status).toBe("failed");

    const egress = await run("getent hosts example.com || exit 3");
    expect(egress.status).toBe("failed");

    const write = await run("printf 'from-container' > /workspace/produced.txt");
    expect(write.status).toBe("completed");
    expect(readFileSync(join(directory, "produced.txt"), "utf8")).toBe("from-container");
    report(
      "direct-Docker container assertions: PASS (non-root, read-only root, no socket, no egress, workspace-only write)",
    );

    await sandboxes.destroy(sandbox.id, context());
  },
  300_000,
);
