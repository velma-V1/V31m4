import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  AuthorizedSemanticExecutionPlan,
  createOperationContext,
  type OperationContext,
  SandboxIsolationPolicy,
  type SemanticExecutionAuthorizationInput,
  type WorkspaceHandle,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import { JobId, ProjectId, ResourceBudget, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertValidDockerSandboxSettings,
  buildDockerRunArguments,
  containerNameFor,
  DirectDockerSandbox,
  type DockerSandboxSettings,
} from "../src/sandbox/direct-docker-sandbox.js";
import {
  ReferenceSandboxBackend,
  type SandboxBackend,
  type SandboxExecutionSpec,
  SandboxIndeterminateEffectError,
  SandboxSupervisor,
} from "../src/sandbox/sandbox-supervisor.js";

const projectId = ProjectId.parse("project:1");
const jobId = JobId.parse("job:1");
const taskId = TaskId.parse("task:root");
const budget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 0,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
  maxRamBytes: 512 * 1024 * 1024,
});
const policy = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const ALLOWED_OPERATIONS = ["code.inspect", "code.patch", "build.check", "command.run"] as const;
const PINNED_IMAGE = `docker.io/library/alpine@sha256:${"c".repeat(64)}`;

function context(signal?: OperationContext["signal"]): OperationContext {
  return createOperationContext({
    requestId: "request:1",
    idempotencyKey: "key:1",
    actor: { id: "runtime", kind: "system", roles: ["runtime"] },
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z"),
    ...(signal === undefined ? {} : { signal }),
  });
}

const ABORTED_SIGNAL: OperationContext["signal"] = Object.freeze({
  aborted: true,
  addEventListener(): void {},
  removeEventListener(): void {},
});

class StubWorkspaceManager implements WorkspaceManagerPort {
  readonly #handles = new Map<string, WorkspaceHandle>();

  add(id: string, status: WorkspaceHandle["status"]): WorkspaceHandle {
    const handle: WorkspaceHandle = Object.freeze({
      id,
      projectId,
      purpose: "tool_execution" as const,
      rootPath: SafePath.parse(id),
      status,
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    this.#handles.set(id, handle);
    return handle;
  }

  async create(): Promise<WorkspaceHandle> {
    throw new Error("unused");
  }
  async get(workspaceId: string): Promise<WorkspaceHandle | null> {
    return this.#handles.get(workspaceId) ?? null;
  }
  async snapshot(): Promise<never> {
    throw new Error("unused");
  }
  async seal(): Promise<never> {
    throw new Error("unused");
  }
  async discard(): Promise<void> {}
}

let root: string;
let workspaces: StubWorkspaceManager;
let activeHandle: WorkspaceHandle;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "v31m4-sandbox-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  workspaces = new StubWorkspaceManager();
  activeHandle = workspaces.add("workspace-1", "active");
});

function supervisor(backend: SandboxBackend, ids = ["sandbox:1", "sandbox:2"]): SandboxSupervisor {
  const queue = [...ids];
  return new SandboxSupervisor({
    backend,
    workspaces,
    allowedOperations: ALLOWED_OPERATIONS,
    resolveWorkspaceRoot: async (workspaceId) => {
      if (workspaceId !== activeHandle.id) throw new Error("unexpected workspace");
      return root;
    },
    generateSandboxId: () => queue.shift() ?? "sandbox:overflow",
  });
}

function readPlan(
  sandbox: SemanticExecutionAuthorizationInput["sandbox"],
  overrides: Partial<SemanticExecutionAuthorizationInput> = {},
): AuthorizedSemanticExecutionPlan {
  return AuthorizedSemanticExecutionPlan.issue({
    contract: {
      operationId: "code.inspect",
      effectClass: "read",
      sandboxRequirement: "none",
      allowedRoles: ["executor"],
      allowsCallerSuppliedCommand: false,
    },
    role: "executor",
    policyDecision: "allow",
    taskId,
    jobId,
    workspace: activeHandle,
    sandbox,
    command: null,
    parameters: { pathScope: ["target.ts"] },
    ...overrides,
  });
}

