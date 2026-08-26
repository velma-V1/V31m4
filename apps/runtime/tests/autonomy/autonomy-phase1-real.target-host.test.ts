import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  createOperationContext,
  type OperationContext,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import { JobId, ProjectId, ResourceBudget, TaskId } from "@v31m4/domain";
import {
  buildDockerRunArguments,
  containerNameFor,
  DirectDockerSandbox,
  ReferenceSandboxBackend,
  SandboxSupervisor,
} from "@v31m4/infrastructure";
import { expect, it } from "vitest";
import { authorizeSemanticExecution } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { LocalWorkspaceManager } from "../../src/job-execution-infrastructure.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1 target-host proof.
 *
 * Opt-in (`V31M4_AUTONOMY_PHASE1_REAL=1`) so hermetic `pnpm check` stays unchanged. It runs
 * real Task 1 boundary behavior against the actual machine and reports missing prerequisites
 * honestly instead of asserting a mocked success. Set
 * `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1` to make an unproven container boundary a failure.
 *
 * A non-empty `V31M4_SANDBOX_IMAGE` is NOT the same thing as a pinned image: the digest syntax
 * is validated here before the image is treated as usable.
 */
const enabled = process.env["V31M4_AUTONOMY_PHASE1_REAL"] === "1";
const realTest = enabled ? it : it.skip;
const dockerExecutable = process.env["V31M4_DOCKER_EXECUTABLE"] ?? "docker";
const sandboxImage = process.env["V31M4_SANDBOX_IMAGE"] ?? "";
const requireDocker = process.env["V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER"] === "1";
const DIGEST_PINNED_IMAGE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/u;
const imageIsPinned = DIGEST_PINNED_IMAGE.test(sandboxImage);

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

  const inspect = (path: string) =>
    authorizeSemanticExecution({
      operationId: "code.inspect",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { pathScope: [path] },
    });

  const inspected = await sandboxes.execute(sandbox, inspect("target.ts"), context());
  expect(inspected.status).toBe("completed");
  const fingerprints = inspected.metadata["fingerprints"] as Record<string, string>;
  expect(fingerprints["target.ts"]).toMatch(/^[a-f0-9]{64}$/u);
  report(`real workspace fingerprint target.ts=${fingerprints["target.ts"]}`);

  // A real path escape attempt against the real filesystem must be refused.
  await expect(
    sandboxes.execute(sandbox, inspect("../../etc/passwd"), context()),
  ).rejects.toBeInstanceOf(ApplicationError);

  // A harmless operation cannot carry a foreign executable, and an effect has no path without
  // a sandbox.
  expect(() =>
    authorizeSemanticExecution({
      operationId: "git.status",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: { executable: "touch", arguments: [join(directory, "smuggled.txt")] },
    }),
  ).toThrow(ApplicationError);
  expect(() =>
    authorizeSemanticExecution({
      operationId: "command.run",
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox: null,
      parameters: { executable: "/bin/true", arguments: [] },
    }),
  ).toThrow(ApplicationError);

  await sandboxes.destroy(sandbox.id, context());
  report("reference-backend boundary proof: PASS");
});

