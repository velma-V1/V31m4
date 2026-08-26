import { JobId, ProjectId, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/application-errors.js";
import {
  assertPublicToolInvocationStatus,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type SandboxIsolationPolicyInput,
} from "../src/ports/sandbox.port.js";
import {
  createSemanticExecutionAuthority,
  type SemanticExecutionAuthorizationInput,
} from "../src/ports/semantic-execution-capability.js";
import type { WorkspaceHandle } from "../src/ports/workspace-manager.port.js";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1.
 *
 * `SandboxIsolationPolicy` is the application-local typed isolation contract the existing
 * public `ResourceBudget` cannot express. Every security-relevant field is a fixed literal
 * that a caller cannot relax, and the resource bounds must be explicitly supplied — there is
 * no "unbounded by omission" path.
 */
const minimalInput: SandboxIsolationPolicyInput = {
  maxCpuMillisPerSecond: 500,
  maxPids: 64,
};

describe("SandboxIsolationPolicy", () => {
  it("defaults to the most restrictive posture when only resource bounds are supplied", () => {
    const policy = SandboxIsolationPolicy.create(minimalInput);
    expect(policy.network).toEqual({ mode: "none" });
    expect(policy.writableWorkspaceOnly).toBe(true);
    expect(policy.readOnlyRootFilesystem).toBe(true);
    expect(policy.nonRootUser).toBe(true);
    expect(policy.noNewPrivileges).toBe(true);
    expect(policy.dropAllCapabilities).toBe(true);
    expect(policy.allowHostDockerSocket).toBe(false);
    expect(policy.allowAmbientHostSecrets).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.network)).toBe(true);
  });

  it("refuses every attempt to relax a security invariant", () => {
    for (const override of [
      { writableWorkspaceOnly: false },
      { readOnlyRootFilesystem: false },
      { nonRootUser: false },
      { noNewPrivileges: false },
      { dropAllCapabilities: false },
      { allowHostDockerSocket: true },
      { allowAmbientHostSecrets: true },
    ]) {
      expect(() =>
        SandboxIsolationPolicy.create({
          ...minimalInput,
          ...override,
        } as SandboxIsolationPolicyInput),
      ).toThrow(ApplicationError);
    }
  });

  it("requires explicit, bounded CPU and PID limits", () => {
    for (const invalid of [
      { maxCpuMillisPerSecond: 0, maxPids: 64 },
      { maxCpuMillisPerSecond: 1.5, maxPids: 64 },
      { maxCpuMillisPerSecond: 64_001, maxPids: 64 },
      { maxCpuMillisPerSecond: 500, maxPids: 0 },
      { maxCpuMillisPerSecond: 500, maxPids: 4_097 },
    ]) {
      expect(() => SandboxIsolationPolicy.create(invalid)).toThrow(ApplicationError);
    }
  });

  it("accepts only a bounded, unique, syntactically valid egress allowlist", () => {
    const policy = SandboxIsolationPolicy.create({
      ...minimalInput,
      network: { mode: "allowlist", hosts: ["registry.internal", "127.0.0.1"] },
    });
    expect(policy.network).toEqual({
      mode: "allowlist",
      hosts: ["registry.internal", "127.0.0.1"],
    });

    for (const hosts of [
      [],
      ["dup", "dup"],
      ["*"],
      ["https://example.test"],
      ["has space"],
      ["host/path"],
      ["x".repeat(254)],
    ]) {
      expect(() =>
        SandboxIsolationPolicy.create({ ...minimalInput, network: { mode: "allowlist", hosts } }),
      ).toThrow(ApplicationError);
    }
  });

  /**
   * The invariant booleans are literal types, so TypeScript already refuses to relax them. The two
   * ceilings are plain numbers, and a structural literal that never went through `create` used to
   * satisfy the interface and reach the container argument builder unbounded. `assertCanonical` is
   * the runtime half of that repair, for the paths a type cannot guard.
   */
  it("refuses a policy it did not issue, and re-asserts every bound it did", () => {
    const canonical = SandboxIsolationPolicy.create(minimalInput);
    expect(canonical.policyKind).toBe("sandbox_isolation_policy");
    expect(() => SandboxIsolationPolicy.assertCanonical(canonical)).not.toThrow();

    const { policyKind: _issued, ...unbranded } = canonical;
    for (const candidate of [
      unbranded,
      { ...canonical, maxPids: -1 },
      { ...canonical, maxPids: 0 },
      { ...canonical, maxPids: 4_097 },
      { ...canonical, maxCpuMillisPerSecond: Number.NaN },
      { ...canonical, maxCpuMillisPerSecond: 64_001 },
      { ...canonical, writableWorkspaceOnly: false },
      { ...canonical, allowHostDockerSocket: true },
      {},
      null,
    ]) {
      let thrown: unknown;
      try {
        SandboxIsolationPolicy.assertCanonical(candidate as SandboxIsolationPolicy);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(candidate)).toBeInstanceOf(ApplicationError);
    }
  });
});

describe("sandbox execution status model", () => {
  it("keeps the internal unknown state out of the public v1 tool status", () => {
    expect(assertPublicToolInvocationStatus("completed")).toBe("completed");
    expect(assertPublicToolInvocationStatus("failed")).toBe("failed");
    expect(assertPublicToolInvocationStatus("cancelled")).toBe("cancelled");

    // The v1 public contract has no `unknown`; an unreconciled effect must surface as an
    // integrity condition rather than be silently coerced into a success or a failure.
    let thrown: unknown;
    try {
      assertPublicToolInvocationStatus("unknown");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationError);
    expect((thrown as ApplicationError).code).toBe("INTEGRITY_FAILURE");
  });
});

