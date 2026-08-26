import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/application-errors.js";
import {
  assertPublicToolInvocationStatus,
  SandboxIsolationPolicy,
  type SandboxIsolationPolicyInput,
} from "../src/ports/sandbox.port.js";

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
