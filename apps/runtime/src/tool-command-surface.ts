import {
  ApplicationError,
  type ApplicationJsonValue,
  type OperationContext,
  type ToolGatewayPort,
} from "@v31m4/application";
import { listToolsRequestSchema, listToolsResponseSchema } from "@v31m4/contracts";
import type { ToolProfile } from "@v31m4/domain";
import { parsePaginationCursor } from "@v31m4/infrastructure";
import type { RuntimeService } from "./composition-root.js";
import { parseCommandPayload } from "./use-case-infrastructure.js";

const PROVIDER_PAGE_LIMIT = 500;
const MAXIMUM_CATALOG_ITEMS = 50_000;
const MAXIMUM_CATALOG_PAGES = 1_000;
const OPAQUE_CURSOR_PATTERN = /^\S{1,256}$/u;

export interface ToolSurfaceDependencies {
  readonly tools: ToolGatewayPort;
}

/** Registers the provider-neutral governed tool query/command surface. */
export function registerToolSurface(
  service: RuntimeService,
  dependencies: ToolSurfaceDependencies,
): void {
  service.registerQuery("tool.list", async (payload, context) => {
    const request = parseCommandPayload(listToolsRequestSchema, payload);
    const all = await collectCompleteToolCatalog(dependencies.tools, context);
    const filtered = all.filter(
      (profile) =>
        (request.status === undefined || profile.status === request.status) &&
        (request.automationMethod === undefined ||
          profile.automationMethod === request.automationMethod) &&
        (request.operation === undefined || profile.operations.includes(request.operation)),
    );
    const start = request.pagination.offset ?? parsePaginationCursor(request.pagination.cursor);
    const tools = filtered.slice(start, start + request.pagination.limit);
    const next = start + request.pagination.limit;
    return listToolsResponseSchema.parse({
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      tools,
      pagination: {
        total: filtered.length,
        ...(next < filtered.length ? { nextCursor: String(next) } : {}),
      },
    }) as unknown as ApplicationJsonValue;
  });
}

async function collectCompleteToolCatalog(
  tools: ToolGatewayPort,
  context: OperationContext,
): Promise<readonly ToolProfile[]> {
  const collected: ToolProfile[] = [];
  const toolIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let declaredTotal: number | undefined;

  for (let pageNumber = 0; pageNumber < MAXIMUM_CATALOG_PAGES; pageNumber += 1) {
    const page = await tools.list(
      { limit: PROVIDER_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      context,
    );
    if (page.items.length > PROVIDER_PAGE_LIMIT) malformed("page exceeds the requested limit");
    if (page.total !== undefined) {
      if (!Number.isSafeInteger(page.total) || page.total < 0) malformed("total is invalid");
      if (declaredTotal !== undefined && declaredTotal !== page.total) {
        malformed("total changed between pages");
      }
      declaredTotal = page.total;
    }
    for (const profile of page.items) {
      if (toolIds.has(profile.toolId)) malformed("tool ID repeats across pages");
      toolIds.add(profile.toolId);
      collected.push(profile);
    }
    if (collected.length > MAXIMUM_CATALOG_ITEMS) {
      throw new ApplicationError(
        "RESOURCE_EXHAUSTED",
        "Tool catalog exceeds the supported item bound.",
        { details: { maximumItems: MAXIMUM_CATALOG_ITEMS } },
      );
    }
    if (page.nextCursor === undefined) {
      if (declaredTotal !== undefined && declaredTotal !== collected.length) {
        malformed("terminal count does not match total");
      }
      return Object.freeze(collected);
    }
    if (
      page.items.length === 0 ||
      !OPAQUE_CURSOR_PATTERN.test(page.nextCursor) ||
      page.nextCursor === cursor ||
      seenCursors.has(page.nextCursor)
    ) {
      malformed("next cursor is invalid or cyclic");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new ApplicationError(
    "RESOURCE_EXHAUSTED",
    "Tool catalog exceeds the supported page bound.",
    { details: { maximumPages: MAXIMUM_CATALOG_PAGES } },
  );
}

function malformed(reason: string): never {
  throw new ApplicationError("INTEGRITY_FAILURE", "Tool catalog pagination is malformed.", {
    details: { reason },
  });
}
