import { lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ApplicationError } from "@v31m4/application";
import { type SoftwareBuildPacket, softwareBuildPacketSchema } from "@v31m4/contracts";

export interface PreparedSoftwareWorkspace {
  readonly workspacePath: string;
  readonly context: string;
}

/** Runtime-owned bounded copy/materialization for a project software-production job. */
export class SoftwareProductionWorkspace {
  constructor(
    private readonly projectsRoot: string,
    private readonly supervisedRoot: string,
  ) {}

  async load(projectPath: string): Promise<SoftwareBuildPacket> {
    await mkdir(this.projectsRoot, { recursive: true });
    const source = await containedExistingDirectory(
      this.projectsRoot,
      projectPath,
      "Project source",
    );
    const packetPath = join(source, ".v31m4", "build-packet.json");
    const stat = await lstat(packetPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 64 * 1024) {
      throw new ApplicationError("INVALID_APPLICATION_INPUT", "Software build packet is invalid.");
    }
    try {
      return softwareBuildPacketSchema.parse(JSON.parse(await readFile(packetPath, "utf8")));
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Software build packet does not satisfy its contract.",
      );
    }
  }

  async prepare(
    projectPath: string,
    jobId: string,
    packet: SoftwareBuildPacket,
  ): Promise<PreparedSoftwareWorkspace> {
    await Promise.all([
      mkdir(this.projectsRoot, { recursive: true }),
      mkdir(this.supervisedRoot, { recursive: true }),
    ]);
    const source = await containedExistingDirectory(
      this.projectsRoot,
      projectPath,
      "Project source",
    );
    const workspaceRoot = join(this.supervisedRoot, "kernel-workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const destination = containedPath(workspaceRoot, jobId, "Job workspace");
    await mkdir(destination, { recursive: true });
    const files = await collectFiles(source, packet.resourceBudget.maxFiles);
    let totalBytes = 0;
    const contextParts: string[] = [];
    for (const file of files) {
      if (file === ".v31m4" || file.startsWith(".v31m4/")) continue;
      const sourcePath = join(source, file);
      const stat = await lstat(sourcePath);
      if (stat.isSymbolicLink()) {
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "Project source contains a symbolic link.",
          {
            details: { path: file },
          },
        );
      }
      if (!stat.isFile()) continue;
      if (stat.size > packet.resourceBudget.maxFileBytes) {
        throw new ApplicationError(
          "INVALID_APPLICATION_INPUT",
          "Project file exceeds packet limit.",
          {
            details: { path: file, byteSize: stat.size },
          },
        );
      }
      totalBytes += stat.size;
      if (totalBytes > packet.resourceBudget.maxTotalBytes) {
        throw new ApplicationError(
          "INVALID_APPLICATION_INPUT",
          "Project exceeds packet byte limit.",
        );
      }
      const bytes = await readFile(sourcePath);
      const target = join(destination, file);
      await mkdir(dirname(target), { recursive: true });
      await writeExclusiveOrEqual(target, bytes);
      if (packet.allowedPaths.some((scope) => withinScope(scope, file)) && isText(bytes)) {
        contextParts.push(`--- ${file} ---\n${bytes.toString("utf8")}`);
      }
    }
    const packetPath = join(destination, ".v31m4", "build-packet.json");
    await mkdir(dirname(packetPath), { recursive: true });
    await writeExclusiveOrEqual(packetPath, Buffer.from(`${JSON.stringify(packet, null, 2)}\n`));
    const context = contextParts.sort().join("\n");
    await writeExclusiveOrEqual(join(destination, ".v31m4", "context.txt"), Buffer.from(context));
    return Object.freeze({ workspacePath: destination, context });
  }

  async prompt(jobId: string, missionTitle: string, missionObjective: string): Promise<string> {
    const workspace = containedPath(
      join(this.supervisedRoot, "kernel-workspaces"),
      jobId,
      "Job workspace",
    );
    const packet = softwareBuildPacketSchema.parse(
      JSON.parse(await readFile(join(workspace, ".v31m4", "build-packet.json"), "utf8")),
    );
    const context = await renderAllowedContext(workspace, packet);
    return [
      "V31M4_SOFTWARE_PRODUCTION_MANIFEST_V1",
      `Mission: ${missionTitle}`,
      `Mission objective: ${missionObjective}`,
      `Build objective: ${packet.objective}`,
      `Allowed paths: ${packet.allowedPaths.join(", ")}`,
      `Forbidden changes: ${packet.forbiddenChanges.join(", ") || "none"}`,
      `Allowed operations: ${packet.allowedOperations.join(", ")}`,
      "Return only a JSON object with exactly one key, changes.",
      'Each change is {"path":"relative/path","operation":"create|update|delete","content":"full file content"}.',
      "Omit content only for delete. Do not use Markdown fences.",
      context,
    ].join("\n\n");
  }

  async repairRounds(jobId: string): Promise<number> {
    const workspace = containedPath(
      join(this.supervisedRoot, "kernel-workspaces"),
      jobId,
      "Job workspace",
    );
    const packet = softwareBuildPacketSchema.parse(
      JSON.parse(await readFile(join(workspace, ".v31m4", "build-packet.json"), "utf8")),
    );
    return packet.resourceBudget.maxRepairRounds;
  }
}

