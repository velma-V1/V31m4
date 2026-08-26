import { execFileSync } from "node:child_process";
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
} from "@v31m4/application";
import { JobId, ProjectId, ResourceBudget, TaskId } from "@v31m4/domain";
import {
  buildDockerRunArguments,
  containerNameFor,
  DirectDockerSandbox,
  ReferenceSandboxBackend,
  SandboxSupervisor,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { expect, it } from "vitest";
import { createSemanticAuthorizationBoundary } from "../../src/autonomy/semantic-execution-authorization.js";
import { SEMANTIC_OPERATION_IDS } from "../../src/autonomy/semantic-operation-catalog.js";
import { LocalWorkspaceManager } from "../../src/job-execution-infrastructure.js";
import {
  assertNoExternalRoutes,
  assertOnlyLoopbackInterfaces,
} from "./runtime-network-attestation.js";
import {
  assertHardenedRuntimePrivileges,
  assertReadOnlyRootFilesystem,
} from "./runtime-privilege-attestation.js";

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

/** Asks Docker directly, so container absence is not attested by the code under test. */
function containerExists(name: string): boolean {
  const listed = execFileSync(
    dockerExecutable,
    ["ps", "--all", "--quiet", "--filter", `name=^${name}$`],
    { encoding: "utf8" },
  );
  return listed.trim().length > 0;
}

realTest("real workspace, catalog, and sandbox boundary on this host", async () => {
  const root = mkdtempSync(join(tmpdir(), "v31m4-phase1-real-"));
  const workspaces = new WorkspaceExecutionInterlock(new LocalWorkspaceManager(root));
  const workspace = await workspaces.create(projectId, "tool_execution", context());
  const directory = join(root, workspace.id);
  writeFileSync(join(directory, "target.ts"), "export const value = 1;\n", "utf8");

  const boundary = createSemanticAuthorizationBoundary();
  const authorizeSemanticExecution = boundary.authorize;
  const sandboxes = new SandboxSupervisor({
    backend: new ReferenceSandboxBackend(),
    workspaces,
    allowedOperations: SEMANTIC_OPERATION_IDS,
    capabilities: boundary.capabilities,
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
    const workspaces = new WorkspaceExecutionInterlock(new LocalWorkspaceManager(root));
    const workspace = await workspaces.create(projectId, "tool_execution", context());
    const directory = join(root, workspace.id);
    const boundary = createSemanticAuthorizationBoundary();
    const authorizeSemanticExecution = boundary.authorize;
    const sandboxes = new SandboxSupervisor({
      backend: docker,
      workspaces,
      allowedOperations: SEMANTIC_OPERATION_IDS,
      capabilities: boundary.capabilities,
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
        applyWorkspaceChange: async () => {
          throw new Error("argv construction performs no writes");
        },
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

    // Read-only root is attested from the mount table. A failed write is supplemental only: a
    // non-root user gets the same EACCES on a perfectly writable root, so the write alone would
    // be a false positive.
    const mountinfo = await sandboxes.execute(
      sandbox,
      run("cat /proc/self/mountinfo", sandbox),
      context(),
    );
    expect(mountinfo.status).toBe("completed");
    const rootMount = assertReadOnlyRootFilesystem(String(mountinfo.metadata["stdout"]));
    const readOnlyRoot = await sandboxes.execute(
      sandbox,
      run("touch /v31m4-root-probe", sandbox),
      context(),
    );
    expect(readOnlyRoot.status).toBe("failed");
    report(
      `read-only root filesystem: mount options ${rootMount.mountOptions.join(",")} ` +
        "(write also refused, supplemental)",
    );

    const socket = await sandboxes.execute(
      sandbox,
      run("test -S /var/run/docker.sock", sandbox),
      context(),
    );
    expect(socket.status).toBe("failed");
    report("docker socket: absent");

    // Network isolation is read from the kernel, not inferred from a name lookup. DNS can fail on
    // a fully connected host, so `getent` failing proves nothing about egress. What
    // `--network none` actually establishes is a namespace with only loopback and no route off
    // it, and that is directly observable.
    const interfaceListing = await sandboxes.execute(
      sandbox,
      // Shell globbing rather than `ls`, so the observation does not depend on which userspace
      // tools the image happens to ship.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: `${i##*/}` is POSIX shell parameter expansion sent to the container, not a JS template placeholder.
      run('for i in /sys/class/net/*; do echo "${i##*/}"; done', sandbox),
      context(),
    );
    expect(interfaceListing.status).toBe("completed");
    const interfaces = assertOnlyLoopbackInterfaces(String(interfaceListing.metadata["stdout"]));

    const routeTable = await sandboxes.execute(
      sandbox,
      run("cat /proc/net/route", sandbox),
      context(),
    );
    expect(routeTable.status).toBe("completed");
    const routes = assertNoExternalRoutes(String(routeTable.metadata["stdout"]));
    report(
      `network isolation: interfaces=[${interfaces.join(",")}] external/default routes=${routes.length}`,
    );

    // Supplemental only: a live numeric-IP connection attempt, which needs no DNS. Correctness
    // does not depend on the tool being installed — but if it is present the connection must
    // fail, because a success would contradict the kernel observations above.
    const connectProbe = await sandboxes.execute(
      sandbox,
      run("command -v wget >/dev/null 2>&1", sandbox),
      context(),
    );
    if (connectProbe.status === "completed") {
      const egress = await sandboxes.execute(
        sandbox,
        run("wget -q -T 3 -O /dev/null http://1.1.1.1/", sandbox),
        context(),
      );
      expect(egress.status, "a numeric-IP connection must not succeed under --network none").toBe(
        "failed",
      );
      report("network egress: live numeric-IP connection refused (supplemental)");
    } else {
      report("network egress: no numeric-IP probe tool present; supplemental check skipped");
    }

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

    // Ephemeral internal scratch: HOME and TMPDIR must resolve to in-container tmpfs that maps
    // no host storage, and must be writable so build/test tooling is not broken by isolation.
    const home = await sandboxes.execute(sandbox, run('printf "%s" "$HOME"', sandbox), context());
    expect(String(home.metadata["stdout"]).trim()).toBe("/home/sandbox");
    const temporaryDir = await sandboxes.execute(
      sandbox,
      run('printf "%s" "$TMPDIR"', sandbox),
      context(),
    );
    expect(String(temporaryDir.metadata["stdout"]).trim()).toBe("/tmp");
    report(
      `HOME=${String(home.metadata["stdout"]).trim()} ` +
        `TMPDIR=${String(temporaryDir.metadata["stdout"]).trim()}`,
    );

    const mounts = await sandboxes.execute(
      sandbox,
      run("cat /proc/self/mounts", sandbox),
      context(),
    );
    const mountTable = String(mounts.metadata["stdout"]);
    const mountFor = (target: string): string =>
      mountTable.split("\n").find((line) => line.split(" ")[1] === target) ?? "";
    expect(mountFor("/tmp").split(" ")[2], `/tmp mount: ${mountFor("/tmp")}`).toBe("tmpfs");
    expect(
      mountFor("/home/sandbox").split(" ")[2],
      `HOME mount: ${mountFor("/home/sandbox")}`,
    ).toBe("tmpfs");
    // The workspace bind is the one host-backed mount; scratch must not be.
    expect(mountFor("/workspace")).not.toBe("");
    expect(mountFor("/tmp")).not.toContain(directory);
    expect(mountFor("/home/sandbox")).not.toContain(directory);
    report("ephemeral scratch: /tmp and HOME are tmpfs, neither maps host storage");

    const scratchWritable = await sandboxes.execute(
      sandbox,
      run("touch /tmp/probe && touch /home/sandbox/probe", sandbox),
      context(),
    );
    expect(scratchWritable.status).toBe("completed");

    // Capability drop and no-new-privileges are read from the kernel's own view inside the
    // running container. Docker argv states intent; /proc/self/status is the evidence.
    const status = await sandboxes.execute(
      sandbox,
      run("cat /proc/self/status", sandbox),
      context(),
    );
    expect(status.status).toBe("completed");
    const privileges = assertHardenedRuntimePrivileges(String(status.metadata["stdout"]));
    report(
      `runtime privileges: CapEff=${privileges.capabilitiesEffective} ` +
        `CapBnd=${privileges.capabilitiesBounding} NoNewPrivs=${privileges.noNewPrivileges}`,
    );

    // Destruction must actually prove the container is gone.
    await sandboxes.destroy(sandbox.id, context());
    expect(await sandboxes.inspect(sandbox.id, context())).toBeNull();
    expect(containerExists(containerNameFor(sandbox.id))).toBe(false);
    report(`container ${containerNameFor(sandbox.id)} removed and absence independently verified`);

    // Real wall-clock timeout: a bounded long-running container must be reconciled, reported as
    // an unknown effect, and left with no surviving container.
    const timeoutSandboxes = new SandboxSupervisor({
      backend: docker,
      workspaces,
      allowedOperations: SEMANTIC_OPERATION_IDS,
      capabilities: boundary.capabilities,
      resolveWorkspaceRoot: async (workspaceId) => join(root, workspaceId),
      generateSandboxId: () => "sandbox:phase1-docker-timeout",
    });
    const timeoutSandbox = await timeoutSandboxes.prepare(
      taskId,
      jobId,
      workspace,
      ResourceBudget.create({
        maxWallClockMs: 5_000,
        maxModelInvocations: 0,
        maxToolInvocations: 1,
        maxRepairRounds: 0,
        maxConcurrentWorkers: 1,
      }),
      policy,
      context(),
    );
    const timedOut = await timeoutSandboxes.execute(
      timeoutSandbox,
      run("sleep 300", timeoutSandbox),
      context(),
    );
    expect(timedOut.status).toBe("unknown");
    expect((await timeoutSandboxes.inspect(timeoutSandbox.id, context()))?.status).toBe("degraded");
    expect(containerExists(containerNameFor(timeoutSandbox.id))).toBe(false);
    report("real timeout: container force-removed and absence independently verified");

    report("direct-Docker container assertions: PASS");
  },
  600_000,
);
