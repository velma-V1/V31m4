import { ApplicationError, type ModelGatewayPort, type OperationContext } from "@v31m4/application";
import type { ModelProfile } from "@v31m4/domain";

const PROVIDER_PAGE_LIMIT = 500;
const MAXIMUM_CATALOG_ITEMS = 50_000;
const MAXIMUM_CATALOG_PAGES = 1_000;
const OPAQUE_CURSOR_PATTERN = /^\S{1,256}$/u;

/** Reads the complete provider-neutral model catalog through bounded opaque pagination. */
export async function collectCompleteModelCatalog(
  models: ModelGatewayPort,
  context: OperationContext,
): Promise<readonly ModelProfile[]> {
  const collected: ModelProfile[] = [];
  const modelIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let declaredTotal: number | undefined;

  for (let pageNumber = 0; pageNumber < MAXIMUM_CATALOG_PAGES; pageNumber += 1) {
    const page = await models.list(
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
      if (modelIds.has(profile.modelId)) malformed("model ID repeats across pages");
      modelIds.add(profile.modelId);
      collected.push(profile);
    }
    if (collected.length > MAXIMUM_CATALOG_ITEMS) {
      throw new ApplicationError(
        "RESOURCE_EXHAUSTED",
        "Model catalog exceeds the supported item bound.",
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
    "Model catalog exceeds the supported page bound.",
    { details: { maximumPages: MAXIMUM_CATALOG_PAGES } },
  );
}

function malformed(reason: string): never {
  throw new ApplicationError("INTEGRITY_FAILURE", "Model catalog pagination is malformed.", {
    details: { reason },
  });
}
