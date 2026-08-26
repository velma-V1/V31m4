import type { AuthorizedSemanticExecutionPlan, SandboxExecutionResult } from "@v31m4/application";
import type { SandboxBackend, SandboxExecutionSpec } from "./sandbox-supervisor.js";
import {
  assertExistingDirectory,
  fingerprintWorkspaceFile,
  readPathScope,
} from "./workspace-guards.js";

/**
 * Hermetic reference backend.
 *
 * It performs real work — real path containment against the assigned workspace and real
 * SHA-256 fingerprints of real file bytes — so tests exercise the actual boundary rather than
 * a stub. It deliberately performs **no** effects: an effectful request returns an honest
 * `failed` result naming the reason instead of fabricating success. It is the default for
 * hermetic verification and is not a security boundary; real isolation comes from a backend
 * such as the direct-Docker challenger, chosen only after a target-host bake-off.
 */
export class ReferenceSandboxBackend implements SandboxBackend {
  readonly id = "reference";

  async prepare(spec: SandboxExecutionSpec): Promise<void> {
    await assertExistingDirectory(spec.workspaceRoot);
  }

  async execute(
    spec: SandboxExecutionSpec,
    plan: AuthorizedSemanticExecutionPlan,
  ): Promise<SandboxExecutionResult> {
    if (plan.effectClass !== "read") {
      return Object.freeze({
        status: "failed" as const,
        outputArtifactIds: Object.freeze([]),
        logArtifactIds: Object.freeze([]),
        metadata: Object.freeze({
          reason: "reference_backend_performs_no_effects",
          operationId: plan.operationId,
        }),
      });
    }
    const fingerprints: Record<string, string> = {};
    for (const path of readPathScope(plan.parameters)) {
      fingerprints[path] = await fingerprintWorkspaceFile(spec.workspaceRoot, path);
    }
    return Object.freeze({
      status: "completed" as const,
      outputArtifactIds: Object.freeze([]),
      logArtifactIds: Object.freeze([]),
      metadata: Object.freeze({
        operationId: plan.operationId,
        fingerprints: Object.freeze(fingerprints),
      }),
    });
  }

  async cancel(): Promise<void> {}
  async destroy(): Promise<void> {}
}
