import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { requireCanonicalId, requirePlainObject, runRpcHost } from "./rpc-host.mjs";

const MAX_CANDIDATE_BYTES = 64 * 1024;
const root = resolve(requiredEnvironment("V31M4_STAGE4_ROOT"));
const workspaceRoot = join(root, "kernel-workspaces");
await mkdir(workspaceRoot, { recursive: true });

runRpcHost({
  "adapter.health": async () => ({ status: "healthy", kernel: "stage4-local-kernel" }),
  "kernel.start_job": startJob,
  "kernel.checkpoint_job": checkpointJob,
  "kernel.resume_job": resumeJob,
  "kernel.stop_job": stopJob,
  "kernel.job_status": statusJob,
});

async function startJob(raw) {
  const params = requirePlainObject(raw, "kernel.start_job params");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const projectId = requireCanonicalId(params.projectId, "projectId");
  const missionId = requireCanonicalId(params.missionId, "missionId");
  requireCanonicalId(params.invocationId, "invocationId");
  if (params.workflowId !== "stage4.tiny-code")
    throw new Error("Kernel workflow is not allowlisted.");
  const workspace = await ensureWorkspace(jobId);
  const current = await readState(workspace);
  if (current !== null) {
    if (current.projectId !== projectId || current.missionId !== missionId) {
      throw new Error("Kernel job identity conflicts with durable workspace state.");
    }
    return receipt(current.operationId, current.acceptedAt, jobId);
  }
  const acceptedAt = new Date().toISOString();
  const operationId = `kernel-operation-${randomUUID()}`;
  await atomicWrite(
    join(workspace, "solution.mjs"),
    'export function add() { throw new Error("not implemented"); }\n',
  );
  await atomicWrite(
    join(workspace, "verify.mjs"),
    [
      'import { strict as assert } from "node:assert";',
      'import { add } from "./solution.mjs";',
      "assert.equal(add(2, 3), 5);",
      "assert.equal(add(-2, 3), 1);",
      'process.stdout.write("stage4 tiny-code verification passed\\n");',
      "",
    ].join("\n"),
  );
  const state = {
    jobId,
    projectId,
    missionId,
    workflowId: params.workflowId,
    operationId,
    acceptedAt,
    status: "running",
    stage: "fixture_ready",
    progress: 0.25,
    applyCount: 0,
  };
  await writeState(workspace, state);
  return receipt(operationId, acceptedAt, jobId);
}

async function checkpointJob(raw) {
  const params = requirePlainObject(raw, "kernel.checkpoint_job params");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const stage = requireCanonicalId(params.stage, "stage");
  requireCanonicalId(params.invocationId, "invocationId");
  const workspace = await existingWorkspace(jobId);
  const state = requiredState(await readState(workspace));
  const candidatePath = join(workspace, "candidate.mjs");
  const candidate = await readRegularBounded(candidatePath);
  const candidateHash = digest(candidate);
  const checkpointId = `checkpoint-${digest(`${jobId}:${candidateHash}`).slice(0, 32)}`;
  const checkpoint = {
    checkpointId,
    jobId,
    stage,
    candidateHash,
    candidateBytes: candidate.length,
  };
  await mkdir(join(workspace, "checkpoints"), { recursive: true });
  await atomicReplace(
    join(workspace, `checkpoints/${checkpointId}.json`),
    JSON.stringify(checkpoint),
  );
  await writeState(workspace, {
    ...state,
    status: "paused",
    stage,
    progress: 0.5,
    checkpointId,
    candidateHash,
  });
  return checkpointId;
}

