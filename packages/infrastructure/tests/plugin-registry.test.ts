import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "@v31m4/application";
import { describe, expect, it } from "vitest";
import { SqliteRuntimeDatabase } from "../src/database/sqlite-runtime-database.js";
import { SqlitePluginRegistry } from "../src/plugins/sqlite-plugin-registry.js";
import { context } from "./fixtures.js";

function database() {
  return new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-plugins-")), "state.db"));
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    pluginId: "plugin:demo" as never,
    displayName: "Demo",
    version: "1.0.0",
    minimumRuntimeVersion: "1.0.0",
    entrypoint: "plugins/main.js" as never,
    capabilities: ["capability:render"] as never,
    requiredToolIds: [] as never,
    optionalToolIds: [] as never,
    workflowIds: [],
    verifierIds: [],
    permissions: { filesystem: [], network: false, process: [] },
    ...overrides,
  };
}

describe("SqlitePluginRegistry", () => {
  it("rejects malformed pagination cursors", async () => {
    const db = database();
    const registry = new SqlitePluginRegistry(db);
    await expect(registry.list({ limit: 1, cursor: "1junk" })).rejects.toMatchObject({
      code: "INVALID_APPLICATION_INPUT",
    });
    db.close();
  });

  it("registers a plugin once and rejects a colliding id", async () => {
    const db = database();
    const registry = new SqlitePluginRegistry(db);
    const stored = await db.unitOfWork.execute(context, (tx) =>
      registry.register(manifest(), context, tx),
    );
    expect(stored.value.status).toBe("registered");
    await expect(
      db.unitOfWork.execute(context, (tx) => registry.register(manifest(), context, tx)),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    db.close();
  });

  it("promotes status under optimistic concurrency and finds by capability", async () => {
    const db = database();
    const registry = new SqlitePluginRegistry(db);
    const stored = await db.unitOfWork.execute(context, (tx) =>
      registry.register(manifest(), context, tx),
    );
    const active = await db.unitOfWork.execute(context, (tx) =>
      registry.setStatus(
        "plugin:demo" as never,
        "active",
        { kind: "match_revision", revision: stored.revision },
        context,
        tx,
      ),
    );
    expect(active.value.status).toBe("active");
    const byCapability = await registry.findByCapability("capability:render", context);
    expect(byCapability.map((profile) => profile.pluginId)).toEqual(["plugin:demo"]);
    db.close();
  });

  it("rejects a stale-revision status change with a version conflict", async () => {
    const db = database();
    const registry = new SqlitePluginRegistry(db);
    await db.unitOfWork.execute(context, (tx) => registry.register(manifest(), context, tx));
    await expect(
      db.unitOfWork.execute(context, (tx) =>
        registry.setStatus(
          "plugin:demo" as never,
          "active",
          { kind: "match_revision", revision: "999" },
          context,
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    db.close();
  });
});
