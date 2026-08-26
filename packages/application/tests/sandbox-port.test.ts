import { JobId, ProjectId, SafePath, SandboxId, TaskId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/application-errors.js";
import {
  AuthorizedSemanticExecutionPlan,
  assertPublicToolInvocationStatus,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type SandboxIsolationPolicyInput,
  type SemanticExecutionAuthorizationInput,
} from "../src/ports/sandbox.port.js";
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

describe("AuthorizedSemanticExecutionPlan", () => {
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

  function input(
    overrides: Partial<SemanticExecutionAuthorizationInput> = {},
  ): SemanticExecutionAuthorizationInput {
    return {
      contract: {
        operationId: "code.patch",
        effectClass: "workspace_write",
        sandboxRequirement: "required",
        allowedRoles: ["executor"],
        allowsCallerSuppliedCommand: false,
      },
      role: "executor",
      policyDecision: "allow",
      taskId,
      jobId,
      workspace,
      sandbox,
      command: null,
      parameters: {},
      ...overrides,
    };
  }

  it("issues a frozen plan bound to one operation, task, job, workspace, and sandbox", () => {
    const plan = AuthorizedSemanticExecutionPlan.issue(
      input({ command: { executable: "git", arguments: ["status"] } }),
    );
    expect(plan.operationId).toBe("code.patch");
    expect(plan.taskId).toBe(taskId);
    expect(plan.jobId).toBe(jobId);
    expect(plan.workspaceId).toBe(workspace.id);
    expect(plan.sandboxId).toBe(sandbox.id);
    expect(plan.command).toEqual({ executable: "git", arguments: ["status"] });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.command)).toBe(true);
    expect(AuthorizedSemanticExecutionPlan.isAuthentic(plan)).toBe(true);
  });

  it("refuses every missing precondition", () => {
    const cases: ReadonlyArray<readonly [string, Partial<SemanticExecutionAuthorizationInput>]> = [
      ["role not allowed", { role: "auditor" }],
      ["policy denied", { policyDecision: "deny" as const }],
      ["approval required", { policyDecision: "require_approval" as const }],
      ["workspace no longer active", { workspace: { ...workspace, status: "sealed" as const } }],
      ["no prepared sandbox", { sandbox: null }],
      ["sandbox bound to another workspace", { sandbox: { ...sandbox, workspaceId: "other" } }],
      [
        "sandbox bound to another task",
        { sandbox: { ...sandbox, taskId: TaskId.parse("task:x") } },
      ],
      ["sandbox bound to another job", { sandbox: { ...sandbox, jobId: JobId.parse("job:x") } }],
      ["sandbox already stopped", { sandbox: { ...sandbox, status: "stopped" as const } }],
      ["empty executable", { command: { executable: "", arguments: [] } }],
    ];
    for (const [label, override] of cases) {
      expect(() => AuthorizedSemanticExecutionPlan.issue(input(override)), label).toThrow(
        ApplicationError,
      );
    }
  });

  it("does not recognise a structurally forged look-alike", () => {
    const forged = {
      operationId: "code.inspect",
      effectClass: "read",
      taskId,
      jobId,
      workspaceId: workspace.id,
      sandboxId: sandbox.id,
      command: { executable: "touch", arguments: ["/etc/probe"] },
      parameters: {},
      fingerprints: {},
    };
    expect(AuthorizedSemanticExecutionPlan.isAuthentic(forged)).toBe(false);
    expect(AuthorizedSemanticExecutionPlan.isAuthentic(null)).toBe(false);
    expect(AuthorizedSemanticExecutionPlan.isAuthentic("plan")).toBe(false);
  });
});
