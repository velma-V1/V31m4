import { ApplicationError, type OperationContext, type ToolGatewayPort } from "@v31m4/application";
import type { ToolProfile } from "@v31m4/domain";

const PROVIDER_PAGE_LIMIT = 500;
const MAXIMUM_CATALOG_ITEMS = 50_000;
const MAXIMUM_CATALOG_PAGES = 1_000;
const OPAQUE_CURSOR_PATTERN = /^\S{1,256}$/u;

/** Reads the complete provider-neutral tool catalog through bounded opaque pagination. */
export async function collectCompleteToolCatalog(
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
