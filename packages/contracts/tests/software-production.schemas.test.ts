import { describe, expect, it } from "vitest";
import { softwareBuildPacketSchema } from "../src/index.js";

const validPacket = {
  schemaVersion: "1.0.0",
  projectId: "project-general",
  objective: "Implement the requested greeting behavior without changing unrelated files.",
  requiredOutputs: [{ path: "src/greeting.js", mediaType: "text/javascript" }],
  forbiddenChanges: ["README.md"],
  allowedPaths: ["src", "test"],
  allowedOperations: ["read", "create", "update"],
  commands: [
    {
      id: "test",
      executable: "node",
      args: ["--test", "test/greeting.test.js"],
      cwd: ".",
      timeoutMs: 30_000,
    },
  ],
  mandatoryCommandIds: ["test"],
  resourceBudget: {
    maxFiles: 64,
    maxFileBytes: 65_536,
    maxTotalBytes: 1_048_576,
    maxRepairRounds: 2,
  },
} as const;

describe("softwareBuildPacketSchema", () => {
  it("accepts a closed, project-scoped production packet", () => {
    expect(softwareBuildPacketSchema.parse(validPacket)).toEqual(validPacket);
  });

  it.each([
    ["unsupported version", { ...validPacket, schemaVersion: "2.0.0" }],
    ["absolute allowed path", { ...validPacket, allowedPaths: ["/etc"] }],
    [
      "traversal output",
      { ...validPacket, requiredOutputs: [{ path: "../escape", mediaType: "text/plain" }] },
    ],
    ["duplicate allowed path", { ...validPacket, allowedPaths: ["src", "src"] }],
    ["forbidden output", { ...validPacket, forbiddenChanges: ["src/greeting.js"] }],
    ["unknown command", { ...validPacket, mandatoryCommandIds: ["missing"] }],
    ["duplicate operation", { ...validPacket, allowedOperations: ["read", "read"] }],
    [
      "shell executable",
      { ...validPacket, commands: [{ ...validPacket.commands[0], executable: "sh" }] },
    ],
    [
      "unimplemented tool executable",
      { ...validPacket, commands: [{ ...validPacket.commands[0], executable: "pnpm" }] },
    ],
    ["unknown field", { ...validPacket, authority: "model" }],
  ])("rejects %s", (_label, value) => {
    expect(softwareBuildPacketSchema.safeParse(value).success).toBe(false);
  });
});
