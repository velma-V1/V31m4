import { mkdtempSync, writeFileSync } from "node:fs";
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
import { JobId, ProjectId, ResourceBudget, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDockerRunArguments,
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
const ALLOWED_OPERATIONS = ["code.inspect", "code.patch", "build.check"] as const;

function context(): OperationContext {
  return createOperationContext({
    requestId: "request:1",
    idempotencyKey: "key:1",
    actor: { id: "runtime", kind: "system", roles: ["runtime"] },
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z"),
  });
}

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

describe("SandboxSupervisor execution boundary", () => {
  it("rejects any operation outside the injected closed operation set", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    for (const operation of ["git.worktree", "shell.exec", "code.inspect ", ""]) {
      await expect(supervised.execute(handle, operation, {}, context())).rejects.toBeInstanceOf(
        ApplicationError,
      );
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
    const result = await supervised.execute(handle, "build.check", {}, context());
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });

  it("destroys a sandbox exactly once and refuses to execute afterwards", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await supervised.destroy(handle.id, context());
    expect(await supervised.inspect(handle.id, context())).toBeNull();
    await expect(supervised.execute(handle, "code.inspect", {}, context())).rejects.toBeInstanceOf(
      ApplicationError,
    );
  });
});

describe("ReferenceSandboxBackend", () => {
  it("produces real workspace fingerprints and contains every path", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      "code.inspect",
      { pathScope: ["target.ts"] },
      context(),
    );
    expect(result.status).toBe("completed");
    const fingerprints = result.metadata["fingerprints"] as Record<string, string>;
    expect(fingerprints["target.ts"]).toMatch(/^[a-f0-9]{64}$/u);

    for (const escapingPath of ["../outside.ts", "/etc/passwd"]) {
      await expect(
        supervised.execute(handle, "code.inspect", { pathScope: [escapingPath] }, context()),
      ).rejects.toBeInstanceOf(ApplicationError);
    }
  });

  it("never fabricates a successful effect it cannot actually perform", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      "code.patch",
      { pathScope: ["target.ts"], patch: "--- a\n+++ b\n" },
      context(),
    );
    expect(result.status).toBe("failed");
    expect(result.metadata["reason"]).toBe("reference_backend_performs_no_effects");
  });
});

describe("direct Docker sandbox authority boundaries", () => {
  const settings: DockerSandboxSettings = {
    image: `docker.io/library/node@sha256:${"c".repeat(64)}`,
    dockerExecutable: "docker",
    userSpec: "65534:65534",
    containerWorkdir: "/workspace",
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
    expect(args.slice(-2)).toEqual(["node", "--version"]);
  });

  it("grants the sandbox no host authority of any kind", () => {
    const joined = buildDockerRunArguments(spec(), settings, ["true"]).join(" ");
    expect(joined).not.toContain("docker.sock");
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toContain("--cap-add");
    expect(joined).not.toContain("--pid host");
    expect(joined).not.toContain("--network host");
    expect(joined).not.toContain("--user 0:0");
    expect(joined).not.toMatch(/--user\s+root/u);
    // The assigned workspace is the only host mount; internal scratch is ephemeral tmpfs.
    const mounts = buildDockerRunArguments(spec(), settings, ["true"]).filter((value) =>
      value.startsWith("type=bind"),
    );
    expect(mounts).toEqual([`type=bind,source=${root},target=/workspace`]);
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
    await expect(
      sandbox.execute(
        spec(),
        "build.check",
        { executable: "node", arguments: ["--version"] },
        context(),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