async function resumeJob(raw) {
  const params = requirePlainObject(raw, "kernel.resume_job params");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const checkpointId = requireCanonicalId(params.checkpointId, "checkpointId");
  requireCanonicalId(params.invocationId, "invocationId");
  const workspace = await existingWorkspace(jobId);
  const state = requiredState(await readState(workspace));
  let checkpoint;
  try {
    checkpoint = JSON.parse(
      await readFile(join(workspace, `checkpoints/${checkpointId}.json`), "utf8"),
    );
  } catch {
    throw new Error("Kernel checkpoint does not exist.");
  }
  if (checkpoint.jobId !== jobId || checkpoint.checkpointId !== checkpointId) {
    throw new Error("Kernel checkpoint belongs to a different job.");
  }
  const candidatePath = join(workspace, "candidate.mjs");
  const candidate = await readRegularBounded(candidatePath);
  const candidateHash = digest(candidate);
  if (checkpoint.candidateHash !== candidateHash || state.checkpointId !== checkpointId) {
    throw new Error("Kernel checkpoint is stale or candidate content changed.");
  }
  if (state.appliedHash === candidateHash) {
    if (state.status === "cancelled") {
      throw new Error("An emergency-stopped completed kernel effect cannot be resumed.");
    }
    if (state.status !== "completed") {
      await writeState(workspace, {
        ...state,
        status: "completed",
        stage: "candidate_applied",
        progress: 0.75,
      });
    }
    return receipt(state.operationId, state.acceptedAt, jobId);
  }
  await rejectSymlink(join(workspace, "solution.mjs"));
  const currentSolution = await readRegularBounded(join(workspace, "solution.mjs"));
  if (digest(currentSolution) === candidateHash) {
    await writeState(workspace, {
      ...state,
      status: "completed",
      stage: "candidate_applied",
      progress: 0.75,
      appliedHash: candidateHash,
      applyCount: Math.max(1, state.applyCount),
    });
    return receipt(state.operationId, state.acceptedAt, jobId);
  }
  await atomicReplace(join(workspace, "solution.mjs"), candidate);
  await writeState(workspace, {
    ...state,
    status: "completed",
    stage: "candidate_applied",
    progress: 0.75,
    appliedHash: candidateHash,
    applyCount: state.applyCount + 1,
  });
  return receipt(state.operationId, state.acceptedAt, jobId);
}

async function stopJob(raw) {
  const params = requirePlainObject(raw, "kernel.stop_job params");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  requireCanonicalId(params.invocationId, "invocationId");
  const workspace = await existingWorkspace(jobId);
  const state = requiredState(await readState(workspace));
  const status = params.mode === "finish_and_stop" ? "paused" : "cancelled";
  await writeState(workspace, { ...state, status, stage: params.mode });
  return null;
}

async function statusJob(raw) {
  const params = requirePlainObject(raw, "kernel.job_status params");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  const workspace = await existingWorkspace(jobId);
  const state = requiredState(await readState(workspace));
  return {
    jobId,
    status: state.status,
    stage: state.stage,
    progress: state.progress,
    ...(state.checkpointId === undefined ? {} : { checkpointId: state.checkpointId }),
    details: { realEffect: true, applyCount: state.applyCount, workspaceId: jobId },
  };
}

async function ensureWorkspace(jobId) {
  const workspace = join(workspaceRoot, jobId);
  await mkdir(workspace, { recursive: true });
  const canonicalRoot = await realpath(workspaceRoot);
  const canonicalWorkspace = await realpath(workspace);
  if (!canonicalWorkspace.startsWith(canonicalRoot + sep))
    throw new Error("Workspace escapes root.");
  return canonicalWorkspace;
}

async function existingWorkspace(jobId) {
  try {
    return await ensureWorkspace(jobId);
  } catch {
    throw new Error("Kernel workspace does not exist.");
  }
}

async function readState(workspace) {
  try {
    return JSON.parse(await readFile(join(workspace, "kernel-state.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requiredState(value) {
  if (value === null) throw new Error("Kernel job state does not exist.");
  return value;
}

async function writeState(workspace, state) {
  await atomicReplace(join(workspace, "kernel-state.json"), JSON.stringify(state));
}

async function readRegularBounded(path) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > MAX_CANDIDATE_BYTES
  ) {
    throw new Error("Kernel candidate is invalid or oversized.");
  }
  return readFile(path);
}

async function rejectSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Kernel target is a symlink.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function atomicWrite(path, content) {
  await writeFile(path, content, { flag: "wx" });
}

async function atomicReplace(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { flag: "wx" });
  await rename(temporary, path);
}

function receipt(operationId, acceptedAt, jobId) {
  return { operationId, acceptedAt, idempotencyKey: jobId };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}
