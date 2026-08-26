import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationError,
  type AuthorizedSemanticExecutionPlan,
  createOperationContext,
  createSemanticExecutionAuthority,
  type OperationContext,
  SandboxIsolationPolicy,
  type SemanticExecutionAuthority,
  type SemanticExecutionAuthorizationInput,
  type SemanticResourcePolicy,
  type WorkspaceHandle,
  type WorkspaceManagerPort,
} from "@v31m4/application";
import { JobId, ProjectId, ResourceBudget, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectDockerSandbox } from "../src/sandbox/direct-docker-sandbox.js";
import {
  assertValidDockerSandboxSettings,
  buildDockerRunArguments,
  containerNameFor,
  type DockerSandboxSettings,
  MAX_ALLOWED_OUTPUT_BYTES,
} from "../src/sandbox/docker-sandbox-configuration.js";
import { ReferenceSandboxBackend } from "../src/sandbox/reference-sandbox.js";
import {
  type SandboxBackend,
  type SandboxExecutionSpec,
  SandboxIndeterminateEffectError,
  SandboxSupervisor,
} from "../src/sandbox/sandbox-supervisor.js";
import { WorkspaceExecutionInterlock } from "../src/sandbox/workspace-execution-interlock.js";
import { compareAndApply } from "../src/sandbox/workspace-guards.js";

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
const READ_OPERATION_CONTRACT = Object.freeze({
  operationId: "code.inspect",
  effectClass: "read" as const,
  riskClass: "low" as const,
  sandboxRequirement: "none" as const,
  allowedRoles: Object.freeze(["executor"]),
  evidencePreconditionPolicyId: "evidence.none.v1",
  resourcePolicy: Object.freeze({
    maxWallClockMs: 30_000,
    maxOutputBytes: 1_048_576,
    maxConcurrent: 4,
  }),
  allowsCallerSuppliedCommand: false,
});
const ALLOW_POLICY_GRANT = Object.freeze({
  decision: "allow" as const,
  policyId: "policy:test-semantic-execution",
  reasons: Object.freeze([]),
  requiredApprovalScopes: Object.freeze([]),
});
const PATCH_OPERATION_CONTRACT = Object.freeze({
  ...READ_OPERATION_CONTRACT,
  operationId: "code.patch",
  effectClass: "workspace_write" as const,
  riskClass: "high" as const,
  sandboxRequirement: "required" as const,
  evidencePreconditionPolicyId: "evidence.patch_requires_current_target.v1",
  resourcePolicy: Object.freeze({
    maxWallClockMs: 900_000,
    maxOutputBytes: 4_194_304,
    maxConcurrent: 1,
  }),
});
const COMMAND_OPERATION_CONTRACT = Object.freeze({
  ...PATCH_OPERATION_CONTRACT,
  operationId: "command.run",
  effectClass: "process_execute" as const,
  riskClass: "critical" as const,
  evidencePreconditionPolicyId: "evidence.command_run_escape_hatch.v1",
  allowsCallerSuppliedCommand: true,
});

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
  #sealGate: Promise<void> | undefined;
  #sealHook: (() => Promise<void>) | undefined;
  #discardHook: (() => Promise<void>) | undefined;

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
  onSeal(gate: () => Promise<void>): void {
    this.#sealHook = gate;
  }

  onDiscard(gate: () => Promise<void>): void {
    this.#discardHook = gate;
  }

  replace(workspaceId: string, changes: Partial<WorkspaceHandle>): void {
    const existing = this.#handles.get(workspaceId);
    if (existing === undefined) throw new Error("unknown workspace");
    this.#handles.set(workspaceId, Object.freeze({ ...existing, ...changes }));
  }

  blockSeal(gate: Promise<void>): void {
    this.#sealGate = gate;
  }

  async seal(workspaceId: string): Promise<WorkspaceHandle> {
    if (this.#sealGate !== undefined) {
      const gate = this.#sealGate;
      this.#sealGate = undefined;
      await gate;
    }
    if (this.#sealHook !== undefined) await this.#sealHook();
    const existing = this.#handles.get(workspaceId);
    if (existing === undefined) throw new Error("unknown workspace");
    const sealed = Object.freeze({ ...existing, status: "sealed" as const });
    this.#handles.set(workspaceId, sealed);
    return sealed;
  }
  async discard(workspaceId: string): Promise<void> {
    if (this.#discardHook !== undefined) await this.#discardHook();
    this.#handles.delete(workspaceId);
  }
}

let root: string;
let inner: StubWorkspaceManager;
let workspaces: WorkspaceExecutionInterlock;
let activeHandle: WorkspaceHandle;
let authority: SemanticExecutionAuthority;
let planCounter = 0;

/**
 * A test stands in for the runtime's canonical boundary by creating its own authority. The
 * point of the pairing is identity: a supervisor accepts only the authority it was configured
 * with, which is exactly what `newAuthority()` below is used to disprove.
 */
function newAuthority(
  now: () => string = () => "2026-08-25T00:00:00.000Z",
): SemanticExecutionAuthority {
  return createSemanticExecutionAuthority({
    generateExecutionPlanId: () => `plan:${++planCounter}`,
    now,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "v31m4-sandbox-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  inner = new StubWorkspaceManager();
  workspaces = new WorkspaceExecutionInterlock(inner);
  activeHandle = inner.add("workspace-1", "active");
  planCounter = 0;
  authority = newAuthority();
});

function supervisor(backend: SandboxBackend, ids = ["sandbox:1", "sandbox:2"]): SandboxSupervisor {
  const queue = [...ids];
  return new SandboxSupervisor({
    backend,
    workspaces,
    allowedOperations: ALLOWED_OPERATIONS,
    capabilities: authority,
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
  issuer: SemanticExecutionAuthority = authority,
): AuthorizedSemanticExecutionPlan {
  return issuer.mint({
    contract: READ_OPERATION_CONTRACT,
    role: "executor",
    policyGrant: ALLOW_POLICY_GRANT,
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

    const sealed = inner.add("workspace-sealed", "sealed");
    await expect(
      supervised.prepare(taskId, jobId, sealed, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);

    const forged: WorkspaceHandle = { ...activeHandle, projectId: ProjectId.parse("project:2") };
    await expect(
      supervised.prepare(taskId, jobId, forged, budget, policy, context()),
    ).rejects.toBeInstanceOf(ApplicationError);
  });

  it("refuses to overwrite authoritative state when an ID generator repeats a SandboxId", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend(), [
      "sandbox:duplicate",
      "sandbox:duplicate",
    ]);
    await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());

    await expect(
      supervised.prepare(taskId, jobId, activeHandle, budget, policy, context()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reserves a generated SandboxId while asynchronous preparation is in flight", async () => {
    let preparing = false;
    let releasePrepare: (() => void) | undefined;
    const prepareGate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const backend: SandboxBackend = {
      id: "blocking-prepare",
      async prepare() {
        preparing = true;
        await prepareGate;
      },
      async execute() {
        throw new Error("not used");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(backend, ["sandbox:duplicate", "sandbox:duplicate"]);
    const first = supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await vi.waitUntil(() => preparing);

    try {
      await expect(
        supervised.prepare(taskId, jobId, activeHandle, budget, policy, context()),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      releasePrepare?.();
    }
    expect((await first).id).toBe("sandbox:duplicate");
  });

  it("canonicalizes the workspace root before handing host mount authority to a backend", async () => {
    const alias = join(root, "workspace-alias");
    symlinkSync(root, alias, "dir");
    let preparedRoot: string | undefined;
    const backend: SandboxBackend = {
      id: "capture-root",
      async prepare(specification) {
        preparedRoot = specification.workspaceRoot;
      },
      async execute() {
        throw new Error("not used");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = new SandboxSupervisor({
      backend,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: authority,
      resolveWorkspaceRoot: async () => alias,
      generateSandboxId: () => "sandbox:canonical-root",
    });

    await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());

    expect(preparedRoot).toBe(root);
  });
});

describe("sandbox execution is bound to an issued authorization", () => {
  it("refuses a structurally forged authorization that no authority minted", async () => {
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
          ...READ_OPERATION_CONTRACT,
          operationId,
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

  it("refuses every fresh ordinary effect after an indeterminate effect degraded the sandbox", async () => {
    let dispatches = 0;
    const indeterminate: SandboxBackend = {
      id: "indeterminate",
      async prepare() {},
      async execute() {
        dispatches += 1;
        throw new SandboxIndeterminateEffectError("effect state is unknown");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(indeterminate);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    expect((await supervised.execute(handle, readPlan(handle), context())).status).toBe("unknown");

    await expect(supervised.execute(handle, readPlan(handle), context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(dispatches).toBe(1);
  });

  it("does not turn a degraded sandbox back to ready merely because cancel cleanup returned", async () => {
    const indeterminate: SandboxBackend = {
      id: "indeterminate",
      async prepare() {},
      async execute() {
        throw new SandboxIndeterminateEffectError("effect state is unknown");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(indeterminate);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    expect((await supervised.execute(handle, readPlan(handle), context())).status).toBe("unknown");
    await supervised.cancel(handle.id, context());
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });
});

describe("execution capabilities are issuer-bound and single-use", () => {
  it("refuses a capability minted by any other authority", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    // Structurally identical, genuinely an AuthorizedSemanticExecutionPlan, correct bindings —
    // and still refused, because this sandbox is paired with a different boundary.
    const foreign = readPlan(handle, {}, newAuthority());
    await expect(supervised.execute(handle, foreign, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("cannot be minted by fabricating an operation contract", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    // The independent-review probe: a "git.status" contract that claims it may carry a command.
    // Minting still requires the authority the sandbox trusts, so a caller holding only a
    // request cannot produce this at all — and a foreign authority's version is refused.
    const fabricated = readPlan(
      handle,
      {
        contract: {
          ...READ_OPERATION_CONTRACT,
          operationId: "git.status",
          allowsCallerSuppliedCommand: true,
        },
        command: { executable: "touch", arguments: ["/etc/probe"] },
      },
      newAuthority(),
    );
    await expect(supervised.execute(handle, fabricated, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("spends a capability exactly once and rejects a replay", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle);
    expect((await supervised.execute(handle, plan, context())).status).toBe("completed");
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("gives every capability its own identity", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const first = readPlan(handle);
    const second = readPlan(handle);
    expect(first.executionPlanId).not.toBe(second.executionPlanId);
    expect(first.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});

describe("workspace currency is re-verified at the sink", () => {
  function patchPlan(sandbox: SemanticExecutionAuthorizationInput["sandbox"], fingerprint: string) {
    return readPlan(sandbox, {
      contract: PATCH_OPERATION_CONTRACT,
      parameters: { pathScope: ["target.ts"], patch: "--- a\n+++ b\n" },
      currencyPrecondition: {
        path: "target.ts",
        expectedFingerprint: fingerprint,
        allowedPathScope: ["target.ts"],
      },
    });
  }

  async function currentFingerprint(): Promise<string> {
    const supervised = supervisor(new ReferenceSandboxBackend(), ["sandbox:probe"]);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(handle, readPlan(handle), context());
    return (result.metadata["fingerprints"] as Record<string, string>)["target.ts"] ?? "";
  }

  it("rejects an execution whose target changed after authorization, before dispatch", async () => {
    const fingerprint = await currentFingerprint();
    let reached = false;
    const watching: SandboxBackend = {
      id: "watching",
      // Declares write support, so the currency check — not the write gate — is what stops it.
      supportsWorkspaceWrite: true,
      async prepare() {},
      async execute() {
        reached = true;
        throw new Error("the backend must not be reached");
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(watching);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = patchPlan(handle, fingerprint);

    // Somebody else edits the workspace between authorization and dispatch.
    writeFileSync(join(root, "target.ts"), "export const value = 2;\n", "utf8");

    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(reached).toBe(false);
  });

  it("rejects a target outside its own declared path scope", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle, {
      currencyPrecondition: {
        path: "target.ts",
        expectedFingerprint: "a".repeat(64),
        allowedPathScope: ["other.ts"],
      },
    });
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("rejects a declared scope that escapes the assigned workspace", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle, {
      currencyPrecondition: {
        path: "target.ts",
        expectedFingerprint: "a".repeat(64),
        allowedPathScope: ["target.ts", "../outside.ts"],
      },
    });
    await expect(supervised.execute(handle, plan, context())).rejects.toBeInstanceOf(
      ApplicationError,
    );
  });
});

describe("dispatch re-reads the authoritative workspace", () => {
  let dispatched: boolean;
  const watching: SandboxBackend = {
    id: "watching",
    supportsWorkspaceWrite: true,
    async prepare() {},
    async execute() {
      dispatched = true;
      return Object.freeze({
        status: "completed" as const,
        outputArtifactIds: Object.freeze([]),
        logArtifactIds: Object.freeze([]),
        metadata: Object.freeze({}),
      });
    },
    async cancel() {},
    async destroy() {},
  };

  beforeEach(() => {
    dispatched = false;
  });

  it("refuses an effect once the workspace has been sealed", async () => {
    const supervised = supervisor(watching);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle);
    await inner.seal("workspace-1");
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dispatched).toBe(false);
  });

  it("refuses an effect once the workspace has been discarded", async () => {
    const supervised = supervisor(watching);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle);
    await inner.discard("workspace-1");
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(dispatched).toBe(false);
  });

  it("refuses an effect when the authoritative workspace record was replaced", async () => {
    const supervised = supervisor(watching);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle);
    // Same id, different record: a new workspace took the identity.
    inner.replace("workspace-1", { createdAt: "2026-08-26T00:00:00.000Z" });
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dispatched).toBe(false);
  });

  it("refuses an effect when the authoritative root no longer resolves to the prepared one", async () => {
    let currentRoot = root;
    const supervised = new SandboxSupervisor({
      backend: watching,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: authority,
      resolveWorkspaceRoot: async () => currentRoot,
      generateSandboxId: () => "sandbox:1",
    });
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle);
    currentRoot = mkdtempSync(join(tmpdir(), "v31m4-sandbox-moved-"));
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dispatched).toBe(false);
  });

  it("rechecks policy expiry after asynchronous workspace validation at the dispatch edge", async () => {
    let now = "2026-08-25T00:00:00.000Z";
    let rootResolutions = 0;
    const expiringAuthority = newAuthority(() => now);
    const supervised = new SandboxSupervisor({
      backend: watching,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: expiringAuthority,
      resolveWorkspaceRoot: async () => {
        rootResolutions += 1;
        if (rootResolutions === 2) now = "2026-08-25T00:00:01.000Z";
        return root;
      },
      generateSandboxId: () => "sandbox:1",
    });
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(
      handle,
      {
        policyGrant: {
          ...ALLOW_POLICY_GRANT,
          expiresAt: "2026-08-25T00:00:01.000Z",
        },
      },
      expiringAuthority,
    );

    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(dispatched).toBe(false);
  });

  it("does not let destroy erase lifecycle authority while execution is entering dispatch", async () => {
    let releaseRoot: (() => void) | undefined;
    let rootResolutions = 0;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const supervised = new SandboxSupervisor({
      backend: watching,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: authority,
      resolveWorkspaceRoot: async () => {
        rootResolutions += 1;
        if (rootResolutions === 2) await rootGate;
        return root;
      },
      generateSandboxId: () => "sandbox:1",
    });
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const execution = supervised.execute(handle, readPlan(handle), context());
    await vi.waitUntil(() => rootResolutions === 2);

    let destroyError: unknown;
    try {
      await supervised.destroy(handle.id, context());
    } catch (error) {
      destroyError = error;
    } finally {
      releaseRoot?.();
    }

    expect(destroyError).toMatchObject({ code: "CONFLICT" });
    expect((await execution).status).toBe("completed");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("ready");
  });

  it("does not let cancel race an execution that is entering dispatch", async () => {
    let releaseRoot: (() => void) | undefined;
    let rootResolutions = 0;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const supervised = new SandboxSupervisor({
      backend: watching,
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: authority,
      resolveWorkspaceRoot: async () => {
        rootResolutions += 1;
        if (rootResolutions === 2) await rootGate;
        return root;
      },
      generateSandboxId: () => "sandbox:1",
    });
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const execution = supervised.execute(handle, readPlan(handle), context());
    await vi.waitUntil(() => rootResolutions === 2);

    let cancelError: unknown;
    try {
      await supervised.cancel(handle.id, context());
    } catch (error) {
      cancelError = error;
    } finally {
      releaseRoot?.();
    }

    expect(cancelError).toMatchObject({ code: "CONFLICT" });
    expect((await execution).status).toBe("completed");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("ready");
  });

  it("refuses to seal or discard a workspace while an effect is entering dispatch", async () => {
    let release: (() => void) | undefined;
    const blocking: SandboxBackend = {
      id: "blocking",
      async prepare() {},
      async execute() {
        dispatched = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Object.freeze({
          status: "completed" as const,
          outputArtifactIds: Object.freeze([]),
          logArtifactIds: Object.freeze([]),
          metadata: Object.freeze({}),
        });
      },
      async cancel() {},
      async destroy() {},
    };
    const supervised = supervisor(blocking);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const running = supervised.execute(handle, readPlan(handle), context());
    await vi.waitUntil(() => dispatched);

    // The lifecycle change loses deterministically rather than invalidating a live effect.
    await expect(workspaces.seal("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(workspaces.discard("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });

    release?.();
    expect((await running).status).toBe("completed");
    // Once the effect is done the lifecycle change proceeds normally.
    expect((await workspaces.seal("workspace-1", context())).status).toBe("sealed");
  });

  it("refuses to begin an effect while a lifecycle change is in flight", async () => {
    let releaseSeal: (() => void) | undefined;
    inner.blockSeal(
      new Promise<void>((resolve) => {
        releaseSeal = resolve;
      }),
    );
    const supervised = supervisor(watching);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const sealing = workspaces.seal("workspace-1", context());
    await expect(supervised.execute(handle, readPlan(handle), context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(dispatched).toBe(false);
    releaseSeal?.();
    await sealing;
  });
});

describe("workspace execution interlock", () => {
  it("keeps effect dispatch exclusive per workspace, whatever the sandbox id", async () => {
    // Two leases keyed by sandboxId used to collapse into one holder, so the first release freed
    // the workspace while a second effect was still running.
    const first = await workspaces.beginExecution("workspace-1", "sandbox:1", context());
    await expect(
      workspaces.beginExecution("workspace-1", "sandbox:1", context()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      workspaces.beginExecution("workspace-1", "sandbox:2", context()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    first.lease.release();
    const next = await workspaces.beginExecution("workspace-1", "sandbox:2", context());
    expect(next.lease.leaseId).not.toBe(first.lease.leaseId);
    next.lease.release();
  });

  it("ties release to the exact lease and stays idempotent", async () => {
    const first = await workspaces.beginExecution("workspace-1", "sandbox:1", context());
    first.lease.release();
    const second = await workspaces.beginExecution("workspace-1", "sandbox:1", context());
    // A stale handle must not free the claim the live lease now holds.
    first.lease.release();
    first.lease.release();
    await expect(workspaces.seal("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    second.lease.release();
    expect((await workspaces.seal("workspace-1", context())).status).toBe("sealed");
  });

  it("blocks lifecycle changes until the held lease is released", async () => {
    const lease = (await workspaces.beginExecution("workspace-1", "sandbox:1", context())).lease;
    await expect(workspaces.seal("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(workspaces.discard("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    lease.release();
    expect((await workspaces.seal("workspace-1", context())).status).toBe("sealed");
  });

  it("serializes lifecycle mutations against each other", async () => {
    let releaseSeal: (() => void) | undefined;
    let concurrent = false;
    let inFlight = 0;
    inner.onSeal(async () => {
      inFlight += 1;
      if (inFlight > 1) concurrent = true;
      await new Promise<void>((resolve) => {
        releaseSeal = resolve;
      });
      inFlight -= 1;
    });
    const firstSeal = workspaces.seal("workspace-1", context());
    await vi.waitUntil(() => releaseSeal !== undefined);
    for (const second of [
      workspaces.seal("workspace-1", context()),
      workspaces.discard("workspace-1", context()),
    ]) {
      await expect(second).rejects.toMatchObject({ code: "CONFLICT" });
    }
    releaseSeal?.();
    await firstSeal;
    expect(concurrent).toBe(false);
  });

  it("refuses a discard while a seal is in flight, and the reverse", async () => {
    let releaseDiscard: (() => void) | undefined;
    inner.onDiscard(
      () =>
        new Promise<void>((resolve) => {
          releaseDiscard = resolve;
        }),
    );
    const discarding = workspaces.discard("workspace-1", context());
    await vi.waitUntil(() => releaseDiscard !== undefined);
    await expect(workspaces.seal("workspace-1", context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      workspaces.beginExecution("workspace-1", "sandbox:1", context()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    releaseDiscard?.();
    await discarding;
  });
});

describe("workspace path containment", () => {
  it("refuses a nonexistent target under an escaping symlink parent", async () => {
    const outside = mkdtempSync(join(tmpdir(), "v31m4-outside-"));
    writeFileSync(join(outside, "secret.txt"), "SECRET", "utf8");
    mkdirSync(join(root, "sub"));
    symlinkSync(outside, join(root, "sub", "link"), "dir");

    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    for (const escaping of [
      "sub/link/missing.ts",
      "sub/link/secret.txt",
      "sub/link",
      "sub/link/nested/deeper/missing.ts",
    ]) {
      const plan = readPlan(handle, { parameters: { pathScope: [escaping] } });
      await expect(supervised.execute(handle, plan, context()), escaping).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    }
  });

  it("still resolves an ordinary nonexistent path inside the workspace", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      readPlan(handle, { parameters: { pathScope: ["not-created-yet.ts"] } }),
      context(),
    );
    expect(result.status).toBe("completed");
    expect((result.metadata["fingerprints"] as Record<string, string>)["not-created-yet.ts"]).toBe(
      "",
    );
  });
});

/**
 * `--mount` is a comma-separated `key=value` list, so a comma in the resolved workspace root
 * injects further mount options into a security-critical argument: a root of
 * `/srv/ws,readonly=false,bind-propagation=rshared` produced exactly that. A path that cannot be
 * expressed safely is refused before a sandbox exists, rather than escaped at the argument.
 */
describe("workspace roots that cannot be expressed in a mount specification", () => {
  it("refuses to prepare a sandbox for a root containing a mount separator", async () => {
    for (const unsafe of ["ws,readonly=false", "ws=x", "ws,bind-propagation=rshared"]) {
      const hostile = join(root, unsafe);
      mkdirSync(hostile, { recursive: true });
      const supervised = new SandboxSupervisor({
        backend: new ReferenceSandboxBackend(),
        workspaces,
        allowedOperations: ALLOWED_OPERATIONS,
        capabilities: authority,
        resolveWorkspaceRoot: async () => hostile,
        generateSandboxId: () => "sandbox:1",
      });
      await expect(
        supervised.prepare(taskId, jobId, activeHandle, budget, policy, context()),
        unsafe,
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("refuses a safe-looking root whose real path carries a mount separator", async () => {
    const real = join(root, "real,readonly=false");
    mkdirSync(real);
    const link = join(root, "innocent");
    symlinkSync(real, link, "dir");
    const supervised = new SandboxSupervisor({
      backend: new ReferenceSandboxBackend(),
      workspaces,
      allowedOperations: ALLOWED_OPERATIONS,
      capabilities: authority,
      resolveWorkspaceRoot: async () => link,
      generateSandboxId: () => "sandbox:1",
    });
    await expect(
      supervised.prepare(taskId, jobId, activeHandle, budget, policy, context()),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("still prepares an ordinary workspace root", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    expect(handle.status).toBe("ready");
  });
});

describe("guarded workspace writes", () => {
  it("refuses a write effect for a backend that has not declared write support", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle, {
      contract: PATCH_OPERATION_CONTRACT,
    });
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
  });

  it("applies a change only through compare-and-apply, and only while the target is current", async () => {
    let applied: string | undefined;
    const writer: SandboxBackend = {
      id: "writer",
      supportsWorkspaceWrite: true,
      async prepare() {},
      async execute(spec, plan) {
        const precondition = plan.currencyPrecondition;
        if (precondition === null) throw new Error("expected a currency precondition");
        await spec.applyWorkspaceChange(precondition, "export const value = 9;\n");
        applied = readFileSync(join(root, "target.ts"), "utf8");
        return Object.freeze({
          status: "completed" as const,
          outputArtifactIds: Object.freeze([]),
          logArtifactIds: Object.freeze([]),
          metadata: Object.freeze({}),
        });
      },
      async cancel() {},
      async destroy() {},
    };
    const fingerprint = createHash("sha256")
      .update(readFileSync(join(root, "target.ts")))
      .digest("hex");
    const supervised = supervisor(writer);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle, {
      contract: PATCH_OPERATION_CONTRACT,
      currencyPrecondition: {
        path: "target.ts",
        expectedFingerprint: fingerprint,
        allowedPathScope: ["target.ts"],
      },
    });
    expect((await supervised.execute(handle, plan, context())).status).toBe("completed");
    expect(applied).toBe("export const value = 9;\n");
  });

  it("refuses a compare-and-apply whose target moved, even inside the backend", async () => {
    const racing: SandboxBackend = {
      id: "racing",
      supportsWorkspaceWrite: true,
      async prepare() {},
      async execute(spec, plan) {
        const precondition = plan.currencyPrecondition;
        if (precondition === null) throw new Error("expected a currency precondition");
        // The workspace changes after the supervisor's pre-dispatch check but before the write.
        writeFileSync(join(root, "target.ts"), "export const value = 42;\n", "utf8");
        await spec.applyWorkspaceChange(precondition, "export const value = 9;\n");
        return Object.freeze({
          status: "completed" as const,
          outputArtifactIds: Object.freeze([]),
          logArtifactIds: Object.freeze([]),
          metadata: Object.freeze({}),
        });
      },
      async cancel() {},
      async destroy() {},
    };
    const fingerprint = createHash("sha256")
      .update(readFileSync(join(root, "target.ts")))
      .digest("hex");
    const supervised = supervisor(racing);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const plan = readPlan(handle, {
      contract: PATCH_OPERATION_CONTRACT,
      currencyPrecondition: {
        path: "target.ts",
        expectedFingerprint: fingerprint,
        allowedPathScope: ["target.ts"],
      },
    });
    await expect(supervised.execute(handle, plan, context())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // The racing write stands; the stale change was never applied on top of it.
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 42;\n");
  });
});

describe("compare-and-apply is the only workspace write, and it cannot be captured", () => {
  const scope = ["target.ts"];

  function precondition(fingerprint: string) {
    return { path: "target.ts", expectedFingerprint: fingerprint, allowedPathScope: scope };
  }

  function currentFingerprintOf(path: string): string {
    return createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex");
  }

  it("refuses to be captured by a pre-placed temporary symlink pointing outside", async () => {
    const outside = mkdtempSync(join(tmpdir(), "v31m4-outside-"));
    const outsideFile = join(outside, "host-file.txt");
    writeFileSync(outsideFile, "ORIGINAL HOST CONTENT", "utf8");
    // The old implementation used a predictable temporary name, which a pre-created symlink
    // turned into a host-side write primitive.
    symlinkSync(outsideFile, join(root, "target.ts.v31m4-apply"));

    await compareAndApply(
      root,
      precondition(currentFingerprintOf("target.ts")),
      "export const value = 9;\n",
    );

    expect(readFileSync(outsideFile, "utf8")).toBe("ORIGINAL HOST CONTENT");
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 9;\n");
    // The decoy symlink is untouched and no stray temporary is left behind.
    expect(readdirSync(root).filter((name) => name.startsWith(".v31m4-apply"))).toEqual([]);
  });

  it("replaces the target atomically and leaves no temporary behind", async () => {
    await compareAndApply(
      root,
      precondition(currentFingerprintOf("target.ts")),
      "export const value = 5;\n",
    );
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 5;\n");
    expect(readdirSync(root).filter((name) => name.startsWith(".v31m4-apply"))).toEqual([]);
  });

  it("refuses a stale expectation and cleans up its temporary", async () => {
    const stale = "a".repeat(64);
    await expect(
      compareAndApply(root, precondition(stale), "export const value = 9;\n"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(readdirSync(root).filter((name) => name.startsWith(".v31m4-apply"))).toEqual([]);
  });

  it("refuses a target or parent that escapes the workspace", async () => {
    const outside = mkdtempSync(join(tmpdir(), "v31m4-outside-"));
    writeFileSync(join(outside, "host-file.txt"), "HOST", "utf8");
    symlinkSync(join(outside, "host-file.txt"), join(root, "linked-target.ts"));
    mkdirSync(join(root, "sub"));
    symlinkSync(outside, join(root, "sub", "link"), "dir");

    for (const path of ["linked-target.ts", "sub/link/host-file.txt", "sub/link/new.ts"]) {
      await expect(
        compareAndApply(
          root,
          { path, expectedFingerprint: "a".repeat(64), allowedPathScope: [path] },
          "x",
        ),
        path,
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    expect(readFileSync(join(outside, "host-file.txt"), "utf8")).toBe("HOST");
  });

  it("refuses a target outside its own declared scope", async () => {
    await expect(
      compareAndApply(
        root,
        {
          path: "target.ts",
          expectedFingerprint: currentFingerprintOf("target.ts"),
          allowedPathScope: ["other.ts"],
        },
        "x",
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
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

  it("is never handed a write effect at all, and the workspace is untouched", async () => {
    const supervised = supervisor(new ReferenceSandboxBackend());
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const patch = readPlan(handle, {
      contract: PATCH_OPERATION_CONTRACT,
      parameters: { pathScope: ["target.ts"], patch: "--- a\n+++ b\n" },
    });
    // The reference backend does not declare workspace-write support, so the supervisor refuses
    // the effect before dispatch rather than relying on the backend to decline it.
    await expect(supervised.execute(handle, patch, context())).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
    expect(readFileSync(join(root, "target.ts"), "utf8")).toBe("export const value = 1;\n");
  });
});

describe("direct Docker sandbox configuration validation", () => {
  const settings: DockerSandboxSettings = {
    image: PINNED_IMAGE,
    dockerExecutable: "docker",
    userSpec: "65534:65534",
  };

  it("derives collision-resistant names from the complete SandboxId", () => {
    expect(containerNameFor("sandbox:a-b")).not.toBe(containerNameFor("sandbox:a:b"));
    expect(containerNameFor("sandbox:a:b")).toMatch(/^v31m4-sandbox-[a-f0-9]{64}$/u);
  });

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
      // Legacy/unknown security-sensitive keys must fail loudly, not be silently ignored.
      { ...settings, containerWorkdir: "/" },
      { ...settings, containerWorkdir: "/tmp/unsafe" },
      { ...settings, containerWorkdir: "/workspace" },
      { ...settings, privileged: true },
      { ...settings, network: "host" },
      { ...settings, mounts: ["/:/host"] },
      // An output budget must be a real, bounded integer.
      { ...settings, maxOutputBytes: 0 },
      { ...settings, maxOutputBytes: -1 },
      { ...settings, maxOutputBytes: Number.NaN },
      { ...settings, maxOutputBytes: Number.POSITIVE_INFINITY },
      { ...settings, maxOutputBytes: 1.5 },
      { ...settings, maxOutputBytes: "unbounded" as unknown as number },
      { ...settings, maxOutputBytes: MAX_ALLOWED_OUTPUT_BYTES + 1 },
    ] as DockerSandboxSettings[]) {
      expect(() => assertValidDockerSandboxSettings(invalid), JSON.stringify(invalid)).toThrow(
        ApplicationError,
      );
      expect(() => new DirectDockerSandbox(invalid), JSON.stringify(invalid)).toThrow(
        ApplicationError,
      );
    }
    expect(() => assertValidDockerSandboxSettings(settings)).not.toThrow();
    for (const maxOutputBytes of [1, 4096, MAX_ALLOWED_OUTPUT_BYTES]) {
      expect(
        () => assertValidDockerSandboxSettings({ ...settings, maxOutputBytes }),
        String(maxOutputBytes),
      ).not.toThrow();
    }
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
      applyWorkspaceChange: async () => {
        throw new Error("argv construction performs no writes");
      },
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

  /**
   * The quantitative ceilings used to be the one part of the isolation contract a structural
   * literal could relax: `--pids-limit -1` is *unlimited* to Docker, so a policy that never went
   * through `SandboxIsolationPolicy.create` removed the fork-bomb ceiling from a container that
   * was otherwise correctly isolated. The argument builder now re-asserts the policy itself.
   */
  it("refuses to build an argument vector from a policy no factory issued", () => {
    for (const forged of [
      { ...policy, maxPids: -1 },
      { ...policy, maxPids: 0 },
      { ...policy, maxCpuMillisPerSecond: Number.NaN },
      { ...policy, policyKind: "forged" },
      { ...policy, writableWorkspaceOnly: false },
    ]) {
      let thrown: unknown;
      try {
        buildDockerRunArguments(
          spec({ policy: forged as unknown as SandboxIsolationPolicy }),
          settings,
          ["true"],
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(forged)).toBeInstanceOf(ApplicationError);
    }
    // The canonical policy still builds, and still carries its ceilings.
    expect(buildDockerRunArguments(spec(), settings, ["true"]).join(" ")).toContain(
      "--pids-limit 64",
    );
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
    resourcePolicy: SemanticResourcePolicy = COMMAND_OPERATION_CONTRACT.resourcePolicy,
  ): AuthorizedSemanticExecutionPlan {
    return authority.mint({
      contract: { ...COMMAND_OPERATION_CONTRACT, resourcePolicy },
      role: "executor",
      policyGrant: ALLOW_POLICY_GRANT,
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
      capabilities: authority,
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
    const inspection = (sandboxId: string, containerId: string) =>
      JSON.stringify({
        Id: containerId,
        Name: `/${containerNameFor("sandbox:1")}`,
        Config: {
          User: "65534:65534",
          Labels: {
            "v31m4.sandbox": sandboxId,
            "v31m4.task": "task:root",
            "v31m4.job": "job:1",
            "v31m4.workspace": "workspace-1",
          },
          Env: ["HOME=/home/sandbox", "TMPDIR=/tmp"],
        },
        HostConfig: {
          ReadonlyRootfs: true,
          NetworkMode: "none",
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
          Tmpfs: {
            "/tmp": "rw,noexec,nosuid,nodev,size=64m",
            "/home/sandbox": "rw,noexec,nosuid,nodev,size=16m",
          },
        },
        Mounts: [
          { Type: "bind", Source: root, Destination: "/workspace", RW: true },
          { Type: "tmpfs", Source: "", Destination: "/tmp", RW: true },
          { Type: "tmpfs", Source: "", Destination: "/home/sandbox", RW: true },
        ],
      });
    const ownedInspection = inspection("sandbox:1", "d".repeat(64));
    const foreignInspection = inspection("sandbox:foreign", "f".repeat(64));
    writeFileSync(
      stubDocker,
      [
        "#!/bin/sh",
        'DIR=$(dirname "$0")',
        'echo "$*" >> "$DIR/calls.log"',
        'case "$1" in',
        '  version) echo "99.0.0-stub"; exit 0 ;;',
        '  run) if [ -f "$DIR/client-error" ]; then echo "docker: daemon error" >&2; exit 125; fi;',
        '       if [ -f "$DIR/command-failed" ]; then exit 7; fi;',
        '       if [ -f "$DIR/stdout-flood" ]; then',
        "         i=0; while [ $i -lt 400 ]; do",
        '           printf "%08192d" 0; i=$((i+1));',
        "         done; exit 0;",
        "       fi;",
        '       if [ -f "$DIR/flood" ]; then',
        "         i=0; while [ $i -lt 400 ]; do",
        '           echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >&2; i=$((i+1));',
        "         done; sleep 5;",
        "       fi;",
        '       if [ -f "$DIR/hang" ]; then sleep 30; fi; exit 0 ;;',
        '  inspect) if [ -f "$DIR/foreign-owner" ]; then',
        `             echo '${foreignInspection}';`,
        "           else",
        `             echo '${ownedInspection}';`,
        "           fi; exit 0 ;;",
        "  rm) exit 0 ;;",
        '  ps) if [ -f "$DIR/still-present" ] || [ -f "$DIR/foreign-owner" ]; then echo deadbeefcafe; fi; exit 0 ;;',
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
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
    expect(calls().some((line) => line.startsWith("ps --all --quiet"))).toBe(true);
  }, 30_000);

  it("cannot weaken the catalog wall-clock ceiling with a looser sandbox budget", async () => {
    mark("hang");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      commandPlan(
        handle,
        { executable: "/bin/sleep", arguments: ["30"] },
        { ...COMMAND_OPERATION_CONTRACT.resourcePolicy, maxWallClockMs: 200 },
      ),
      context(),
    );

    expect(result.status).toBe("unknown");
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
  }, 10_000);

  it("reconciles the container when the supervisor kills the client on an output limit", async () => {
    mark("flood");
    const sandbox = new DirectDockerSandbox({ ...stubSettings(), maxOutputBytes: 2_048 });
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(
      taskId,
      jobId,
      activeHandle,
      // A generous wall clock, so only the output limit can end this run.
      budget,
      policy,
      context(),
    );
    const result = await supervised.execute(
      handle,
      commandPlan(handle, { executable: "/bin/true", arguments: [] }),
      context(),
    );
    // The client was killed by the Layer 8 supervisor; the container's fate is unproven.
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
    expect(calls().some((line) => line.startsWith("ps --all --quiet"))).toBe(true);
  }, 30_000);

  it("cannot weaken the catalog output ceiling with a looser backend setting", async () => {
    mark("flood");
    const sandbox = new DirectDockerSandbox({ ...stubSettings(), maxOutputBytes: 1_048_576 });
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      commandPlan(
        handle,
        { executable: "/bin/true", arguments: [] },
        { ...COMMAND_OPERATION_CONTRACT.resourcePolicy, maxOutputBytes: 2_048 },
      ),
      context(),
    );

    expect(result.status).toBe("unknown");
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
  }, 30_000);

  it("treats a docker client error exit as an unproven container, not a command failure", async () => {
    mark("client-error");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      commandPlan(handle, { executable: "/bin/true", arguments: [] }),
      context(),
    );
    // Exit 125 is docker's own failure; the container's fate is unknown.
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
  });

  it("reports an ordinary failure only once the container lifecycle is proven finished", async () => {
    mark("command-failed");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      commandPlan(handle, { executable: "/bin/false", arguments: [] }),
      context(),
    );
    expect(result.status).toBe("failed");
    expect(result.metadata["outcome"]).toBe("container_command_failed_confirmed");
    // Absence was checked before making that claim.
    expect(calls().some((line) => line.startsWith("ps --all --quiet"))).toBe(true);
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("ready");
  });

  it("treats a non-zero exit with a surviving container as unproven", async () => {
    mark("command-failed");
    mark("still-present");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    // The container is still there, so cleanup runs and its failure is surfaced rather than a
    // confident "failed" being reported.
    await expect(
      supervised.execute(
        handle,
        commandPlan(handle, { executable: "/bin/false", arguments: [] }),
        context(),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_FAILURE" });
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });

  it("reconciles the container when stdout alone exceeds the combined output budget", async () => {
    mark("stdout-flood");
    const sandbox = new DirectDockerSandbox({ ...stubSettings(), maxOutputBytes: 2_048 });
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    const result = await supervised.execute(
      handle,
      commandPlan(handle, { executable: "/bin/true", arguments: [] }),
      context(),
    );
    expect(result.status).toBe("unknown");
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
  }, 30_000);

  it("force-removes the container on cancellation", async () => {
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());
    await supervised.cancel(handle.id, context());
    expect(calls()).toContain(`rm --force ${"d".repeat(64)}`);
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

  it("never removes a same-name container whose ownership labels are foreign", async () => {
    mark("foreign-owner");
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());

    await expect(supervised.destroy(handle.id, context())).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(calls().some((line) => line.startsWith("rm --force"))).toBe(false);
    expect((await supervised.inspect(handle.id, context()))?.status).toBe("degraded");
  });

  it("observes and validates the live daemon-side configuration through supervision", async () => {
    const sandbox = new DirectDockerSandbox(stubSettings());
    const supervised = shortBudgetSupervisor(sandbox);
    const handle = await supervised.prepare(taskId, jobId, activeHandle, budget, policy, context());

    const observation = await sandbox.inspectActiveSandbox(handle.id, context());

    expect(observation.labels["v31m4.sandbox"]).toBe(handle.id);
    expect(observation.mounts.filter((mount) => mount.type === "bind")).toHaveLength(1);
    expect(calls()).toContain(`inspect --format {{json .}} ${containerNameFor("sandbox:1")}`);
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
