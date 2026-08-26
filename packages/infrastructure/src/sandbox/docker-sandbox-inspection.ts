import { ApplicationError } from "@v31m4/application";

const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const NON_ROOT_USER = /^([0-9]+):([0-9]+)$/u;
const APPROVED_TMPFS = new Set(["/tmp", "/home/sandbox"]);

export interface DockerRuntimeMount {
  readonly type: string;
  readonly source: string;
  readonly destination: string;
  readonly writable: boolean;
}

export interface DockerInspectObservation {
  readonly containerId: string;
  readonly name: string;
  readonly user: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly environment: readonly string[];
  readonly readOnlyRootFilesystem: boolean;
  readonly networkMode: string;
  readonly capabilityDrops: readonly string[];
  readonly securityOptions: readonly string[];
  readonly tmpfs: Readonly<Record<string, string>>;
  readonly mounts: readonly DockerRuntimeMount[];
}

export interface ExpectedDockerSandboxIdentity {
  readonly sandboxId: string;
  readonly taskId: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

function malformed(message: string): ApplicationError {
  return new ApplicationError("INTEGRITY_FAILURE", message, {});
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformed(`Docker inspect ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw malformed(`Docker inspect ${label} must be an array of strings.`);
  }
  return Object.freeze([...(value as readonly string[])]);
}

function stringMap(value: unknown, label: string): Readonly<Record<string, string>> {
  const parsed = record(value, label);
  if (Object.values(parsed).some((entry) => typeof entry !== "string")) {
    throw malformed(`Docker inspect ${label} must contain only string values.`);
  }
  return Object.freeze({ ...(parsed as Record<string, string>) });
}

export function parseDockerInspectObservation(raw: string): DockerInspectObservation {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new ApplicationError("INTEGRITY_FAILURE", "Docker inspect returned malformed JSON.", {
      cause: error,
    });
  }
  const root = record(decoded, "result");
  const config = record(root["Config"], "Config");
  const host = record(root["HostConfig"], "HostConfig");
  const containerId = root["Id"];
  const name = root["Name"];
  const user = config["User"];
  if (typeof containerId !== "string" || !CONTAINER_ID.test(containerId)) {
    throw malformed("Docker inspect returned a malformed container identity.");
  }
  if (typeof name !== "string" || name.length < 2 || !name.startsWith("/")) {
    throw malformed("Docker inspect returned a malformed container name.");
  }
  if (typeof user !== "string") throw malformed("Docker inspect omitted the configured user.");
  if (typeof host["ReadonlyRootfs"] !== "boolean") {
    throw malformed("Docker inspect omitted ReadonlyRootfs.");
  }
  if (typeof host["NetworkMode"] !== "string") {
    throw malformed("Docker inspect omitted NetworkMode.");
  }
  if (!Array.isArray(root["Mounts"])) throw malformed("Docker inspect omitted effective mounts.");
  const mounts = (root["Mounts"] as readonly unknown[]).map((value) => {
    const mount = record(value, "mount");
    if (
      typeof mount["Type"] !== "string" ||
      typeof mount["Source"] !== "string" ||
      typeof mount["Destination"] !== "string" ||
      typeof mount["RW"] !== "boolean"
    ) {
      throw malformed("Docker inspect returned a malformed effective mount.");
    }
    return Object.freeze({
      type: mount["Type"],
      source: mount["Source"],
      destination: mount["Destination"],
      writable: mount["RW"],
    });
  });
  return Object.freeze({
    containerId,
    name,
    user,
    labels: stringMap(config["Labels"], "Config.Labels"),
    environment: strings(config["Env"], "Config.Env"),
    readOnlyRootFilesystem: host["ReadonlyRootfs"],
    networkMode: host["NetworkMode"],
    capabilityDrops: strings(host["CapDrop"], "HostConfig.CapDrop"),
    securityOptions: strings(host["SecurityOpt"], "HostConfig.SecurityOpt"),
    tmpfs: stringMap(host["Tmpfs"], "HostConfig.Tmpfs"),
    mounts: Object.freeze(mounts),
  });
}

export function assertDockerContainerOwnership(
  observation: DockerInspectObservation,
  expected: Omit<ExpectedDockerSandboxIdentity, "workspaceRoot">,
): void {
  const required = {
    "v31m4.sandbox": expected.sandboxId,
    "v31m4.task": expected.taskId,
    "v31m4.job": expected.jobId,
    "v31m4.workspace": expected.workspaceId,
  };
  for (const [label, value] of Object.entries(required)) {
    if (observation.labels[label] !== value) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Docker container ownership is missing, ambiguous, or foreign; destructive cleanup is refused.",
        { details: { label, expected: value, observed: observation.labels[label] ?? "(missing)" } },
      );
    }
  }
}

export function assertDockerRuntimeIsolation(
  raw: string,
  expected: ExpectedDockerSandboxIdentity,
): DockerInspectObservation {
  const observation = parseDockerInspectObservation(raw);
  return assertDockerRuntimeObservation(observation, expected);
}

/** Validates an already parsed live observation without lossy re-serialization. */
export function assertDockerRuntimeObservation(
  observation: DockerInspectObservation,
  expected: ExpectedDockerSandboxIdentity,
): DockerInspectObservation {
  assertDockerContainerOwnership(observation, expected);
  const user = NON_ROOT_USER.exec(observation.user);
  if (user === null || Number(user[1]) === 0 || Number(user[2]) === 0) {
    throw malformed("Docker inspect did not observe a non-root uid:gid.");
  }
  if (!observation.readOnlyRootFilesystem) throw malformed("Docker root is not read-only.");
  if (observation.networkMode !== "none") throw malformed("Docker network mode is not none.");
  if (
    observation.capabilityDrops.length !== 1 ||
    observation.capabilityDrops[0]?.toUpperCase() !== "ALL"
  ) {
    throw malformed("Docker effective capability-drop configuration is not exactly ALL.");
  }
  if (
    !observation.securityOptions.some(
      (option) => option === "no-new-privileges" || option === "no-new-privileges:true",
    )
  ) {
    throw malformed("Docker no-new-privileges is not effective.");
  }
  const tmpfsTargets = Object.keys(observation.tmpfs).sort();
  if (tmpfsTargets.length !== 2 || tmpfsTargets.some((target) => !APPROVED_TMPFS.has(target))) {
    throw malformed("Docker effective tmpfs configuration is not the approved /tmp and HOME set.");
  }
  for (const options of Object.values(observation.tmpfs)) {
    const tokens = new Set(options.split(","));
    for (const required of ["rw", "noexec", "nosuid", "nodev"]) {
      if (!tokens.has(required)) throw malformed(`Docker tmpfs is missing ${required}.`);
    }
  }
  if (
    !observation.environment.includes("HOME=/home/sandbox") ||
    !observation.environment.includes("TMPDIR=/tmp")
  ) {
    throw malformed("Docker effective HOME or TMPDIR is not the approved internal scratch path.");
  }
  if (observation.mounts.length !== 3) {
    throw malformed("Docker effective mount list contains an unexpected mount.");
  }
  const workspace = observation.mounts.find((mount) => mount.destination === "/workspace");
  if (
    workspace?.type !== "bind" ||
    workspace.source !== expected.workspaceRoot ||
    !workspace.writable
  ) {
    throw malformed("Docker effective workspace bind does not match the authoritative workspace.");
  }
  for (const target of APPROVED_TMPFS) {
    const mount = observation.mounts.find((candidate) => candidate.destination === target);
    if (mount?.type !== "tmpfs" || mount.source !== "" || !mount.writable) {
      throw malformed(`Docker effective ${target} mount is not internal writable tmpfs.`);
    }
  }
  for (const mount of observation.mounts) {
    if (
      mount.source.includes("docker.sock") ||
      mount.destination.includes("docker.sock") ||
      (mount.type === "bind" && mount.destination !== "/workspace") ||
      mount.type === "volume"
    ) {
      throw malformed("Docker effective mounts expose an unapproved host or volume path.");
    }
  }
  return observation;
}
