import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const MAX_PACKET_BYTES = 64 * 1024;

export async function loadSoftwarePacket(workspace, expectedProjectId) {
  const raw = await readBounded(join(workspace, ".v31m4/build-packet.json"), MAX_PACKET_BYTES);
  const packet = JSON.parse(raw.toString("utf8"));
  if (
    packet?.schemaVersion !== "1.0.0" ||
    packet.projectId !== expectedProjectId ||
    !Array.isArray(packet.allowedPaths) ||
    !Array.isArray(packet.forbiddenChanges) ||
    !Array.isArray(packet.allowedOperations) ||
    !Array.isArray(packet.commands) ||
    !Array.isArray(packet.mandatoryCommandIds) ||
    typeof packet.resourceBudget?.maxFileBytes !== "number"
  ) {
    throw new Error("Software build packet is malformed or belongs to another project.");
  }
  return packet;
}

export function parseChangeManifest(bytes, packet) {
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).some((key) => key !== "changes") ||
    !Array.isArray(manifest.changes) ||
    manifest.changes.length === 0 ||
    manifest.changes.length > packet.resourceBudget.maxFiles
  ) {
    throw new Error("Candidate change manifest is malformed.");
  }
  const seen = new Set();
  const changes = manifest.changes.map((change) => {
    if (
      change === null ||
      typeof change !== "object" ||
      Array.isArray(change) ||
      Object.keys(change).some((key) => !new Set(["path", "operation", "content"]).has(key)) ||
      typeof change.path !== "string" ||
      !safeRelative(change.path) ||
      typeof change.operation !== "string" ||
      !packet.allowedOperations.includes(change.operation) ||
      seen.has(change.path) ||
      !packet.allowedPaths.some((scope) => withinScope(scope, change.path)) ||
      packet.forbiddenChanges.some((scope) => withinScope(scope, change.path))
    ) {
      throw new Error("Candidate change is outside the approved production scope.");
    }
    seen.add(change.path);
    if (change.operation === "delete") {
      if (change.content !== undefined) throw new Error("Delete changes cannot contain content.");
    } else if (
      typeof change.content !== "string" ||
      change.content.includes("\0") ||
      Buffer.byteLength(change.content) > packet.resourceBudget.maxFileBytes
    ) {
      throw new Error("Candidate change content is missing or oversized.");
    }
    return Object.freeze({
      path: change.path,
      operation: change.operation,
      ...(change.content === undefined ? {} : { content: change.content }),
    });
  });
  return Object.freeze(changes);
}

export async function applyChangeManifest(workspace, changes) {
  const prepared = [];
  for (const change of changes) {
    const target = contained(workspace, change.path);
    await rejectSymlinkChain(workspace, change.path);
    if (change.operation === "create") {
      try {
        await lstat(target);
        throw new Error("Create target already exists.");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      prepared.push({ change, target, previous: null });
    } else {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Update or delete target is not a safe file.");
      }
      prepared.push({ change, target, previous: await readFile(target) });
    }
  }
  const applied = [];
  try {
    for (const entry of prepared) {
      if (entry.change.operation === "create") {
        await mkdir(dirname(entry.target), { recursive: true });
        await writeFile(entry.target, entry.change.content, { encoding: "utf8", flag: "wx" });
      } else if (entry.change.operation === "delete") {
        await unlink(entry.target);
      } else {
        await atomicReplace(entry.target, entry.change.content);
      }
      applied.push(entry);
    }
  } catch (error) {
    for (const entry of applied.reverse()) {
      if (entry.previous === null) await unlink(entry.target).catch(() => undefined);
      else await atomicReplace(entry.target, entry.previous);
    }
    throw error;
  }
}

async function rejectSymlinkChain(workspace, relativePath) {
  const parts = relativePath.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    const current = join(workspace, ...parts.slice(0, index));
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Production path is a symlink.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return;
    }
  }
}

function contained(workspace, relativePath) {
  const root = resolve(workspace);
  const target = resolve(root, relativePath);
  if (!target.startsWith(root + sep)) throw new Error("Production path escapes workspace.");
  return target;
}

function safeRelative(value) {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function withinScope(scope, path) {
  return path === scope || path.startsWith(`${scope}/`);
}

async function readBounded(path, limit) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > limit) {
    throw new Error("Software production control file is invalid or oversized.");
  }
  return readFile(path);
}

async function atomicReplace(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}
