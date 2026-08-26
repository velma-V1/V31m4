/**
 * Runtime network-isolation attestation for the Task 1 target-host proof.
 *
 * A failed name lookup is not absence of egress. DNS can be broken on a host with a fully
 * functional network — `getent hosts example.invalid` exits non-zero on a machine that routes to
 * the internet — so a proof built on name resolution can report "egress blocked" while the
 * container is fully connected.
 *
 * What `--network none` actually establishes is kernel-visible: the network namespace has only a
 * loopback interface and no route off it. These parsers read that state directly, so the proof
 * depends on the kernel rather than on the behavior of whichever userspace tool happens to be
 * installed in the image.
 */
const LOOPBACK_INTERFACE = "lo";
/** `/proc/net/route` renders addresses and masks as 8 hex digits, little-endian. */
const UNSPECIFIED_ADDRESS = "00000000";
const ROUTE_HEADER = Object.freeze([
  "Iface",
  "Destination",
  "Gateway",
  "Flags",
  "RefCnt",
  "Use",
  "Metric",
  "Mask",
  "MTU",
  "Window",
  "IRTT",
]);
const INTERFACE_NAME = /^[A-Za-z0-9_.:-]+$/u;
const ROUTE_HEX = /^[A-Fa-f0-9]{8}$/u;

export interface RouteEntry {
  readonly interfaceName: string;
  readonly destination: string;
  readonly gateway: string;
  readonly mask: string;
  /** Destination and mask both unspecified — a default route. */
  readonly isDefault: boolean;
}

/**
 * Parses a listing of `/sys/class/net` entry names, one per line.
 *
 * Fails closed: an empty listing, or one still containing an unexpanded glob, means the
 * observation was not actually made and must not be read as "no interfaces".
 */
export function parseNetworkInterfaces(listing: string): readonly string[] {
  const names = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (names.length === 0) {
    throw new Error("Network interface observation is empty; the interface set was not read.");
  }
  for (const name of names) {
    if (name.includes("*") || name.includes("/")) {
      throw new Error(`Malformed network interface entry: ${name}`);
    }
  }
  return Object.freeze([...new Set(names)].sort());
}

/** The sandbox namespace must contain a loopback interface and nothing else. */
export function assertOnlyLoopbackInterfaces(listing: string): readonly string[] {
  const interfaces = parseNetworkInterfaces(listing);
  const external = interfaces.filter((name) => name !== LOOPBACK_INTERFACE);
  if (external.length > 0) {
    throw new Error(`Non-loopback network interfaces are present: ${external.join(", ")}`);
  }
  return interfaces;
}

/**
 * Parses `/proc/net/route`.
 *
 * Columns: `Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT`. The header
 * is required — its absence means the routing table was never read, which is not the same as an
 * empty routing table.
 */
export function parseRoutingTable(procNetRoute: string): readonly RouteEntry[] {
  const lines = procNetRoute
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = lines[0]?.split(/\s+/u);
  if (
    header === undefined ||
    header.length !== ROUTE_HEADER.length ||
    header.some((field, index) => field !== ROUTE_HEADER[index])
  ) {
    throw new Error("Routing table observation is missing its header; the table was not read.");
  }
  return Object.freeze(
    lines.slice(1).map((line) => {
      const fields = line.split(/\s+/u);
      if (fields.length !== ROUTE_HEADER.length) {
        throw new Error(`Malformed routing table record: ${line}`);
      }
      const [interfaceName, destination, gateway] = fields as [string, string, string, ...string[]];
      const mask = fields[7] as string;
      if (
        !INTERFACE_NAME.test(interfaceName) ||
        !ROUTE_HEX.test(destination) ||
        !ROUTE_HEX.test(gateway) ||
        !ROUTE_HEX.test(mask)
      ) {
        throw new Error(`Malformed routing table record: ${line}`);
      }
      return Object.freeze({
        interfaceName,
        destination,
        gateway,
        mask,
        isDefault: destination === UNSPECIFIED_ADDRESS && mask === UNSPECIFIED_ADDRESS,
      });
    }),
  );
}

/** No default route, and no route at all off a non-loopback interface. */
export function assertNoExternalRoutes(procNetRoute: string): readonly RouteEntry[] {
  const routes = parseRoutingTable(procNetRoute);
  const offending = routes.filter(
    (route) => route.isDefault || route.interfaceName !== LOOPBACK_INTERFACE,
  );
  if (offending.length > 0) {
    throw new Error(
      `External or default routes are present: ${offending
        .map(
          (route) =>
            `${route.interfaceName}/${route.destination}${route.isDefault ? " (default)" : ""}`,
        )
        .join(", ")}`,
    );
  }
  return routes;
}
