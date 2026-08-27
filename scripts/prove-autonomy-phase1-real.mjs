import { spawn } from "node:child_process";

// V31M4-AUTONOMY-001 / 1.1.0 Task 1 target-host proof.
//
// Runs the real phase-1 boundary against this machine: real workspaces through
// WorkspaceManagerPort, the real sandbox supervisor, the real semantic operation catalog, and
// the hardened direct-Docker backend when a container runtime and a digest-pinned image are
// actually available. Missing prerequisites are reported, never faked.
//
//   V31M4_DOCKER_EXECUTABLE           docker CLI to probe (default: docker)
//   V31M4_SANDBOX_IMAGE               digest-pinned image, e.g. alpine@sha256:<64 hex>
//   V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1   treat a missing container runtime as a failure

const environment = {
  ...process.env,
  V31M4_AUTONOMY_PHASE1_REAL: "1",
  V31M4_DOCKER_EXECUTABLE: process.env.V31M4_DOCKER_EXECUTABLE ?? "docker",
  V31M4_SANDBOX_IMAGE: process.env.V31M4_SANDBOX_IMAGE ?? "",
};

// A non-empty image is not a pinned image: only a `<repository>@sha256:<64 lowercase hex>`
// reference is an acceptable trusted dependency, and the backend refuses anything else.
const DIGEST_PINNED_IMAGE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/u;
const imageIsPinned = DIGEST_PINNED_IMAGE.test(environment.V31M4_SANDBOX_IMAGE);

process.stdout.write(
  `[phase1-proof] docker executable: ${environment.V31M4_DOCKER_EXECUTABLE}\n` +
    `[phase1-proof] sandbox image: ${environment.V31M4_SANDBOX_IMAGE || "(none supplied)"}\n` +
    `[phase1-proof] sandbox image digest-pinned: ${imageIsPinned}\n` +
    `[phase1-proof] require docker: ${environment.V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER === "1"}\n`,
);
if (!imageIsPinned) {
  process.stdout.write(
    "[phase1-proof] NOTE: without a digest-pinned V31M4_SANDBOX_IMAGE the container isolation\n" +
      "[phase1-proof]       properties cannot be observed and are NOT proven by this run.\n",
  );
}

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "apps/runtime/tests/autonomy/autonomy-phase1-real.target-host.test.ts"],
  { cwd: process.cwd(), env: environment, stdio: "inherit", shell: false },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start the phase 1 proof: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.stderr.write(`Phase 1 proof terminated by ${signal}.\n`);
  process.exitCode = code ?? 1;
});
