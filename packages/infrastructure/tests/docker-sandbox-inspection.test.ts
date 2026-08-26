import { ApplicationError } from "@v31m4/application";
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
  /**
   * Engines differ in whether internal tmpfs appear in `.Mounts`: Docker 29 reports them only
   * under `HostConfig.Tmpfs`, where their options are approved exhaustively. An earlier revision
   * required a fixed total of three mounts, which made this attestation unsatisfiable on a
   * conforming engine whose isolation was correct — a false negative that blocked the real
   * target-host proof. What must hold either way is that exactly one host-visible mount exists.
   */
  it("accepts an engine that reports internal tmpfs outside the mount list", () => {
    const parsed = assertDockerRuntimeIsolation(
      observation({
        Mounts: [{ Type: "bind", Source: workspaceRoot, Destination: "/workspace", RW: true }],
      }),
      expected,
    );
    expect(parsed.mounts.map((mount) => `${mount.type}:${mount.destination}`)).toEqual([
      "bind:/workspace",
    ]);
  });

  it("still refuses a second host bind when tmpfs are reported outside the mount list", () => {
    for (const extra of [
      { Type: "bind", Source: "/etc", Destination: "/host-etc", RW: false },
      { Type: "volume", Source: "cache", Destination: "/cache", RW: true },
      {
        Type: "bind",
        Source: "/var/run/docker.sock",
        Destination: "/var/run/docker.sock",
        RW: true,
      },
      { Type: "tmpfs", Source: "", Destination: "/unapproved", RW: true },
    ]) {
      expect(() =>
        assertDockerRuntimeIsolation(
          observation({
            Mounts: [
              { Type: "bind", Source: workspaceRoot, Destination: "/workspace", RW: true },
              extra,
            ],
          }),
          expected,
        ),
      ).toThrow(ApplicationError);
    }
  });

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
