import { PluginId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { parseDepartmentManifest } from "../src/index.js";
import { context, FakeInstance, grant, harness, manifest } from "./fixtures.js";

const ID = "demo-department";

async function durableStatus(registry: {
  get: (id: PluginId) => Promise<unknown>;
}): Promise<string> {
  const profile = (await registry.get(PluginId.parse(ID))) as {
    value: { status: string };
  } | null;
  return profile?.value.status ?? "absent";
}

describe("DepartmentHost lifecycle", () => {
  it("runs the full install → enable → start → invoke → health → stop → disable → remove flow", async () => {
    const { host, db, registry, instances, released } = harness();
    expect(host.list()).toEqual([]); // core operates with zero departments installed

    await host.install(manifest(), grant(), context);
    expect(host.state(ID)).toBe("installed");
    expect(await durableStatus(registry)).toBe("registered");

    await host.enable(ID, context);
    await host.start(ID, context);
    expect(host.state(ID)).toBe("started");
    expect(await durableStatus(registry)).toBe("active");
    expect(instances[0]?.started).toBe(true);

    const result = await host.invoke(ID, "demo.run", { x: 1 }, context);
    expect(result).toEqual({ capabilityId: "demo.run", echoed: { x: 1 } });
    expect((await host.health(ID, context)).status).toBe("healthy");

    await host.stop(ID, context);
    expect(host.state(ID)).toBe("stopped");
    expect(instances[0]?.stopped).toBe(true);
    expect(await durableStatus(registry)).toBe("inactive");

    await host.disable(ID, context);
    expect(host.state(ID)).toBe("disabled");

    await host.remove(ID, context);
    expect(host.state(ID)).toBe("removed");
    expect(released).toContain(ID);
    // Core after removal: the department is gone; operations against it fail closed.
    await expect(host.invoke(ID, "demo.run", {}, context)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    db.close();
  });

  it("rejects an invalid manifest structurally", () => {
    expect(() => parseDepartmentManifest(manifest({ capabilities: [] }))).toThrow(/capability/i);
    expect(() => parseDepartmentManifest(manifest({ version: "nope" }))).toThrow(/version/i);
    expect(() => parseDepartmentManifest(manifest({ workspacePath: "../escape" }))).toThrow();
  });

  it("rejects an incompatible host API version", async () => {
    const { host, db } = harness();
    await expect(
      host.install(manifest({ hostApiVersion: "2.0.0" }), grant(), context),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    db.close();
  });

  it("rejects a duplicate department in one host before allocating a workspace", async () => {
    const { host, db, released } = harness();
    await host.install(manifest(), grant(), context);
    await expect(host.install(manifest(), grant(), context)).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
    });
    // The in-memory guard rejects before allocating, so nothing new was allocated to release.
    expect(released).toEqual([]);
    db.close();
  });

  it("rolls back the allocated workspace when durable registration collides", async () => {
    // Two hosts share one database. The second allocates its workspace, then registration hits
    // ALREADY_EXISTS in the shared registry, so the just-allocated workspace must be reclaimed.
    const first = harness();
    await first.host.install(manifest(), grant(), context);
    const second = harness({ db: first.db });
    await expect(second.host.install(manifest(), grant(), context)).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
    });
    expect(second.released).toContain(ID); // install rollback reclaimed the workspace
    first.db.close();
  });

  it("denies an ungranted permission", async () => {
    const { host, db } = harness();
    await expect(
      host.install(
        manifest({ permissions: ["workspace.write", "secret.read"] }),
        grant({ permissions: ["workspace.write"] }),
        context,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    db.close();
  });

  it("rejects install when a required tool or model dependency is unavailable", async () => {
    const { host, db } = harness();
    await expect(
      host.install(manifest({ requiredToolIds: ["ffmpeg"] }), grant(), context),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    db.close();
  });

  it("surfaces a startup failure and leaves the department re-startable", async () => {
    const failing = new FakeInstance({ startError: new Error("cannot start") });
    const { host, db, registry } = harness({ instance: failing });
    await host.install(manifest(), grant(), context);
    await host.enable(ID, context);
    await expect(host.start(ID, context)).rejects.toMatchObject({ code: "DEPENDENCY_FAILURE" });
    expect(host.state(ID)).toBe("enabled");
    expect(await durableStatus(registry)).toBe("registered");
    db.close();
  });

  it("classifies an invocation failure as a dependency failure", async () => {
    const flaky = new FakeInstance({ invokeError: new Error("rpc broke") });
    const { host, db } = harness({ instance: flaky });
    await host.install(manifest(), grant(), context);
    await host.enable(ID, context);
    await host.start(ID, context);
    await expect(host.invoke(ID, "demo.run", {}, context)).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
    });
    db.close();
  });

  it("reports degraded health when the department's health probe fails", async () => {
    const unhealthy = new FakeInstance({ healthError: new Error("probe failed") });
    const { host, db } = harness({ instance: unhealthy });
    await host.install(manifest(), grant(), context);
    await host.enable(ID, context);
    await host.start(ID, context);
    expect((await host.health(ID, context)).status).toBe("degraded");
    db.close();
  });

  it("rolls back removal when the workspace cannot be reclaimed", async () => {
    const { host, db } = harness({ releaseError: new Error("disk busy") });
    await host.install(manifest(), grant(), context);
    await host.enable(ID, context);
    await host.disable(ID, context);
    await expect(host.remove(ID, context)).rejects.toMatchObject({ code: "DEPENDENCY_FAILURE" });
    expect(host.state(ID)).toBe("disabled"); // unchanged — no partial removal
    db.close();
  });

  it("forbids removing a started department (must stop first)", async () => {
    const { host, db } = harness();
    await host.install(manifest(), grant(), context);
    await host.enable(ID, context);
    await host.start(ID, context);
    await expect(host.remove(ID, context)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(host.state(ID)).toBe("started");
    db.close();
  });
});
