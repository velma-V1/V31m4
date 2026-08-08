import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths/path-policy.js";

function roots() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "v31m4-paths-")));
  const project = join(base, "project");
  const artifact = join(base, "artifact");
  const backup = join(base, "backup");
  const outside = join(base, "outside");
  for (const dir of [project, artifact, backup, outside]) mkdirSync(dir);
  return { base, project, artifact, backup, outside };
}

describe("PathPolicy", () => {
  it("resolves a project-relative path to a canonical location inside the approved root", async () => {
    const { project, artifact, backup } = roots();
    const policy = await PathPolicy.create({ project, artifact, backup });
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src", "one.ts"), "x");
    const resolved = await policy.resolve("project", "src/one.ts");
    expect(resolved).toBe(join(project, "src", "one.ts"));
  });

  it("resolves a not-yet-created write target inside the root", async () => {
    const { project, artifact, backup } = roots();
    const policy = await PathPolicy.create({ project, artifact, backup });
    const resolved = await policy.resolve("artifact", "new/deep/file.bin");
    expect(resolved).toBe(join(artifact, "new", "deep", "file.bin"));
  });

  it("rejects a symlink that escapes the approved root", async () => {
    const { project, artifact, backup, outside } = roots();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(project, "escape"));
    const policy = await PathPolicy.create({ project, artifact, backup });
    await expect(policy.resolve("project", "escape/secret.txt")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("rejects domain-invalid traversal and absolute inputs", async () => {
    const { project, artifact, backup } = roots();
    const policy = await PathPolicy.create({ project, artifact, backup });
    await expect(policy.resolve("project", "../escape")).rejects.toThrow();
    await expect(policy.resolve("project", "/etc/passwd")).rejects.toThrow();
    await expect(policy.resolve("project", "a\\b")).rejects.toThrow();
  });

  it("rejects an absolute path outside the root via assertContained", async () => {
    const { project, artifact, backup, outside } = roots();
    const policy = await PathPolicy.create({ project, artifact, backup });
    await expect(policy.assertContained("project", join(outside, "x"))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(await policy.assertContained("project", join(project, "ok"))).toBe(join(project, "ok"));
  });

  it("fails closed when an approved root does not exist", async () => {
    const { project, artifact } = roots();
    await expect(
      PathPolicy.create({ project, artifact, backup: join(project, "does-not-exist") }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
