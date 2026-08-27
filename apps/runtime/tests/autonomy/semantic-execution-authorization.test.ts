import {
  ApplicationError,
  createOperationContext,
  type PolicyEnginePort,
  type SandboxHandle,
  type WorkspaceHandle,
} from "@v31m4/application";
import { ContentHash, JobId, ProjectId, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSemanticAuthorizationBoundary,
  type SemanticAuthorizationBoundary,
  type SemanticExecutionRequest,
} from "../../src/autonomy/semantic-execution-authorization.js";
import { satisfiedFingerprints, satisfiedPreconditions } from "./precondition-fixtures.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1 repair.
 *
 * The independent review proved that naming a harmless operation while supplying an arbitrary
 * executable reached the execution sink: `{ operation: "git.status", executable: "touch" }` was
 * accepted and run. Authorization now produces a bound plan carrying a command this boundary
 * derived, and every one of these cases is a denial.
 */
const taskId = TaskId.parse("task:root");
/** The real gate over an already-satisfied world; the evidence gate has its own suite. */
const preconditions = () => satisfiedPreconditions("task:root", "job:1").gate;
const jobId = JobId.parse("job:1");
const currentFingerprint = ContentHash.parse("a".repeat(64));
const otherFingerprint = ContentHash.parse("b".repeat(64));

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

let boundary: SemanticAuthorizationBoundary;
let planCounter = 0;

beforeEach(() => {
  planCounter = 0;
  boundary = createSemanticAuthorizationBoundary({
    preconditions: preconditions(),
    policy: allowPolicy,
    generateExecutionPlanId: () => `plan:${++planCounter}`,
    now: () => "2026-08-25T00:00:00.000Z",
  });
});

const allowPolicy: PolicyEnginePort = {
  async evaluate() {
    return {
      decision: "allow",
      policyId: "policy:test-semantic-execution",
      reasons: [],
      requiredApprovalScopes: [],
    };
  },
};
const operationContext = createOperationContext({
  requestId: "request:semantic-execution",
  idempotencyKey: "key:semantic-execution",
  actor: { id: "runtime", kind: "system", roles: ["runtime"] },
  startedAt: "2026-08-25T00:00:00.000Z",
});

function authorizeSemanticExecution(request: SemanticExecutionRequest) {
  // The facts the gate needs are already recorded; the request states what it currently observes.
  return boundary.authorize(
    { currentFingerprints: satisfiedFingerprints("task:root", "job:1"), ...request },
    operationContext,
  );
}

function request(overrides: Partial<SemanticExecutionRequest> = {}): SemanticExecutionRequest {
  return {
    operationId: "git.status",
    role: "executor",
    taskId,
    jobId,
    workspace,
    sandbox,
    parameters: {},
    ...overrides,
  };
}

