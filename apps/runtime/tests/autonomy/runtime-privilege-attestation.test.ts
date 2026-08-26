import { describe, expect, it } from "vitest";
import {
  assertHardenedRuntimePrivileges,
  parseRuntimePrivilegeAttestation,
} from "./runtime-privilege-attestation.js";

/**
 * The target-host proof's privilege attestation is parsed here under hermetic conditions, so the
 * rules that decide whether a real container passes are themselves regression-tested on a host
 * with no Docker.
 */
const HARDENED = [
  "Name:\tsh",
  "Uid:\t65534\t65534\t65534\t65534",
  "CapInh:\t0000000000000000",
  "CapPrm:\t0000000000000000",
  "CapEff:\t0000000000000000",
  "CapBnd:\t0000000000000000",
  "CapAmb:\t0000000000000000",
  "NoNewPrivs:\t1",
  "",
].join("\n");

describe("runtime privilege attestation", () => {
  it("accepts a fully dropped, escalation-blocked container", () => {
    const attestation = assertHardenedRuntimePrivileges(HARDENED);
    expect(attestation.capabilitiesEffective).toBe("0000000000000000");
    expect(attestation.capabilitiesBounding).toBe("0000000000000000");
    expect(attestation.noNewPrivileges).toBe(1);
  });

  it("rejects retained effective capabilities", () => {
    const relaxed = HARDENED.replace("CapEff:\t0000000000000000", "CapEff:\t00000000a80425fb");
    expect(() => assertHardenedRuntimePrivileges(relaxed)).toThrow(/CapEff is not fully dropped/u);
  });

  it("rejects a retained bounding set", () => {
    const relaxed = HARDENED.replace("CapBnd:\t0000000000000000", "CapBnd:\t00000000a80425fb");
    expect(() => assertHardenedRuntimePrivileges(relaxed)).toThrow(/CapBnd is not fully dropped/u);
  });

  it("rejects privilege escalation being permitted", () => {
    const relaxed = HARDENED.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0");
    expect(() => assertHardenedRuntimePrivileges(relaxed)).toThrow(/NoNewPrivs is not 1/u);
  });

  it("treats a missing field as a failed observation, not a skipped check", () => {
    for (const field of ["CapEff", "CapBnd", "NoNewPrivs"]) {
      const truncated = HARDENED.split("\n")
        .filter((line) => !line.startsWith(`${field}:`))
        .join("\n");
      expect(() => assertHardenedRuntimePrivileges(truncated), field).toThrow(
        new RegExp(`missing ${field}`, "u"),
      );
    }
    expect(() => parseRuntimePrivilegeAttestation("")).toThrow(
      /missing CapEff, CapBnd, NoNewPrivs/u,
    );
  });

  it("rejects a non-integer NoNewPrivs", () => {
    const malformed = HARDENED.replace("NoNewPrivs:\t1", "NoNewPrivs:\tyes");
    expect(() => assertHardenedRuntimePrivileges(malformed)).toThrow(/not an integer/u);
  });
});