describe("SandboxSupervisor workspace authority", () => {
  it("prepares a sandbox only for a workspace the workspace manager currently owns", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    expect(handle.status).toBe("ready");
    expect(handle.workspaceId).toBe("workspace-1");
    expect(handle.backendId).toBe("reference");
    expect(await supervised.inspect(handle.id, context())).toEqual(handle);
  });

  it("refuses a forged, unknown, or no-longer-active workspace", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const unknown: WorkspaceHandle = { ...activeHandle, id: "workspace-unknown" };
    await expect(
      supervised.prepare(taskId, jobId, unknown, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);

    const sealed = workspaces.add("workspace-sealed", "sealed");
    await expect(
      supervised.prepare(taskId, jobId, sealed, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);

    const forged: WorkspaceHandle = { ...activeHandle, projectId: ProjectId.parse("project:2") };
    await expect(
      supervised.prepare(taskId, jobId, forged, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
});

describe("sandbox execution is bound to an issued authorization", () => {
  it("refuses a structurally forged authorization that never passed the gate", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const forged = {
      operationId: "code.inspect",
      effectClass: "read",
      taskId,
      jobId,
      workspaceId: handle.workspaceId,
      sandboxId: handle.id,
      command: { executable: "touch", arguments: ["/etc/probe"] },
      parameters: {},
      fingerprints: {},
    } as unknown as AuthorizedSemanticExecutionPlan;
    await expect(supervised.execute(handle, forged, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("refuses an authorization issued for a different sandbox, task, job, or workspace", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const first = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const second = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());

    // Issued for `second`, replayed against `first`.
    await expect(supervised.execute(first, readPlan(second), context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    const otherTask = TaskId.parse("task:other");
    const mismatched = readPlan({ ...first, taskId: otherTask }, { taskId: otherTask });
    await expect(supervised.execute(first, mismatched, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("rejects any operation outside the injected closed operation set", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    for (const operationId of ["git.worktree", "shell.exec", "docker.run"]) {
      const plan = readPlan(handle, {
        contract: {
          operationId,
          effectClass: "read",
          sandboxRequirement: "none",
          allowedRoles: ["executor"],
          allowsCallerSuppliedCommand: false,
        },
      });
      await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
        code: "UNSUPPORTED_OPERATION",
      });
    }
  });

  it("keeps an indeterminate effect as internal unknown state and degrades the sandbox", async () => {
    const indeterminate: SandboxBackend = {
      id: "indeterminate",
      async prepare() {},
      async execute() {
        throw new SandboxIndeterminateEffectError("container terminated before confirmation");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(indeterminate);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(handle, readPlan(handle), context());
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });
});

describe("SandboxSupervisor lifecycle state survives failed cleanup", () => {
  const failing: SandboxBackend = {
    id: "failing-cleanup",
    async prepare() {},
    async execute() {
      throw new Error("unused");
    },
    async cancel() {
      throw new ApplicationError("DEPENDENCY_FAILURE", "cancel cleanup failed", {});
    },
    async destroy() {
      throw new ApplicationError("DEPENDENCY_FAILURE", "destroy cleanup failed", {});
    },
  };

  it("keeps a sandbox degraded and reconcilable when destroy cannot prove the outcome", async () => {
    const supervised = supervisor(failing);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await expect(supervised.destroy(handle.id, context())).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
    const retained = await supervised.inspect(handle.id, context());
    expect(retained).not.toBeNull();
    expect(retained?.status).toBe("degraded");
  });

  it("keeps a sandbox degraded when cancellation cleanup fails", async () => {
    const supervised = supervisor(failing);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await expect(supervised.cancel(handle.id, context())).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });

  it("forgets a sandbox only after destruction actually succeeds", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await supervised.destroy(handle.id, context());
    expect(await supervised.inspect(handle.id, context())).toBeNull();
    await expect(supervised.execute(handle, readPlan(handle), context())).rejects.toBeInstanceOf(
      ApplicationError,
    );
  });
});

describe("ReferenceSandboxBackend", () => {
  it("produces real workspace fingerprints and contains every path", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(handle, readPlan(handle), context());
    expect(result.status).toBe("completed");
    const fingerprints = result.metadata["fingerprints"] as Record<string, string>;
    expect(fingerprints["target.ts"]).toMatch(/^[a-f0-9]{64}$/u);

    for (const escapingPath of ["../outside.ts", "/etc/passwd"]) {
      const plan = readPlan(handle, { parameters: { pathScope: [escapingPath] } });
      await expect(supervised.execute(handle, plan, context())).rejects.toBeInstanceOf(
        ApplicationError,
      );
    }
  });

  it("never fabricates a successful effect it cannot actually perform", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const patch = readPlan(handle, {
      contract: {
        operationId: "code.patch",
        effectClass: "workspace_write",
        sandboxRequirement: "required",
        allowedRoles: ["executor"],
        allowsCallerSuppliedCommand: false,
      },
      parameters: { pathScope: ["target.ts"], patch: "--- a\n+++ b\n" },
    });
    const result = await supervised.execute(handle, patch, context());
    expect(result.status).toBe("failed");
    expect(result.metadata["reason"]).toBe("reference_backend_performs_no_effects");
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 1;\n");
  });
});

describe("direct Docker sandbox configuration validation", () => {
  const settings: DockerSandboxSettings = {
    image: PINNED_IMAGE,
    dockerExecutable: "docker",
    userSpec: "65534:65534",
  };

  it("refuses an unpinned image, a root user, or a missing runtime before anything runs", () => {
    for (const invalid of [
      { ...settings, image: "alpine:latest" },
      { ...settings, image: "alpine" },
      { ...settings, image: `alpine@sha256:${"c".repeat(63)}` },
      { ...settings, image: `alpine@sha256:${"C".repeat(64)}` },
      { ...settings, image: "alpine@md5:abc" },
      { ...settings, userSpec: "0:0" },
      { ...settings, userSpec: "0:65534" },
      { ...settings, userSpec: "65534:0" },
      { ...settings, userSpec: "root" },
      { ...settings, userSpec: "root:root" },
      { ...settings, userSpec: "" },
      { ...settings, dockerExecutable: "" },
    ]) {
      expect(() => assertValidDockerSandboxSettings(invalid), JSON.stringify(invalid)).toThrow(
        ApplicationError,
      );
      expect(() => new DirectDockerSandbox(invalid), JSON.stringify(invalid)).toThrow(
        ApplicationError,
      );
    }
    expect(() => assertValidDockerSandboxSettings(settings)).not.toThrow();
  });
});

describe("direct Docker sandbox authority boundaries", () => {
  const settings: DockerSandboxSettings = {
    image: PINNED_IMAGE,
    dockerExecutable: "docker",
    userSpec: "65534:65534",
  };

  function spec(overrides: Partial<SandboxExecutionSpec> = {}): SandboxExecutionSpec {
    return {
      sandboxId: SandboxId.parse("sandbox:1"),
      taskId,
      jobId,
      workspaceId: "workspace-1",
      workspaceRoot: root,
      budget,
      policy,
      ...overrides,
    };
  }

  it("hardens every container it would ever start", () => {
    const args = buildDockerRunArguments(spec(), settings, ["node", "--version"]);
    const joined = args.join(" ");
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(joined).toContain("--network none");
    expect(args).toContain("--read-only");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain("--user 65534:65534");
    expect(joined).toContain("--pids-limit 64");
    expect(joined).toContain("--cpus 0.5");
    expect(joined).toContain("--memory 536870912");
    expect(joined).toContain(`type=bind,source=${root},target=/workspace`);
    expect(joined).toContain("--workdir /workspace");
    expect(joined).toContain(PINNED_IMAGE);
    expect(args.slice(-2)).toEqual(["node", "--version"]);
  });

  it("grants the sandbox no host authority of any kind", () => {
    const args = buildDockerRunArguments(spec(), settings, ["true"]);
    const joined = args.join(" ");
    expect(joined).not.toContain("docker.sock");
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toContain("--cap-add");
    expect(joined).not.toContain("--pid host");
    expect(joined).not.toContain("--network host");
    expect(joined).not.toContain("--user 0:0");
    expect(joined).not.toMatch(/--user\s+root/u);
    // The assigned workspace is the only host mount, at a target the backend owns; internal
    // scratch is ephemeral tmpfs.
    expect(args.filter((value) => value.startsWith("type=bind"))).toEqual([
      `type=bind,source=${root},target=/workspace`,
    ]);
    expect(joined).toContain("--tmpfs /tmp:");
    expect(joined).toContain("noexec");
  });

  it("fails closed on an egress allowlist it cannot yet enforce", () => {
    const allowlisted = SandboxIsolationPolicy.create({
      maxCpuMillisPerSecond: 500,
      maxPids: 64,
      network: { mode: "allowlist", hosts: ["registry.internal"] },
    });
    expect(() =>
      buildDockerRunArguments(spec({ policy: allowlisted }), settings, ["true"]),
    ).toThrow(ApplicationError);
  });

  it("reports an unavailable container runtime instead of degrading isolation", async () => {
    const sandbox = new DirectDockerSandbox({
      ...settings,
      dockerExecutable: join(root, "definitely-not-docker"),
    });
    expect(await sandbox.available()).toBe(false);
    await expect(sandbox.prepare(spec(), context())).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});

/**
 * Container-lifecycle regressions drive the backend against a real child process — a stub
 * `docker` executable steered by marker files — so process supervision, budget enforcement, and
 * cleanup verification are exercised for real without a container runtime. The isolation
 * boundary itself is never stubbed; proving that remains the target-host proof's job.
 */
describe("direct Docker sandbox container lifecycle", () => {
  let stubDir: string;
  let stubDocker: string;

  function calls(): string[] {
    try {
      return readFileSync(join(stubDir, "calls.log"), "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  function mark(name: string): void {
    writeFileSync(join(stubDir, name), "", "utf8");
  }

  function stubSettings(): DockerSandboxSettings {
    return { image: PINNED_IMAGE, dockerExecutable: stubDocker, userSpec: "65534:65534" };
  }

  function commandPlan(
    sandbox: SemanticExecutionAuthorizationInput["sandbox"],
    command: { executable: string; arguments: readonly string[] },
  ): AuthorizedSemanticExecutionPlan {
    return AuthorizedSemanticExecutionPlan.issue({
      contract: {
        operationId: "command.run",
        effectClass: "process_execute",
        sandboxRequirement: "required",
        allowedRoles: ["executor"],
        allowsCallerSuppliedCommand: true,
      },
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace: activeHandle,
      sandbox,
      command,
      parameters: {},
    });
  }

  function shortBudgetSupervisor(backend: SandboxBackend): SandboxSupervisor {
    return new SandboxSupervisor({
      backend,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      resolveWorkspaceRoot: async () => root,
      generateSandboxId: () => "sandbox:1",
    });
  }

  const shortBudget = ResourceBudget.create({
    maxWallClockMs: 700,
    maxModelInvocations: 0,
    maxToolInvocations: 1,
    maxRepairRounds: 0,
    maxConcurrentWorkers: 1,
  });

  beforeEach(() => {
    stubDir = mkdtempSync(join(tmpdir(), "v31m4-docker-stub-"));
    stubDocker = join(stubDir, "docker");
    writeFileSync(
      stubDocker,
      [
        "#!/bin/sh",
        'DIR=$(dirname "$0")',
        'echo "$*" >> "$DIR/calls.log"',
        'case "$1" in',
        '  version) echo "99.0.0-stub"; exit 0 ;;',
        '  run) if [ -f "$DIR/hang" ]; then sleep 30; fi; exit 0 ;;',
        "  rm) exit 0 ;;",
        '  ps) if [ -f "$DIR/still-present" ]; then echo deadbeefcafe; fi; exit 0 ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(stubDocker, 0o755);
  });

  it("does not spawn a container when the operation is already cancelled", async () => {
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await expect(
      supervised.execute(
        handle,
        commandPlan(handle, { executable: "/bin/true", arguments: [] }),
        context(ABORTED_SIGNAL),
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls().some((line) => line.startsWith("run "))).toBe(false);
  });

  it("force-removes and verifies the container when the budget is exceeded", async () => {
    mark("hang");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(
      taskId,
      jobId,
      activeHandle,
      shortBudget,
      policy,
      context(),
    );
    const result = await supervised.execute(
      handle,
      commandPlan(handle, { executable: "/bin/sleep", arguments: ["30"] }),
      context(),
    );
    // The docker client was killed, so the effect is unknown — never a silent retry.
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
    const name = containerNameFor("sandbox:1");
    expect(calls()).toContain(`rm --force ${name}`);
    expect(calls().some((line) => line.startsWith("ps --all --quiet"))).toBe(true);
  }, 30_000);

  it("force-removes the container on cancellation", async () => {
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await supervised.cancel(handle.id, context());
    expect(calls()).toContain(`rm --force ${containerNameFor("sandbox:1")}`);
  });

  it("surfaces a cleanup failure and keeps the sandbox reconcilable", async () => {
    mark("still-present");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await expect(supervised.destroy(handle.id, context())).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
    const retained = await supervised.inspect(handle.id, context());
    expect(retained).not.toBeNull();
    expect(retained?.status).toBe("degraded");
  });

  it("refuses to invent a container command for an operation with no trusted binding", async () => {
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await expect(supervised.execute(handle, readPlan(handle), context())).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
  });
});
