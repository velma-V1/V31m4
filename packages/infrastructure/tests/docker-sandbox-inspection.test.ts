import { describe, expect, it } from "vitest";
import {
  assertDockerRuntimeIsolation,
  parseDockerInspectObservation,
} from "../src/sandbox/docker-sandbox-inspection.js";

const workspaceRoot = "/tmp/v31m4-workspace";
const expected = {
  sandboxId: "sandbox:inspect",
  taskId: "task:root",
  jobId: "job:1",
  workspaceId: "workspace-1",
  workspaceRoot,
};

function observation(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Id: "d".repeat(64),
    Name: "/v31m4-sandbox-inspect",
    Config: {
      User: "65534:65534",
      Labels: {
        "v31m4.sandbox": expected.sandboxId,
        "v31m4.task": expected.taskId,
        "v31m4.job": expected.jobId,
        "v31m4.workspace": expected.workspaceId,
      },
      Env: ["HOME=/home/sandbox", "TMPDIR=/tmp", "PATH=/usr/bin:/bin"],
    },
    HostConfig: {
      ReadonlyRootfs: true,
      NetworkMode: "none",
      Binds: [`${workspaceRoot}:/workspace`],
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,nodev,size=64m",
        "/home/sandbox": "rw,noexec,nosuid,nodev,size=16m",
      },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
    },
    Mounts: [
      { Type: "bind", Source: workspaceRoot, Destination: "/workspace", RW: true },
      { Type: "tmpfs", Source: "", Destination: "/tmp", RW: true },
      { Type: "tmpfs", Source: "", Destination: "/home/sandbox", RW: true },
    ],
    ...overrides,
  });
}

describe("effective Docker runtime inspection", () => {
  it("accepts only the owned workspace bind plus approved internal tmpfs mounts", () => {
    const parsed = assertDockerRuntimeIsolation(observation(), expected);
    expect(parsed.containerId).toBe("d".repeat(64));
    expect(parsed.mounts.map((mount) => `${mount.type}:${mount.destination}`)).toEqual([
      "bind:/workspace",
      "tmpfs:/tmp",
      "tmpfs:/home/sandbox",
    ]);
  });

  it("rejects an effective extra bind, extra volume, or wrong workspace source", () => {
    const base = JSON.parse(observation()) as Record<string, unknown>;
    const mounts = base["Mounts"] as readonly Record<string, unknown>[];
    for (const extra of [
      { Type: "bind", Source: "/etc", Destination: "/host", RW: true },
      { Type: "volume", Source: "/var/lib/docker/volumes/x", Destination: "/cache", RW: true },
    ]) {
      expect(() =>
        assertDockerRuntimeIsolation(
          JSON.stringify({ ...base, Mounts: [...mounts, extra] }),
          expected,
        ),
      ).toThrow();
    }
    const wrongSource = mounts.map((mount) =>
      mount["Destination"] === "/workspace" ? { ...mount, Source: "/tmp/other" } : mount,
    );
    expect(() =>
      assertDockerRuntimeIsolation(JSON.stringify({ ...base, Mounts: wrongSource }), expected),
    ).toThrow();
  });

  it("rejects wrong ownership, relaxed isolation, and a Docker socket mount", () => {
    const base = JSON.parse(observation()) as Record<string, unknown>;
    const config = base["Config"] as Record<string, unknown>;
    const host = base["HostConfig"] as Record<string, unknown>;
    const mounts = base["Mounts"] as readonly Record<string, unknown>[];
    const labels = config["Labels"] as Record<string, string>;

    expect(() =>
      assertDockerRuntimeIsolation(
        JSON.stringify({
          ...base,
          Config: { ...config, Labels: { ...labels, "v31m4.job": "job:foreign" } },
        }),
        expected,
      ),
    ).toThrow(/ownership/u);
    expect(() =>
      assertDockerRuntimeIsolation(
        JSON.stringify({ ...base, HostConfig: { ...host, NetworkMode: "host" } }),
        expected,
      ),
    ).toThrow(/network/u);
    expect(() =>
      assertDockerRuntimeIsolation(
        JSON.stringify({ ...base, HostConfig: { ...host, ReadonlyRootfs: false } }),
        expected,
      ),
    ).toThrow(/read-only/u);
    expect(() =>
      assertDockerRuntimeIsolation(
        JSON.stringify({
          ...base,
          Mounts: [
            ...mounts,
            {
              Type: "bind",
              Source: "/var/run/docker.sock",
              Destination: "/var/run/docker.sock",
              RW: true,
            },
          ],
        }),
        expected,
      ),
    ).toThrow(/mount/u);
  });

  it("rejects malformed or incomplete docker-inspect output", () => {
    for (const raw of ["", "not-json", "[]", "{}", JSON.stringify({ Id: "not-a-container" })]) {
      expect(() => parseDockerInspectObservation(raw), raw).toThrow();
    }
  });
});
