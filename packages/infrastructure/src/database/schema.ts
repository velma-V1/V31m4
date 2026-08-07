import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const recordsTable = sqliteTable("records", {
  recordType: text("record_type").notNull(),
  recordId: text("record_id").notNull(),
  revision: integer("revision").notNull(),
  body: text("body").notNull(),
});

export const outboxTable = sqliteTable(
  "outbox_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    body: text("body").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [uniqueIndex("outbox_event_id_uq").on(table.eventId)],
);

export const idempotencyTable = sqliteTable("idempotency_records", {
  actorId: text("actor_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  commandType: text("command_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull(),
  result: text("result").notNull(),
});
