import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type ApplicationJsonValue,
  isApplicationJsonValue,
  type OperationContext,
  type UnitOfWorkTransaction,
  type WriteCondition,
  WriteConditions,
} from "@v31m4/application";
import { createDomainEvent } from "@v31m4/domain";
import {
  EventReplayStore,
  SqliteOutbox,
  SqliteRecordStore,
  SqliteRuntimeDatabase,
} from "@v31m4/infrastructure";
import { LocalSessionAuthenticator } from "./api/auth.js";
import { EventStreamCoordinator } from "./event-stream.js";
import { ExternalCommandExecutor } from "./external-command-executor.js";
import type { RuntimeConfig } from "./runtime-config.js";

const NAME_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** An authoritative command handler running inside the serialized command transaction. */
export type CommandHandler = (
  payload: ApplicationJsonValue,
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
) => Promise<ApplicationJsonValue>;

function asObject(value: ApplicationJsonValue): ApplicationJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", "Command payload must be an object.");
  }
  return value as ApplicationJsonObject;
}

function requireString(object: ApplicationJsonObject, key: string, pattern: RegExp): string {
  const value = object[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `Command field '${key}' is invalid.`, {
      details: { field: key },
    });
  }
  return value;
}

/**
 * Command and query surface for the runtime. Commands run through the {@link ExternalCommandExecutor}
 * so the external-command idempotency contract holds for every route; handlers contain the
 * authoritative effect while HTTP routes only translate transport to these calls.
 */
export class RuntimeService {
  readonly #handlers = new Map<string, CommandHandler>();

  constructor(
    private readonly executor: ExternalCommandExecutor,
    private readonly records: SqliteRecordStore,
  ) {}

  register(commandType: string, handler: CommandHandler): void {
    this.#handlers.set(commandType, handler);
  }

  async dispatch(
    commandType: string,
    payload: ApplicationJsonValue,
    context: OperationContext,
  ): Promise<ApplicationJsonValue> {
    const handler = this.#handlers.get(commandType);
    if (handler === undefined) {
      throw new ApplicationError("UNSUPPORTED_OPERATION", "Unknown command type.", {
        details: { commandType },
      });
    }
    return this.executor.execute(
      {
        actorId: context.actor.id,
        idempotencyKey: context.idempotencyKey,
        commandType,
        payload,
      },
      context,
      (transaction) => handler(payload, context, transaction),
    );
  }

  async getRecord(recordType: string, recordId: string): Promise<ApplicationJsonValue> {
    if (!NAME_TOKEN_PATTERN.test(recordType) || !ID_PATTERN.test(recordId)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Malformed record identity.");
    }
    const record = await this.records.get<ApplicationJsonValue>(recordType, recordId);
    if (record === null) {
      throw new ApplicationError("NOT_FOUND", "Record does not exist.", {
        details: { recordType, recordId },
      });
    }
    return { recordType, recordId, revision: record.revision, value: record.value };
  }
}

export interface RuntimeComposition {
  readonly config: RuntimeConfig;
  readonly database: SqliteRuntimeDatabase;
  readonly records: SqliteRecordStore;
  readonly outbox: SqliteOutbox;
  readonly replay: EventReplayStore;
  readonly coordinator: EventStreamCoordinator;
  readonly executor: ExternalCommandExecutor;
  readonly authenticator: LocalSessionAuthenticator;
  readonly service: RuntimeService;
  recoverOnStartup(): { readonly latestSequence: number };
  close(): void;
}

/**
 * Wires the runtime's durable authority (SQLite), its committed-event log, the resumable stream
 * coordinator, the idempotent command executor, local authentication, and the built-in command
 * handlers into a single composition. This is the only place concrete implementations are
 * assembled; routes and lifecycle code depend on the returned interface, not on construction.
 */
export function buildComposition(config: RuntimeConfig): RuntimeComposition {
  const database = new SqliteRuntimeDatabase(config.databasePath);
  const records = new SqliteRecordStore(database);
  const outbox = new SqliteOutbox(database);
  const replay = new EventReplayStore(database);
  const coordinator = new EventStreamCoordinator(replay, {
    maxQueue: config.eventQueueLimit,
    batchSize: config.replayBatchSize,
  });
  const executor = new ExternalCommandExecutor(database);
  const authenticator = new LocalSessionAuthenticator(config.sessions);
  const service = new RuntimeService(executor, records);

  // Built-in record write: authoritative CAS write plus a durable event, both in one transaction,
  // with the live fan-out registered only after commit so subscribers never see uncommitted state.
  service.register("record.put", async (payload, context, transaction) => {
    const object = asObject(payload);
    const recordType = requireString(object, "recordType", NAME_TOKEN_PATTERN);
    const recordId = requireString(object, "recordId", ID_PATTERN);
    const body = object["body"];
    if (!isApplicationJsonValue(body)) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Record body must be safe JSON.");
    }
    const expectedRevision =
      object["expectedRevision"] === undefined ? undefined : String(object["expectedRevision"]);

    const current = await records.get<ApplicationJsonValue>(recordType, recordId);
    let condition: WriteCondition;
    if (expectedRevision === undefined) {
      condition = WriteConditions.mustNotExist();
    } else {
      if (current === null || current.revision !== expectedRevision) {
        throw new ApplicationError("VERSION_CONFLICT", "Record revision does not match expected.", {
          details: { expected: expectedRevision, found: current?.revision ?? null },
        });
      }
      condition = WriteConditions.matchRevision(expectedRevision);
    }
    const saved = await records.save(recordType, recordId, body, condition, transaction);
    const event = createDomainEvent({
      id: `event-${randomUUID()}`,
      type: current === null ? "record.created" : "record.updated",
      aggregateType: recordType,
      aggregateId: recordId,
      occurredAt: context.startedAt,
      payload: { revision: Number(saved.revision) },
      metadata: {},
    });
    const sequence = await outbox.append(event, transaction);
    transaction.afterCommit(() => coordinator.publish({ sequence, event }));
    return { recordType, recordId, revision: saved.revision, sequence };
  });

  return Object.freeze({
    config,
    database,
    records,
    outbox,
    replay,
    coordinator,
    executor,
    authenticator,
    service,
    recoverOnStartup(): { readonly latestSequence: number } {
      // The database reopens with its WAL applied, so committed events survive a crash and the
      // durable log is immediately replay-ready. MAX(sequence) is the O(1) head of that log — the
      // cursor a client resumes toward — and is a truthful liveness signal, unlike a never-draining
      // "pending" count over an outbox that is retained for replay rather than consumed.
      const row = database.connection
        .prepare("SELECT MAX(sequence) AS latest FROM outbox_events")
        .get() as { latest: number | null } | undefined;
      return { latestSequence: row?.latest ?? 0 };
    },
    close(): void {
      coordinator.closeAll();
      database.close();
    },
  });
}
