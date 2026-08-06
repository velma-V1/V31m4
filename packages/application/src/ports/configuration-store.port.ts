import type { ApplicationJsonObject, ApplicationJsonValue } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface ConfigurationEntry {
  readonly key: string;
  readonly schemaVersion: string;
  readonly value: ApplicationJsonValue;
  readonly secretReferences: readonly string[];
  readonly updatedAt: string;
}

export interface ConfigurationStorePort {
  get(key: string, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Versioned<ConfigurationEntry> | null>;
  save(entry: ConfigurationEntry, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<ConfigurationEntry>>;
  list(prefix: string, context: OperationContext, transaction?: UnitOfWorkTransaction): Promise<Readonly<Record<string, Versioned<ConfigurationEntry>>>>;
  validate(entry: ConfigurationEntry, schema: ApplicationJsonObject, context: OperationContext): Promise<void>;
}
