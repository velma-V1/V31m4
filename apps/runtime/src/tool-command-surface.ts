import { ApplicationError, type JobRepositoryPort } from "@v31m4/application";
import { invokeToolRequestSchema } from "@v31m4/contracts";
import type { RuntimeService } from "./composition-root.js";
import { parseCommandPayload } from "./use-case-infrastructure.js";

export interface ToolCommandDependencies {
  readonly jobs: JobRepositoryPort;
}

/** Registers general tool commands while keeping effects behind the existing ToolGatewayPort path. */
export function registerToolCommands(
  service: RuntimeService,
  dependencies: ToolCommandDependencies,
): void {
  service.registerDirect("tool.invoke", async (payload, context) => {
    const request = parseCommandPayload(invokeToolRequestSchema, payload);
    const job = await dependencies.jobs.getById(request.jobId, context);
    if (job === null) {
      throw new ApplicationError("NOT_FOUND", "Job does not exist.", {
        details: { jobId: request.jobId },
      });
    }
    if (job.value.status !== "running") {
      throw new ApplicationError("CONFLICT", "Job must be running to invoke a tool.", {
        details: { jobId: request.jobId, status: job.value.status },
      });
    }
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "General tool execution is not composed for this runtime profile.",
      { details: { toolId: request.toolId } },
    );
  });
}
