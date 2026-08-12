import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { softwareBuildPacketSchema } from "@v31m4/contracts";
import { describe, expect, it } from "vitest";
import { SoftwareProductionWorkspace } from "../src/supervised/software-production-workspace.js";

function packet() {
  return softwareBuildPacketSchema.parse({
    schemaVersion: "1.0.0",
    projectId: "project-general",
    objective: "Implement greeting behavior.",
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
        timeoutMs: 10_000,
      },
    ],
    mandatoryCommandIds: ["test"],
    resourceBudget: {
      maxFiles: 20,
      maxFileBytes: 8_192,
      maxTotalBytes: 65_536,
      maxRepairRounds: 1,
    },
  });
}

describe("SoftwareProductionWorkspace", () => {
  it("copies a bounded project into a job-owned workspace and preserves unrelated files", async () => {
    const root = mkdtempSync(join(tmpdir(), "v31m4-software-workspace-"));
    const source = join(root, "projects/project-general");
    await mkdir(join(source, "src"), { recursive: true });
    await mkdir(join(source, "test"), { recursive: true });
    writeFileSync(join(source, "src/greeting.js"), 'export const greeting = "broken";\n');
    writeFileSync(join(source, "test/greeting.test.js"), "// independent test\n");
    writeFileSync(join(source, "README.md"), "must remain unchanged\n");
    await mkdir(join(source, ".v31m4"), { recursive: true });
    writeFileSync(join(source, ".v31m4/build-packet.json"), JSON.stringify(packet()));

    const workspace = new SoftwareProductionWorkspace(
      join(root, "projects"),
      join(root, "supervised"),
    );
    const loaded = await workspace.load("project-general");
    const prepared = await workspace.prepare("project-general", "job-general", loaded);

    expect(readFileSync(join(prepared.workspacePath, "README.md"), "utf8")).toBe(
      "must remain unchanged\n",
    );
    expect(prepared.context).toContain("src/greeting.js");
    expect(prepared.context).not.toContain("must remain unchanged");
    expect(readFileSync(join(prepared.workspacePath, ".v31m4/context.txt"), "utf8")).toBe(
      prepared.context,
    );
    await expect(
      workspace.prompt("job-general", "Repair greeting", "Make the independent check pass."),
    ).resolves.toMatch(/V31M4_SOFTWARE_PRODUCTION_MANIFEST_V1[\s\S]*src\/greeting\.js/u);
  });

  it("rejects source symlinks instead of copying outside content", async () => {
    const root = mkdtempSync(join(tmpdir(), "v31m4-software-symlink-"));
    const source = join(root, "projects/project-general");
    await mkdir(join(source, "src"), { recursive: true });
    const outside = join(root, "outside.js");
    writeFileSync(outside, "secret\n");
    symlinkSync(outside, join(source, "src/greeting.js"));

    const workspace = new SoftwareProductionWorkspace(
      join(root, "projects"),
      join(root, "supervised"),
    );
    await expect(workspace.prepare("project-general", "job-general", packet())).rejects.toThrow(
      /symbolic link/i,
    );
  });
});