describe("trusted command derivation", () => {
  it("gives read-only git operations a runtime-owned command the caller cannot influence", async () => {
    expect((await authorizeSemanticExecution(request())).command).toEqual({
      executable: "git",
      arguments: ["status", "--porcelain=v1"],
    });
    expect(
      (
        await authorizeSemanticExecution(
          request({ operationId: "git.diff", parameters: { pathScope: ["src/index.ts"] } }),
        )
      ).command,
    ).toEqual({ executable: "git", arguments: ["diff", "--no-color", "--", "src/index.ts"] });
    expect(
      (
        await authorizeSemanticExecution(
          request({ operationId: "git.history", parameters: { limit: 5 } }),
        )
      ).command,
    ).toEqual({ executable: "git", arguments: ["log", "--no-color", "--max-count=5"] });
  });

  it("rejects a disguised command hidden behind a harmless operation", async () => {
    // The exact independent-review probe.
    let thrown: unknown;
    try {
      await authorizeSemanticExecution(
        request({ parameters: { executable: "touch", arguments: ["/etc/probe"] } }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as ApplicationError).code).toBe("PERMISSION_DENIED");

    for (const parameters of [
      { executable: "touch" },
      { arguments: ["-rf", "/"] },
      { argv: ["sh", "-c", "id"] },
      { command: "sh" },
      { cmd: "sh" },
      { entrypoint: "/bin/sh" },
      { shell: true },
      { image: "alpine:latest" },
      { user: "0:0" },
      { mount: "/:/host" },
      { privileged: true },
      { network: "host" },
      { effectClass: "read" },
      { riskClass: "low" },
      { sandboxRequirement: "none" },
      { allowedRoles: ["manager"] },
      { evidencePreconditionPolicyId: "evidence.none.v1" },
      { resourcePolicy: { maxWallClockMs: 999_999_999 } },
      { policyDecision: "allow" },
      { policyId: "policy:caller" },
    ]) {
      await expect(
        authorizeSemanticExecution(request({ parameters })),
        JSON.stringify(parameters),
      ).rejects.toThrow(ApplicationError);
    }
  });

  it("rejects an executable override on a read operation", async () => {
    for (const operationId of ["code.inspect", "git.diff", "git.history"]) {
      await expect(
        authorizeSemanticExecution(
          request({
            operationId,
            parameters: {
              pathScope: ["src/index.ts"],
              executable: "touch",
              arguments: ["/etc/probe"],
            },
          }),
        ),
        operationId,
      ).rejects.toThrow(ApplicationError);
    }
  });

  it("lets only command.run carry a caller-supplied executable, still as an argument array", async () => {
    const plan = await authorizeSemanticExecution(
      request({
        operationId: "command.run",
        parameters: { executable: "/bin/sh", arguments: ["-c", "id"] },
      }),
    );
    expect(plan.command).toEqual({ executable: "/bin/sh", arguments: ["-c", "id"] });

    for (const parameters of [
      { executable: "", arguments: [] },
      { executable: "/bin/sh", arguments: "-c id" },
      { executable: "/bin/sh", arguments: [1, 2] },
      { arguments: [] },
      { executable: "/bin/sh" },
      { executable: "/bin/true", arguments: [], riskClass: "low" },
      { executable: "/bin/true", arguments: [], policyDecision: "allow" },
    ]) {
      await expect(
        authorizeSemanticExecution(request({ operationId: "command.run", parameters })),
        JSON.stringify(parameters),
      ).rejects.toThrow(ApplicationError);
    }
  });

  it("fails closed for an operation with no trusted execution binding yet", async () => {
    for (const operationId of [
      "repo.search",
      "build.check",
      "test.targeted",
      "test.regression",
      "debug.reproduce",
      "browser.inspect",
    ]) {
      let thrown: unknown;
      try {
        await authorizeSemanticExecution(
          request({
            operationId,
            parameters: {
              query: "x",
              selection: "x",
              reproduction: "x",
              target: "x",
              expectation: "x",
            },
          }),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown, operationId).toBeInstanceOf(ApplicationError);
      expect((thrown as ApplicationError).code, operationId).toBe("UNSUPPORTED_OPERATION");
    }
  });

  it("refuses an operation outside the approved catalog before anything is derived", async () => {
    for (const operationId of ["git.worktree", "shell.exec", "docker.run"]) {
      await expect(authorizeSemanticExecution(request({ operationId }))).rejects.toThrow(
        ApplicationError,
      );
    }
  });
});

describe("code.patch is validated at the mandatory execution boundary", () => {
  function patchRequest(
    parameters: Record<string, unknown>,
    observed?: ContentHash,
  ): SemanticExecutionRequest {
    return request({
      operationId: "code.patch",
      parameters: parameters as SemanticExecutionRequest["parameters"],
      ...(observed === undefined ? {} : { observedTargetFingerprint: observed }),
    });
  }

  const valid = {
    expectedFingerprint: currentFingerprint,
    targetPath: "src/index.ts",
    pathScope: ["src/index.ts"],
    patch: "--- a\n+++ b\n",
  };

  it("authorizes a patch whose target is still current", async () => {
    const plan = await authorizeSemanticExecution(patchRequest(valid, currentFingerprint));
    expect(plan.operationId).toBe("code.patch");
    expect(plan.command).toBeNull();
    expect(plan.fingerprints["expectedTarget"]).toBe(currentFingerprint);
    expect(plan.fingerprints["observedTarget"]).toBe(currentFingerprint);
    // The sink re-verifies this precondition immediately before dispatch.
    expect(plan.currencyPrecondition).toEqual({
      path: "src/index.ts",
      expectedFingerprint: currentFingerprint,
      allowedPathScope: ["src/index.ts"],
    });
  });

  it("denies a patch whose target is not inside its own declared path scope", async () => {
    await expect(
      authorizeSemanticExecution(
        patchRequest(
          {
            expectedFingerprint: currentFingerprint,
            targetPath: "src/other.ts",
            pathScope: ["src/index.ts"],
            patch: "x",
          },
          currentFingerprint,
        ),
      ),
    ).rejects.toThrow(ApplicationError);
  });

  it("denies a patch with a missing or escaping target path", async () => {
    for (const targetPath of [undefined, "../escape.ts", "/abs.ts", 5]) {
      await expect(
        authorizeSemanticExecution(
          patchRequest(
            {
              expectedFingerprint: currentFingerprint,
              pathScope: ["src/index.ts"],
              patch: "x",
              ...(targetPath === undefined ? {} : { targetPath }),
            },
            currentFingerprint,
          ),
        ),
        String(targetPath),
      ).rejects.toThrow(ApplicationError);
    }
  });

  it("denies a patch with no expected fingerprint", async () => {
    await expect(
      authorizeSemanticExecution(
        patchRequest(
          { targetPath: "src/index.ts", pathScope: ["src/index.ts"], patch: "x" },
          currentFingerprint,
        ),
      ),
    ).rejects.toThrow(ApplicationError);
  });

  it("denies a patch with a missing, empty, or escaping path scope", async () => {
    for (const pathScope of [undefined, [], ["../escape.ts"], ["/abs.ts"]]) {
      await expect(
        authorizeSemanticExecution(
          patchRequest(
            {
              expectedFingerprint: currentFingerprint,
              patch: "x",
              ...(pathScope === undefined ? {} : { pathScope }),
            },
            currentFingerprint,
          ),
        ),
        JSON.stringify(pathScope),
      ).rejects.toThrow(ApplicationError);
    }
  });

  it("denies a patch whose currency cannot be proven at all", async () => {
    let thrown: unknown;
    try {
      await authorizeSemanticExecution(patchRequest(valid));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as ApplicationError).code).toBe("PERMISSION_DENIED");
  });

  it("rejects a stale patch with CONFLICT instead of overwriting newer work", async () => {
    let thrown: unknown;
    try {
      await authorizeSemanticExecution(patchRequest(valid, otherFingerprint));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as ApplicationError).code).toBe("CONFLICT");
  });
});

