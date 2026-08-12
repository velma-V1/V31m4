import {
  ApplicationError,
  type OperationContext,
  type PluginManifest,
  type PluginRegistryPort,
  type PortHealth,
  type PortPage,
  type PortPageRequest,
  type UnitOfWorkTransaction,
  type Versioned,
  type WriteCondition,
} from "@v31m4/application";
import {
  type PluginId,
  PluginProfile,
  type PluginProfile as PluginProfileType,
  type PluginStatus,
} from "@v31m4/domain";
import { SqliteRecordStore } from "../database/sqlite-record-store.js";
import type { SqliteRuntimeDatabase } from "../database/sqlite-runtime-database.js";
import { parsePaginationCursor } from "../pagination-cursor.js";

const RECORD_TYPE = "plugin";

/**
 * Durable plugin registry backed by the SQLite record store. A plugin registers exactly
 * once (a colliding id is rejected), producing a `registered` profile; status changes go
 * through optimistic concurrency so two writers cannot both promote a plugin.
 */
export class SqlitePluginRegistry implements PluginRegistryPort {
  readonly #records: SqliteRecordStore;

  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }

  async register(
    manifest: PluginManifest,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<PluginProfileType>> {
    const profile = PluginProfile.create({
      pluginId: manifest.pluginId,
      version: manifest.version,
      status: "registered",
      capabilities: [...manifest.capabilities],
      requiredToolIds: [...manifest.requiredToolIds],
      optionalToolIds: [...manifest.optionalToolIds],
    });
    try {
      return await this.#records.append(RECORD_TYPE, manifest.pluginId, profile, transaction);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "CONFLICT") {
        throw new ApplicationError(
          "ALREADY_EXISTS",
          "A plugin with this id is already registered.",
          {
            details: { pluginId: manifest.pluginId },
          },
        );
      }
      throw error;
    }
  }

  async get(id: PluginId): Promise<Versioned<PluginProfileType> | null> {
    return this.#records.get<PluginProfileType>(RECORD_TYPE, id);
  }

  async list(request: PortPageRequest): Promise<PortPage<Versioned<PluginProfileType>>> {
    const all = this.#all();
    const start = parsePaginationCursor(request.cursor);
    const items = all.slice(start, start + request.limit);
    const next = start + request.limit;
    return Object.freeze({
      items,
      total: all.length,
      ...(next < all.length ? { nextCursor: String(next) } : {}),
    });
  }

  async setStatus(
    id: PluginId,
    status: PluginStatus,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<PluginProfileType>> {
    const current = await this.#records.get<PluginProfileType>(RECORD_TYPE, id);
    if (current === null) {
      throw new ApplicationError("NOT_FOUND", "Plugin does not exist.", {
        details: { pluginId: id },
      });
    }
    const updated = PluginProfile.create({
      pluginId: current.value.pluginId,
      version: current.value.version,
      status,
      capabilities: [...current.value.capabilities],
      requiredToolIds: [...current.value.requiredToolIds],
      optionalToolIds: [...current.value.optionalToolIds],
    });
    return this.#records.save(RECORD_TYPE, id, updated, condition, transaction);
  }

  async findByCapability(
    capabilityId: string,
    _context: OperationContext,
  ): Promise<readonly PluginProfileType[]> {
    return this.#all()
      .filter((entry) => entry.value.capabilities.includes(capabilityId as never))
      .map((entry) => entry.value);
  }

  async health(id: PluginId): Promise<PortHealth> {
    const current = await this.#records.get<PluginProfileType>(RECORD_TYPE, id);
    const status: PortHealth["status"] =
      current === null ? "unavailable" : current.value.status === "failed" ? "degraded" : "healthy";
    return Object.freeze({
      status,
      checkedAt: new Date().toISOString(),
      details: { pluginId: id, pluginStatus: current?.value.status ?? "absent" },
    });
  }

  #all(): Versioned<PluginProfileType>[] {
    const rows = this.database.connection
      .prepare("SELECT revision, body FROM records WHERE record_type = ? ORDER BY rowid ASC")
      .all(RECORD_TYPE) as { revision: number; body: string }[];
    return rows.map((row) =>
      Object.freeze({
        value: JSON.parse(row.body) as PluginProfileType,
        revision: String(row.revision),
      }),
    );
  }
}
