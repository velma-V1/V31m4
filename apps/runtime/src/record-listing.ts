import {
  ApplicationError,
  type PortPage,
  type PortPageRequest,
  type Versioned,
} from "@v31m4/application";
import type { SqliteRuntimeDatabase } from "@v31m4/infrastructure";

const CURSOR_PATTERN = /^(?:0|[1-9]\d*)$/u;

/**
 * Reads one persisted record family, applies its authoritative relationship predicate, and only
 * then slices the requested page. Filtering after SQL LIMIT/OFFSET would make page contents,
 * totals, and cursors depend on unrelated records of the same type.
 */
export function listPersistedRecords<Value>(
  database: SqliteRuntimeDatabase,
  recordType: string,
  request: PortPageRequest,
  matches: (value: Value) => boolean = () => true,
): PortPage<Versioned<Value>> {
  const offset = request.cursor === undefined ? 0 : Number(request.cursor);
  if (
    (request.cursor !== undefined && !CURSOR_PATTERN.test(request.cursor)) ||
    !Number.isSafeInteger(offset)
  ) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Pagination cursor is malformed.");
  }
  const rows = database.connection
    .prepare("SELECT revision, body FROM records WHERE record_type = ? ORDER BY rowid ASC")
    .all(recordType) as { revision: number; body: string }[];
  const matching = rows
    .map((row) =>
      Object.freeze({ value: JSON.parse(row.body) as Value, revision: String(row.revision) }),
    )
    .filter((entry) => matches(entry.value));
  const items = matching.slice(offset, offset + request.limit);
  return Object.freeze({
    items: Object.freeze(items),
    total: matching.length,
    ...(offset + request.limit < matching.length
      ? { nextCursor: String(offset + request.limit) }
      : {}),
  });
}
