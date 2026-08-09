import { createHash } from "node:crypto";
import type {
  ApplicationJsonObject,
  ApplicationJsonValue,
  OperationContext,
  UnitOfWorkTransaction,
} from "@v31m4/application";
import { SqliteIdempotencyStore, type SqliteRuntimeDatabase } from "@v31m4/infrastructure";

export interface ExternalCommand<Payload extends ApplicationJsonValue> {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly payload: Payload;
}

/** Canonical JSON with recursively sorted object keys, so payload hashing is stable. */
export function canonicalJson(value: ApplicationJsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const object = value as ApplicationJsonObject;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] as ApplicationJsonValue)}`);
  return `{${entries.join(",")}}`;
}

function payloadHash(payload: ApplicationJsonValue): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * Enforces the external-command idempotency contract against the SQLite authority.
 *
 * The actor + key + command type + canonical payload hash identify one durable command.
 * A repeated command with the same identity returns the stored result without re-running
 * the operation; the same actor/key with a different type or payload is a conflict. The
 * operation and its idempotency record commit in one serialized transaction, so a timeout
 * followed by a retry cannot duplicate a durable effect and concurrent duplicates collapse
 * to a single commit. A stale `expectedRevision` surfaces as the operation's own version
 * conflict and leaves no idempotency record behind.
 */
export class ExternalCommandExecutor {
  readonly #idempotency: SqliteIdempotencyStore;

  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#idempotency = new SqliteIdempotencyStore(database);
  }

  async execute<Payload extends ApplicationJsonValue, Result>(
    command: ExternalCommand<Payload>,
    context: OperationContext,
    run: (transaction: UnitOfWorkTransaction) => Promise<Result>,
  ): Promise<Result> {
    const hash = payloadHash(command.payload);
    const existing = await this.#idempotency.lookup(
      command.actorId,
      command.idempotencyKey,
      command.commandType,
      hash,
    );
    if (existing?.status === "completed") return existing.result as Result;

    return this.database.unitOfWork.execute(context, async (transaction) => {
      // Re-check inside the serialized transaction to close the duplicate-writer race.
      const committed = await this.#idempotency.lookup(
        command.actorId,
        command.idempotencyKey,
        command.commandType,
        hash,
      );
      if (committed?.status === "completed") return committed.result as Result;
      const result = await run(transaction);
      await this.#idempotency.complete(
        command.actorId,
        command.idempotencyKey,
        command.commandType,
        hash,
        result,
      );
      return result;
    });
  }
}
