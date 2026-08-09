import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationJsonValue,
  type ClockPort,
  createOperationContext,
  type OperationContext,
} from "@v31m4/application";
import {
  type DepartmentConnector,
  DepartmentHost,
  type DepartmentInstance,
} from "@v31m4/department-host";
import { GameDepartment, gameManifest, referenceGameDeps } from "@v31m4/game-production";
import { SqlitePluginRegistry, SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import { referenceVideoDeps, VideoDepartment, videoManifest } from "@v31m4/video-production";
import { describe, expect, it } from "vitest";

const context: OperationContext = createOperationContext({
  requestId: "request-integration",
  idempotencyKey: "idempotency-integration",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-09T12:00:00.000Z",
});

const clock: ClockPort = {
  now: () => "2026-08-09T12:00:00.000Z",
  monotonicMilliseconds: () => 0,
  sleep: async () => undefined,
};

/** A composite connector that binds each first-party department by its manifest id. */
const compositeConnector: DepartmentConnector = {
  connect: async (manifest): Promise<DepartmentInstance> => {
    switch (manifest.departmentId) {
      case "video-production":
        return new VideoDepartment(referenceVideoDeps());
      case "game-production":
        return new GameDepartment(referenceGameDeps());
      default:
        throw new Error(`no connector for ${manifest.departmentId}`);
    }
  },
};

function integrationHost() {
  const db = new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-int-")), "state.db"));
  const released: string[] = [];
  const host = new DepartmentHost({
    registry: new SqlitePluginRegistry(db),
    unitOfWork: db.unitOfWork,
    clock,
    connector: compositeConnector,
    workspaces: {
      allocate: async (id, path) => ({
        path: `${path}/${id}`,
        release: async () => void released.push(id),
      }),
    },
  });
  return { host, db, released };
}

const videoRequest = {
  productionId: "prod-int",
  maxAttemptsPerShot: 2,
  shots: [{ shotId: "s1", prompt: "opening", qualityTier: "standard", seed: 1 }],
} as unknown as ApplicationJsonValue;

const gameRequest = {
  projectId: "game-int",
  maxAttemptsPerScene: 2,
  scenes: [{ sceneId: "sc1", engine: "reference", assets: [] }],
} as unknown as ApplicationJsonValue;

async function install(host: DepartmentHost, manifest: typeof videoManifest): Promise<void> {
  await host.install(
    manifest,
    { permissions: manifest.permissions, availableToolIds: [], availableModelIds: [] },
    context,
  );
  await host.enable(manifest.departmentId, context);
  await host.start(manifest.departmentId, context);
}

function statusOf(host: DepartmentHost, id: string): string | null {
  return host.state(id);
}

describe("department independence matrix", () => {
  it("core operates with zero departments installed", async () => {
    const { host, db } = integrationHost();
    expect(host.list()).toEqual([]);
    await expect(
      host.invoke("video-production", "video.render_production", videoRequest, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.close();
  });

  it("runs both departments together, and each is independently removable", async () => {
    const { host, db, released } = integrationHost();
    await install(host, videoManifest);
    await install(host, gameManifest);

    const video = (await host.invoke(
      "video-production",
      "video.render_production",
      videoRequest,
      context,
    )) as {
      status: string;
    };
    const game = (await host.invoke(
      "game-production",
      "game.build_project",
      gameRequest,
      context,
    )) as {
      status: string;
    };
    expect(video.status).toBe("completed");
    expect(game.status).toBe("completed");

    // Remove Video; Game keeps working (departments do not depend on each other).
    await host.stop("video-production", context);
    await host.disable("video-production", context);
    await host.remove("video-production", context);
    expect(statusOf(host, "video-production")).toBe("removed");
    const gameStillWorks = (await host.invoke(
      "game-production",
      "game.build_project",
      gameRequest,
      context,
    )) as {
      status: string;
    };
    expect(gameStillWorks.status).toBe("completed");

    // Remove Game; the host is now operating with all departments removed.
    await host.stop("game-production", context);
    await host.disable("game-production", context);
    await host.remove("game-production", context);
    expect(released).toEqual(["video-production", "game-production"]);
    expect(host.list().every((entry) => entry.state === "removed")).toBe(true);
    // Core after all departments removed: invoking any is fail-closed.
    await expect(
      host.invoke("game-production", "game.build_project", gameRequest, context),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    db.close();
  });
});
