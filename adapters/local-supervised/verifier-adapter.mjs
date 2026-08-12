import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { requireCanonicalId, requirePlainObject, runRpcHost } from "./rpc-host.mjs";

const MAX_OUTPUT_BYTES = 64 * 1024;
const root = resolve(requiredEnvironment("V31M4_STAGE4_ROOT"));
const workspaceRoot = join(root, "kernel-workspaces");
const reportRoot = join(root, "verifier-reports");
const active = new Map();
await mkdir(reportRoot, { recursive: true });

runRpcHost({
  "adapter.health": async () => ({ status: "healthy", verifier: "stage4-node-verifier" }),
  "adapter.cancel": async (params) => {
    const invocationId = requireCanonicalId(params.invocationId, "invocationId");
    active.get(invocationId)?.kill("SIGKILL");
    return null;
  },
  "tool.invoke": verifyCandidate,
});

async function verifyCandidate(raw) {
  const params = requirePlainObject(raw, "tool.invoke params");
  const invocationId = requireCanonicalId(params.invocationId, "invocationId");
  const jobId = requireCanonicalId(params.jobId, "jobId");
  if (params.toolId !== "stage4-deterministic-verifier") {
    throw new Error("Verifier tool identity is not allowlisted.");
  }
  if (params.operation !== "verify_candidate")
    throw new Error("Verifier operation is not allowlisted.");
  const workspace = await containedWorkspace(jobId);
  const timeoutMs = Math.min(
    30_000,
    Math.max(1, Number(params.resourceBudget?.maxWallClockMs ?? 30_000)),
  );
  const execution = await runVerification(workspace, invocationId, timeoutMs);
  const reportFile = `${invocationId}.json`;
  const report = {
    verifierId: "stage4-node-verifier",
    verifierVersion: "1.0.0",
    checkId: "stage4.tiny-code.tests",
    invocationId,
    jobId,
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
    timedOut: execution.timedOut,
  };
  await atomicReplace(join(reportRoot, reportFile), JSON.stringify(report));
  const reportArtifactId = `artifact-verifier-${digest(invocationId).slice(0, 32)}`;
  return {
    invocationId,
    toolId: params.toolId,
    status: execution.exitCode === 0 && !execution.timedOut ? "completed" : "failed",
    outputArtifactIds: [reportArtifactId],
    logArtifactIds: [reportArtifactId],
    exitCode: execution.exitCode,
    metadata: {
      adapterId: "stage4-local-verifier-adapter",
      verifierId: report.verifierId,
      verifierVersion: report.verifierVersion,
      checkId: report.checkId,
      reportFile,
      realCommand: true,
      timedOut: execution.timedOut,
    },
  };
}

async function runVerification(workspace, invocationId, timeoutMs) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--permission", `--allow-fs-read=${workspace}`, "verify.mjs"],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    active.set(invocationId, child);
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = boundedConcat(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundedConcat(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      active.delete(invocationId);
      resolveResult({
        exitCode: Number.isInteger(code) ? code : 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
      });
    });
  });
}

function boundedConcat(current, chunk) {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  const incoming = Buffer.from(chunk);
  return Buffer.concat([current, incoming.subarray(0, MAX_OUTPUT_BYTES - current.length)]);
}

async function containedWorkspace(jobId) {
  const canonicalRoot = await realpath(workspaceRoot);
  const workspace = await realpath(join(workspaceRoot, jobId));
  if (!workspace.startsWith(canonicalRoot + sep))
    throw new Error("Verifier workspace escapes root.");
  return workspace;
}

async function atomicReplace(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { flag: "wx" });
  await rename(temporary, path);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}
