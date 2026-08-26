/**
 * Runtime privilege attestation for the Task 1 target-host proof.
 *
 * Docker argv is a statement of intent; `/proc/self/status` inside the running container is
 * evidence. This parser exists so the mandatory proof reads the kernel's own view of the
 * sandbox's capabilities and privilege-escalation state, and so that parsing itself is covered
 * by a hermetic regression rather than only exercised on a host that has Docker.
 */
export interface RuntimePrivilegeAttestation {
  readonly capabilitiesEffective: string;
  readonly capabilitiesBounding: string;
  readonly noNewPrivileges: number;
}

const ALL_CAPABILITIES_DROPPED = "0000000000000000";

function field(procStatus: string, name: string): string | undefined {
  for (const line of procStatus.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}

/**
 * Parses `/proc/self/status` and fails closed. A missing field is a failed observation, never a
 * silently skipped check — an attestation that cannot be read has not been made.
 */
export function parseRuntimePrivilegeAttestation(procStatus: string): RuntimePrivilegeAttestation {
  const capabilitiesEffective = field(procStatus, "CapEff");
  const capabilitiesBounding = field(procStatus, "CapBnd");
  const rawNoNewPrivileges = field(procStatus, "NoNewPrivs");

  const missing = [
    capabilitiesEffective === undefined ? "CapEff" : null,
    capabilitiesBounding === undefined ? "CapBnd" : null,
    rawNoNewPrivileges === undefined ? "NoNewPrivs" : null,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new Error(`Runtime privilege attestation is missing ${missing.join(", ")}.`);
  }

  const noNewPrivileges = Number(rawNoNewPrivileges);
  if (!Number.isInteger(noNewPrivileges)) {
    throw new Error(`NoNewPrivs is not an integer: ${String(rawNoNewPrivileges)}`);
  }
  return {
    capabilitiesEffective: capabilitiesEffective as string,
    capabilitiesBounding: capabilitiesBounding as string,
    noNewPrivileges,
  };
}

/** Every capability dropped and privilege escalation disabled, as observed inside the container. */
export function assertHardenedRuntimePrivileges(procStatus: string): RuntimePrivilegeAttestation {
  const attestation = parseRuntimePrivilegeAttestation(procStatus);
  if (attestation.capabilitiesEffective !== ALL_CAPABILITIES_DROPPED) {
    throw new Error(`CapEff is not fully dropped: ${attestation.capabilitiesEffective}`);
  }
  if (attestation.capabilitiesBounding !== ALL_CAPABILITIES_DROPPED) {
    throw new Error(`CapBnd is not fully dropped: ${attestation.capabilitiesBounding}`);
  }
  if (attestation.noNewPrivileges !== 1) {
    throw new Error(`NoNewPrivs is not 1: ${attestation.noNewPrivileges}`);
  }
  return attestation;
}

export interface RootFilesystemMountState {
  readonly mountOptions: readonly string[];
  readonly superOptions: readonly string[];
  readonly readOnly: boolean;
}

/**
 * Parses `/proc/self/mountinfo` and returns the effective state of the container's root mount.
 *
 * A failed write is not evidence of a read-only filesystem: a non-root user gets exactly the same
 * `EACCES` on a perfectly writable root. Only the mount's own options say whether it is `ro`.
 *
 * mountinfo fields: `id parent major:minor root mountpoint options [optional...] - fstype source
 * superopts`. The last record for `/` wins, because a later mount shadows an earlier one.
 */
export function parseRootFilesystemMountState(mountinfo: string): RootFilesystemMountState {
  let found: RootFilesystemMountState | undefined;
  for (const line of mountinfo.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 7) {
      throw new Error(`Malformed mountinfo record: ${line.trim()}`);
    }
    if (fields[4] !== "/") continue;
    const mountOptions = (fields[5] ?? "").split(",").filter((option) => option.length > 0);
    if (mountOptions.length === 0) {
      throw new Error(`Mountinfo record for / has no mount options: ${line.trim()}`);
    }
    const separator = fields.indexOf("-", 6);
    const superOptions =
      separator === -1 ? [] : (fields[separator + 3] ?? "").split(",").filter((o) => o.length > 0);
    found = {
      mountOptions,
      superOptions,
      readOnly: mountOptions.includes("ro"),
    };
  }
  if (found === undefined) {
    throw new Error("Mountinfo contains no record for the root mount /.");
  }
  return found;
}

/** The container's root mount must actually be mounted read-only. */
export function assertReadOnlyRootFilesystem(mountinfo: string): RootFilesystemMountState {
  const state = parseRootFilesystemMountState(mountinfo);
  if (!state.readOnly) {
    throw new Error(`Root filesystem is not mounted read-only: ${state.mountOptions.join(",")}`);
  }
  return state;
}