describe("authorization binding", () => {
  it("produces a capability its own boundary accepts, bound to this task, job, workspace, and sandbox", async () => {
    const plan = await authorizeSemanticExecution(request());
    expect(boundary.capabilities.verify(plan)).toBe(plan);
    expect(plan.executionPlanId).toBe("plan:1");
    expect(plan.taskId).toBe(taskId);
    expect(plan.jobId).toBe(jobId);
    expect(plan.workspaceId).toBe(workspace.id);
    expect(plan.sandboxId).toBe(sandbox.id);
  });

  it("refuses to issue anything without policy, an active workspace, a role, or a sandbox", async () => {
    const escapeHatch = {
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    } as const;
    for (const override of [
      // The read-only auditor and the non-acting manager cannot reach an effect operation.
      { ...escapeHatch, role: "auditor" as const },
      { ...escapeHatch, role: "manager" as const },
      { workspace: { ...workspace, status: "sealed" as const } },
    ]) {
      await expect(
        authorizeSemanticExecution(request(override)),
        JSON.stringify(override),
      ).rejects.toThrow(ApplicationError);
    }
    // An effect operation has no execution path at all without a prepared sandbox.
    await expect(
      authorizeSemanticExecution(
        request({
          operationId: "command.run",
          sandbox: null,
          parameters: { executable: "/bin/true", arguments: [] },
        }),
      ),
    ).rejects.toThrow(ApplicationError);
  });

  it("keeps read operations available so missing evidence can still be acquired", async () => {
    expect(
      (
        await authorizeSemanticExecution(
          request({ operationId: "git.status", role: "auditor", sandbox: null }),
        )
      ).operationId,
    ).toBe("git.status");
  });
});

/**
 * The two halves of the capability contract are deliberately different questions, and Task 3's
 * `EffectReconciler` depends on the distinction: it verifies authenticity before touching
 * authoritative ledger state, and never consumes, because reconciliation performs no effect.
 * Pinning the semantics here means a future change to either half fails loudly rather than
 * silently re-opening a Task 3 authority gap.
 */
describe("capability verify and consume are separate questions", () => {
  it("keeps a consumed capability authentic, while refusing to spend it twice", async () => {
    const plan = await authorizeSemanticExecution(request());
    boundary.capabilities.consume(plan);

    // Authenticity does not expire when the single-use spend does.
    expect(boundary.capabilities.verify(plan)).toBe(plan);
    expect(() => boundary.capabilities.consume(plan)).toThrow(ApplicationError);
  });

  it("refuses another boundary's capability, and a structural copy of its own", async () => {
    const foreign = await createSemanticAuthorizationBoundary({
      policy: allowPolicy,
      preconditions: preconditions(),
    }).authorize(request(), operationContext);
    // The third candidate passes `instanceof` — its prototype chain runs through a real plan —
    // which is exactly why verification is registry identity, not a branding check.
    for (const candidate of [
      foreign,
      { ...(await authorizeSemanticExecution(request())) },
      Object.create(await authorizeSemanticExecution(request())),
      {},
      null,
    ]) {
      let thrown: unknown;
      try {
        boundary.capabilities.verify(candidate);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(candidate)).toBeInstanceOf(ApplicationError);
      expect((thrown as ApplicationError).code).toBe("PERMISSION_DENIED");
    }
    // Nor may an unminted object be spent.
    const copy = { ...(await authorizeSemanticExecution(request())) };
    expect(() => boundary.capabilities.consume(copy)).toThrow(ApplicationError);
  });
});