async function renderAllowedContext(
  workspace: string,
  packet: SoftwareBuildPacket,
): Promise<string> {
  const parts: string[] = [];
  let totalBytes = 0;
  for (const file of await collectFiles(workspace, packet.resourceBudget.maxFiles + 3)) {
    if (file === ".v31m4" || file.startsWith(".v31m4/")) continue;
    if (!packet.allowedPaths.some((scope) => withinScope(scope, file))) continue;
    const bytes = await readFile(join(workspace, file));
    totalBytes += bytes.length;
    if (
      bytes.length > packet.resourceBudget.maxFileBytes ||
      totalBytes > packet.resourceBudget.maxTotalBytes
    ) {
      throw new ApplicationError("INTEGRITY_FAILURE", "Repair context exceeds packet limits.");
    }
    if (isText(bytes)) parts.push(`--- ${file} ---\n${bytes.toString("utf8")}`);
  }
  return parts.sort().join("\n");
}

async function collectFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const directory = pending.pop() ?? "";
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) {
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "Project source contains a symbolic link.",
          {
            details: { path },
          },
        );
      }
      if (stat.isDirectory()) pending.push(path);
      else if (stat.isFile()) files.push(path);
      if (files.length > maxFiles) {
        throw new ApplicationError(
          "INVALID_APPLICATION_INPUT",
          "Project exceeds packet file limit.",
        );
      }
    }
  }
  return files.sort();
}

async function containedExistingDirectory(
  root: string,
  path: string,
  label: string,
): Promise<string> {
  const target = containedPath(root, path, label);
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + sep)) {
    throw new ApplicationError("PERMISSION_DENIED", `${label} escapes its owned root.`);
  }
  if (!(await lstat(canonicalTarget)).isDirectory()) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `${label} must be a directory.`);
  }
  return canonicalTarget;
}

function containedPath(root: string, path: string, label: string): string {
  const target = resolve(root, path);
  const canonicalRoot = resolve(root);
  if (target === canonicalRoot || !target.startsWith(canonicalRoot + sep)) {
    throw new ApplicationError("PERMISSION_DENIED", `${label} escapes its owned root.`);
  }
  return target;
}

async function writeExclusiveOrEqual(path: string, bytes: Buffer): Promise<void> {
  try {
    const current = await readFile(path);
    if (!current.equals(bytes)) {
      throw new ApplicationError(
        "CONFLICT",
        "Workspace preparation conflicts with existing content.",
        {
          details: { path: relative(process.cwd(), path) },
        },
      );
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

function withinScope(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

function isText(bytes: Buffer): boolean {
  return !bytes.includes(0);
}
