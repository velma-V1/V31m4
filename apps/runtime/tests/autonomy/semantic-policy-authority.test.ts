import {
  createOperationContext,
  type PolicyEnginePort,
  type PolicyResult,
  type SandboxHandle,
  type WorkspaceHandle,
} from "@v31m4/application";
import { JobId, ProjectId, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createSemanticAuthorizationBoundary,
  type SemanticAuthorizationBoundaryOptions,
  type SemanticExecutionRequest,
} from "../../src/autonomy/semantic-execution-authorization.js";

const taskId = TaskId.parse("task:policy-binding");
const jobId = JobId.parse("job:policy-binding");
const workspace: WorkspaceHandle = Object.freeze({
  id: "workspace-policy-binding",
  projectId: ProjectId.parse("project:policy-binding"),
  purpose: "tool_execution" as const,
  rootPath: SafePath.parse("workspace-policy-binding"),
  status: "active" as const,
  createdAt: "2026-08-25T00:00:00.000Z",
});
const sandbox: SandboxHandle = Object.freeze({
  id: SandboxId.parse("sandbox:policy-binding"),
  taskId,
  jobId,
  workspaceId: workspace.id,
  backendId: "reference",
  status: "ready" as const,
});
const operationContext = createOperationContext({
  requestId: "request:policy-binding",
  idempotencyKey: "key:policy-binding",
  actor: { id: "runtime", kind: "system", roles: ["runtime"] },
  startedAt: "2026-08-25T00:00:00.000Z",
});

function request(): SemanticExecutionRequest {
  return {
    operationId: "git.status",
    role: "executor",
    taskId,
    jobId,
    workspace,
    sandbox,
    parameters: {},
  };
}

function policy(result: PolicyResult): PolicyEnginePort {
  return { evaluate: vi.fn(async () => result) };
}

function options(policyEngine: PolicyEnginePort): SemanticAuthorizationBoundaryOptions {
  return {
    policy: policyEngine,
    generateExecutionPlanId: () => "plan:policy-binding",
    now: () => "2026-08-25T00:00:00.000Z",
  };
}

describe("semantic policy and resource authority", () => {
  it("rejects a naked caller allow when the real policy engine denies", async () => {
    const engine = policy({
      decision: "deny",
      policyId: "policy:deny-semantic",
      reasons: ["denied by canonical policy"],
      requiredApprovalScopes: [],
    });
    const boundary = createSemanticAuthorizationBoundary(options(engine));
    const forgedAllow = { ...request(), policyDecision: "allow" } as SemanticExecutionRequest;

    await expect(boundary.authorize(forgedAllow, operationContext)).rejects.toThrow();
    expect(engine.evaluate).toHaveBeenCalledTimes(1);
  });

  it("binds immutable policy provenance and canonical catalog limits into the plan", async () => {
    const engine = policy({
      decision: "allow",
      policyId: "policy:semantic-git-status",
      reasons: ["runtime role permitted"],
      requiredApprovalScopes: [],
      expiresAt: "2026-08-25T00:05:00.000Z",
    });
    const boundary = createSemanticAuthorizationBoundary(options(engine));
    const plan = await boundary.authorize(request(), operationContext);

    expect(plan).toMatchObject({
      riskClass: "low",
      evidencePreconditionPolicyId: "evidence.none.v1",
      resourcePolicy: {
        maxWallClockMs: 30_000,
        maxOutputBytes: 1_048_576,
        maxConcurrent: 4,
      },
      policyGrant: {
        decision: "allow",
        policyId: "policy:semantic-git-status",
        expiresAt: "2026-08-25T00:05:00.000Z",
      },
    });
    expect(Object.isFrozen(plan.resourcePolicy)).toBe(true);
    expect(Object.isFrozen(plan.policyGrant)).toBe(true);
  });

  it("rejects an expired policy grant before dispatch authority exists", async () => {
    const engine = policy({
      decision: "allow",
      policyId: "policy:expired",
      reasons: [],
      requiredApprovalScopes: [],
      expiresAt: "2026-08-24T23:59:59.999Z",
    });
    const boundary = createSemanticAuthorizationBoundary(options(engine));

    await expect(boundary.authorize(request(), operationContext)).rejects.toThrow();
  });

  it("routes approval-required decisions to the existing governed approval boundary", async () => {
    const engine = policy({
      decision: "require_approval",
      policyId: "policy:approval-required",
      reasons: ["operator grant required"],
      requiredApprovalScopes: ["semantic:execute"],
    });
    const boundary = createSemanticAuthorizationBoundary(options(engine));

    await expect(boundary.authorize(request(), operationContext)).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
    });
  });

  it("rejects a grant that expires after issuance when the sink verifies it", async () => {
    let now = "2026-08-25T00:00:00.000Z";
    const engine = policy({
      decision: "allow",
      policyId: "policy:short-lived",
      reasons: [],
      requiredApprovalScopes: [],
      expiresAt: "2026-08-25T00:01:00.000Z",
    });
    const boundary = createSemanticAuthorizationBoundary({
      policy: engine,
      generateExecutionPlanId: () => "plan:short-lived",
      now: () => now,
    });
    const plan = await boundary.authorize(request(), operationContext);
    now = "2026-08-25T00:01:00.000Z";
    expect(() => boundary.capabilities.verify(plan)).toThrow();
  });

  it("binds the exact request snapshot evaluated by policy despite caller mutation", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: PolicyEnginePort = {
      async evaluate() {
        await gate;
        return {
          decision: "allow",
          policyId: "policy:snapshot",
          reasons: [],
          requiredApprovalScopes: [],
        };
      },
    };
    const boundary = createSemanticAuthorizationBoundary(options(engine));
    const parameters = { pathScope: ["target.ts"] };
    const mutable = { ...request(), operationId: "git.diff", parameters };

    const pending = boundary.authorize(mutable, operationContext);
    parameters.pathScope[0] = "../escape";
    release?.();
    const plan = await pending;

    expect(plan.parameters).toEqual({ pathScope: ["target.ts"] });
    expect(plan.command).toEqual({
      executable: "git",
      arguments: ["diff", "--no-color", "--", "target.ts"],
    });
  });
});