realTest(
  "hardened direct-Docker sandbox on this host",
  async () => {
    report(`container runtime executable: ${dockerExecutable}`);
    report(
      `sandbox image supplied: ${sandboxImage.length > 0}; digest-pinned: ${imageIsPinned}` +
        (sandboxImage.length > 0 && !imageIsPinned
          ? " (REJECTED: not <repo>@sha256:<64 hex>)"
          : ""),
    );

    if (!imageIsPinned) {
      if (requireDocker) {
        throw new Error(
          "V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 but V31M4_SANDBOX_IMAGE is missing or not digest-pinned as <repository>@sha256:<64 lowercase hex>.",
        );
      }
      report(
        "direct-Docker container assertions: NOT PROVEN (no digest-pinned image); the backend refuses to construct itself without one",
      );
      expect(
        () =>
          new DirectDockerSandbox({
            image: sandboxImage,
            dockerExecutable,
            userSpec: "65534:65534",
          }),
      ).toThrow(ApplicationError);
      return;
    }

    const docker = new DirectDockerSandbox({
      image: sandboxImage,
      dockerExecutable,
      userSpec: "65534:65534",
    });
    const available = await docker.available();
    report(`container runtime reachable: ${available}`);

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

    if (!available) {
      if (requireDocker) {
        throw new Error(
          "V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 but no reachable container runtime; the isolation properties remain unproven.",
        );
      }
      await expect(
        sandboxes.prepare(taskId, jobId, workspace, budget, policy, context()),
      ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
      report(
        "direct-Docker container assertions: NOT PROVEN on this host (no reachable container runtime); fail-closed behavior verified instead",
      );
      return;
    }

    const sandbox = await sandboxes.prepare(taskId, jobId, workspace, budget, policy, context());
    const run = (script: string, sandboxHandle: SandboxHandle): AuthorizedSemanticExecutionPlan =>
      authorizeSemanticExecution({
        operationId: "command.run",
        role: "executor",
        policyDecision: "allow",
        taskId,
        jobId,
        workspace,
        sandbox: sandboxHandle,
        parameters: { executable: "/bin/sh", arguments: ["-c", script] },
      });

    // The argv actually used, asserted against the running configuration.
    const argv = buildDockerRunArguments(
      {
        sandboxId: sandbox.id,
        taskId,
        jobId,
        workspaceId: workspace.id,
        workspaceRoot: directory,
        budget,
        policy,
      },
      { image: sandboxImage, dockerExecutable, userSpec: "65534:65534" },
      ["/bin/sh", "-c", "true"],
    );
    expect(argv.filter((value) => value.startsWith("type=bind"))).toEqual([
      `type=bind,source=${directory},target=/workspace`,
    ]);
    report(`effective mounts: ${argv.filter((v) => v.startsWith("type=bind")).join(" | ")}`);

    const uid = await sandboxes.execute(sandbox, run("id -u", sandbox), context());
    expect(uid.status).toBe("completed");
    const effectiveUid = String(uid.metadata["stdout"]).trim();
    expect(effectiveUid).not.toBe("0");
    expect(Number(effectiveUid)).toBeGreaterThan(0);
    report(`effective container uid: ${effectiveUid}`);

    const readOnlyRoot = await sandboxes.execute(
      sandbox,
      run("touch /v31m4-root-probe", sandbox),
      context(),
    );
    expect(readOnlyRoot.status).toBe("failed");
    report("read-only root filesystem: enforced");

    const socket = await sandboxes.execute(
      sandbox,
      run("test -S /var/run/docker.sock", sandbox),
      context(),
    );
    expect(socket.status).toBe("failed");
    report("docker socket: absent");

    const egress = await sandboxes.execute(
      sandbox,
      run("getent hosts example.com || exit 3", sandbox),
      context(),
    );
    expect(egress.status).toBe("failed");
    report("network egress: blocked");

    const outsideWorkspace = await sandboxes.execute(
      sandbox,
      run("touch /etc/v31m4-probe", sandbox),
      context(),
    );
    expect(outsideWorkspace.status).toBe("failed");

    const write = await sandboxes.execute(
      sandbox,
      run("printf 'from-container' > /workspace/produced.txt", sandbox),
      context(),
    );
    expect(write.status).toBe("completed");
    expect(readFileSync(join(directory, "produced.txt"), "utf8")).toBe("from-container");
    report("workspace-only write: verified on the host filesystem");

    // Destruction must actually prove the container is gone.
    await sandboxes.destroy(sandbox.id, context());
    expect(await sandboxes.inspect(sandbox.id, context())).toBeNull();
    report(`container ${containerNameFor(sandbox.id)} removed and absence verified`);
    report("direct-Docker container assertions: PASS");
  },
  600_000,
);
