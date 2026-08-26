import { describe, expect, it } from "vitest";
import {
  assertNoExternalRoutes,
  assertOnlyLoopbackInterfaces,
  parseNetworkInterfaces,
  parseRoutingTable,
} from "./runtime-network-attestation.js";

/**
 * Network isolation is attested from kernel-visible state, not from a name lookup. These are the
 * rules that decide whether a real container passes, exercised on a host with no Docker.
 *
 * The routing fixture is the real shape observed on a fully networked host, including the
 * trailing column padding `/proc/net/route` emits.
 */
const ROUTE_HEADER =
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT      ";
const CONNECTED_ROUTES = [
  ROUTE_HEADER,
  "eth0\t00000000\t0100000A\t0003\t0\t0\t30\t00000000\t0\t0\t0        ",
  "eth0\t0000000A\t00000000\t0001\t0\t0\t286\t00FFFFFF\t0\t0\t0       ",
  "",
].join("\n");
const ISOLATED_ROUTES = `${ROUTE_HEADER}\n`;

describe("network interface attestation", () => {
  it("accepts a namespace holding only loopback", () => {
    expect(assertOnlyLoopbackInterfaces("lo\n")).toEqual(["lo"]);
    expect(assertOnlyLoopbackInterfaces("  lo  \nlo\n")).toEqual(["lo"]);
  });

  it("rejects any non-loopback interface", () => {
    for (const listing of [
      "eth0\nlo\n",
      "lo\ndocker0\n",
      // The exact interface set observed on this fully networked host.
      "eth0\neth1\nlo\nloopback0\n",
      "tun0\n",
    ]) {
      expect(() => assertOnlyLoopbackInterfaces(listing), listing).toThrow(
        /Non-loopback network interfaces are present/u,
      );
    }
  });

  it("treats an unread observation as a failure, not as an empty interface set", () => {
    expect(() => parseNetworkInterfaces("")).toThrow(/observation is empty/u);
    expect(() => parseNetworkInterfaces("   \n\n")).toThrow(/observation is empty/u);
    // An unexpanded glob means /sys was not readable, which is not "no interfaces".
    expect(() => parseNetworkInterfaces("/sys/class/net/*\n")).toThrow(/Malformed/u);
    expect(() => parseNetworkInterfaces("*\n")).toThrow(/Malformed/u);
  });
});

describe("routing table attestation", () => {
  it("accepts a routing table with no routes at all", () => {
    expect(assertNoExternalRoutes(ISOLATED_ROUTES)).toEqual([]);
  });

  it("rejects a default route", () => {
    expect(() => assertNoExternalRoutes(CONNECTED_ROUTES)).toThrow(
      /External or default routes are present/u,
    );
    const parsed = parseRoutingTable(CONNECTED_ROUTES);
    expect(parsed[0]?.isDefault).toBe(true);
    expect(parsed[0]?.interfaceName).toBe("eth0");
    expect(parsed[1]?.isDefault).toBe(false);
  });

  it("rejects a non-default route off a non-loopback interface", () => {
    const onlySubnet = [
      ROUTE_HEADER,
      "eth0\t0000000A\t00000000\t0001\t0\t0\t286\t00FFFFFF\t0\t0\t0",
      "",
    ].join("\n");
    expect(() => assertNoExternalRoutes(onlySubnet)).toThrow(/External or default routes/u);
  });

  it("rejects a default route even when it is on loopback", () => {
    const loopbackDefault = [
      ROUTE_HEADER,
      "lo\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
      "",
    ].join("\n");
    expect(() => assertNoExternalRoutes(loopbackDefault)).toThrow(/default/u);
  });

  it("treats a missing or malformed table as a failed observation", () => {
    expect(() => assertNoExternalRoutes("")).toThrow(/missing its header/u);
    expect(() => assertNoExternalRoutes("eth0\t00000000\t0100000A\n")).toThrow(
      /missing its header/u,
    );
    expect(() => assertNoExternalRoutes(`${ROUTE_HEADER}\neth0\t00000000\n`)).toThrow(
      /Malformed routing table record/u,
    );
  });
});
