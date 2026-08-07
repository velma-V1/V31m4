import type { PluginProfile } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { ApprovalStorePort } from "../ports/approval-store.port.js";
import type { AuditStorePort } from "../ports/audit-store.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PluginManifest, PluginRegistryPort } from "../ports/plugin-registry.port.js";
import type { PolicyEnginePort } from "../ports/policy-engine.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { Versioned } from "../port-types.js";
import { appendAudit, authorizeAction } from "./use-case-support.js";

export interface RegisterPluginDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly plugins: PluginRegistryPort;
  readonly policy: PolicyEnginePort;
  readonly approvals: ApprovalStorePort;
  readonly audit: AuditStorePort;
  readonly clock: ClockPort;
}

export async function registerPlugin(
  dependencies: RegisterPluginDependencies,
  manifest: PluginManifest,
  auditId: string,
  approvalId: string | undefined,
  context: OperationContext,
): Promise<Versioned<PluginProfile>> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    await authorizeAction(dependencies, {
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: manifest.pluginId,
      attributes: { version: manifest.version, network: manifest.permissions.network },
    }, approvalId, context, transaction);
    const stored = await dependencies.plugins.register(manifest, context, transaction);
    await appendAudit(dependencies.audit, dependencies.clock, {
      id: auditId,
      action: "plugin.register",
      resourceType: "plugin",
      resourceId: manifest.pluginId,
      outcome: "completed",
      details: { version: manifest.version },
    }, context, transaction);
    return stored;
  });
}