describe("semantic execution capabilities", () => {
  const taskId = TaskId.parse("task:root");
  const jobId = JobId.parse("job:1");
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

  let counter = 0;
  function authority() {
    return createSemanticExecutionAuthority({
      generateExecutionPlanId: () => `plan:${++counter}`,
      now: () => "2026-08-25T00:00:00.000Z",
    });
  }

  function input(
    overrides: Partial<SemanticExecutionAuthorizationInput> = {},
  ): SemanticExecutionAuthorizationInput {
    return {
      contract: {
        operationId: "code.patch",
        effectClass: "workspace_write",
        riskClass: "high",
        sandboxRequirement: "required",
        allowedRoles: ["executor"],
        evidencePreconditionPolicyId: "evidence.patch_requires_current_target.v1",
        resourcePolicy: {
          maxWallClockMs: 900_000,
          maxOutputBytes: 4_194_304,
          maxConcurrent: 1,
        },
        allowsCallerSuppliedCommand: false,
      },
      role: "executor",
      policyGrant: {
        decision: "allow",
        policyId: "policy:test-semantic-execution",
        reasons: [],
        requiredApprovalScopes: [],
      },
      taskId,
      jobId,
      workspace,
      sandbox,
      command: null,
      parameters: {},
      ...overrides,
    };
  }

  it("mints a frozen, uniquely identified capability bound to one execution", () => {
    const issuer = authority();
    const plan = issuer.mint(input({ command: { executable: "git", arguments: ["status"] } }));
    expect(plan.operationId).toBe("code.patch");
    expect(plan.taskId).toBe(taskId);
    expect(plan.jobId).toBe(jobId);
    expect(plan.workspaceId).toBe(workspace.id);
    expect(plan.sandboxId).toBe(sandbox.id);
    expect(plan.command).toEqual({ executable: "git", arguments: ["status"] });
    expect(plan.executionPlanId).toMatch(/^plan:\d+$/u);
    expect(plan.issuedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.command)).toBe(true);
    expect(issuer.verify(plan)).toBe(plan);
  });

  it("cannot be constructed outside an authority", () => {
    const issuer = authority();
    const plan = issuer.mint(input());
    const PlanClass = plan.constructor as new (...args: unknown[]) => unknown;
    // Neither a wrong token nor no token at all produces an instance.
    expect(
      () => new PlanClass(Symbol("forged"), input(), "plan:x", "2026-08-25T00:00:00.000Z"),
    ).toThrow(ApplicationError);
    expect(() => new PlanClass(undefined, input(), "plan:x", "2026-08-25T00:00:00.000Z")).toThrow(
      ApplicationError,
    );
  });

  it("accepts only capabilities its own closure minted", () => {
    const first = authority();
    const second = authority();
    const plan = second.mint(input());
    // A real, correctly bound plan from a different authority is still refused: authenticity is
    // issuer identity, not class identity or structural shape.
    expect(() => first.verify(plan)).toThrow(ApplicationError);
    expect(() => first.consume(plan)).toThrow(ApplicationError);
    expect(second.verify(plan)).toBe(plan);
  });

  it("refuses anything that is not a minted capability", () => {
    const issuer = authority();
    for (const value of [
      null,
      "plan",
      42,
      {
        operationId: "code.inspect",
        effectClass: "read",
        taskId,
        jobId,
        workspaceId: workspace.id,
        sandboxId: sandbox.id,
        command: { executable: "touch", arguments: ["/etc/probe"] },
        parameters: {},
        fingerprints: {},
      },
    ]) {
      expect(() => issuer.verify(value)).toThrow(ApplicationError);
    }
  });

  it("spends a capability exactly once", () => {
    const issuer = authority();
    const plan = issuer.mint(input());
    expect(() => issuer.consume(plan)).not.toThrow();
    expect(() => issuer.consume(plan)).toThrow(ApplicationError);
  });

  it("refuses to mint when any precondition is missing", () => {
    const issuer = authority();
    const cases: ReadonlyArray<readonly [string, Partial<SemanticExecutionAuthorizationInput>]> = [
      ["role not allowed", { role: "auditor" }],
      ["policy denied", { policyGrant: { ...input().policyGrant, decision: "deny" as const } }],
      [
        "approval required",
        { policyGrant: { ...input().policyGrant, decision: "require_approval" as const } },
      ],
      ["workspace no longer active", { workspace: { ...workspace, status: "sealed" as const } }],
      ["no prepared sandbox", { sandbox: null }],
      ["sandbox bound to another workspace", { sandbox: { ...sandbox, workspaceId: "other" } }],
      [
        "sandbox bound to another task",
        { sandbox: { ...sandbox, taskId: TaskId.parse("task:x") } },
      ],
      ["sandbox bound to another job", { sandbox: { ...sandbox, jobId: JobId.parse("job:x") } }],
      ["sandbox already stopped", { sandbox: { ...sandbox, status: "stopped" as const } }],
      ["sandbox degraded", { sandbox: { ...sandbox, status: "degraded" as const } }],
      ["sandbox running", { sandbox: { ...sandbox, status: "running" as const } }],
      ["empty executable", { command: { executable: "", arguments: [] } }],
    ];
    for (const [label, override] of cases) {
      expect(() => issuer.mint(input(override)), label).toThrow(ApplicationError);
    }
  });
});
