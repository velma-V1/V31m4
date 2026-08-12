import { ApplicationError } from "@v31m4/application";

const CURSOR_PATTERN = /^(?:0|[1-9]\d*)$/u;

/** Parses an opaque offset cursor without accepting partial numbers, signs, or unsafe integers. */
export function parsePaginationCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!CURSOR_PATTERN.test(cursor) || !Number.isSafeInteger(offset)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Pagination cursor is malformed.");
  }
  return offset;
}
