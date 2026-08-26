# V31M4 Autonomy Task 1 — Scoped Semantic ACI, `SandboxPort`, Adapter-Protocol-1.1 Foundation

> ## STATUS: INCOMPLETE — independent verification FAILED, defects repaired, target-host proof still BLOCKED
>
> An independent Codex review of the first implementation (commit `fc84f37`) returned **FAIL** with
> four findings. All four were reproduced, root-caused, and repaired; see
> "Independent review findings and remediation" below. **Task 1 still does not pass its hard gate**,
> because the mandatory target-host Docker proof has never observed a real container: non-root
> execution, read-only root, absent Docker socket, blocked egress, workspace-only write, and verified
> container cleanup remain unproven on this host.
>
> Everything in "Original Task 1 evidence" below is preserved exactly as it was recorded at
> `fc84f37`, including the claims the review invalidated. It is kept as the failed record, not as a
> current description of the system. Where it conflicts with the remediation section, the
> remediation section is authoritative.

## Original Task 1 evidence (recorded at `fc84f37`; superseded where the review found defects)

**Date:** 2026-08-25
**Program:** `V31M4-AUTONOMY-001 / 1.1.0`
**Canonical architecture:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`
**Canonical plan:** `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md` (Task 1)
**Baseline frozen by:** `docs/reviews/autonomy-baseline-v2.md` (Task 0)

## Live state

- Branch: `autonomy-v1.1.0`
- Starting HEAD: `6e4fdd5d1961603931bde331e279b514bcd93d0f`
- `git status --short` at start: clean (no tracked or untracked changes)
- Task 0 hard gate re-verified before any product change: `pnpm check` exit 0, lint 0 errors
  (9 pre-existing warnings, 1 pre-existing info), typecheck 9/9, **490 passing / 14 skipped / 9 todo
  (513 total) across 107 passing + 5 skipped test files (112 total)** — matching
  `autonomy-baseline-v2.md` exactly.

## What Task 1 added

### Durable identifiers

`packages/domain/src/value-objects/ids.ts` gains `TaskId`, `SandboxId`, `LedgerEntryId`, `SkillId`,
and `MemoryId` through the existing `createParser`/`parseDurableId` mechanism — the same canonical
durable-ID syntax, the same `INVALID_ID` failures, no parallel identifier format. `ContentHash`,
`JobId`, `ProjectId`, `ArtifactId`, `EvidenceId`, `ModelId`, and `ToolId` are reused unchanged.

### `SandboxPort` (`packages/application/src/ports/sandbox.port.ts`)

The canonical v2 interface, plus the fail-closed pieces the plan's type sketch implies but a type
alone cannot enforce:

- `SandboxIsolationPolicy.create` stamps every security invariant itself
  (`writableWorkspaceOnly`, `readOnlyRootFilesystem`, `nonRootUser`, `noNewPrivileges`,
  `dropAllCapabilities` true; `allowHostDockerSocket`, `allowAmbientHostSecrets` false). A caller
  that supplies any of those keys with a different value gets `PERMISSION_DENIED` — the invariants
  are unreachable from configuration, not merely unwritable in TypeScript.
- CPU (1–64 000 millis/second) and PID (1–4 096) bounds are mandatory; there is no
  "unbounded by omission" path. Egress defaults to `{ mode: "none" }`; an allowlist must be a
  bounded, unique, syntactically valid host list.
- `SandboxExecutionStatus` is `completed | failed | cancelled | unknown`.
  `assertPublicToolInvocationStatus` narrows it for the public contract and throws
  `INTEGRITY_FAILURE` on `unknown` — an unreconciled effect is never coerced into a success or a
  plain failure. The public `ToolInvocationResult.status` union in `tool-gateway.port.ts` is
  byte-unchanged.
- `prepare` consumes an existing `WorkspaceHandle`; the port invents no second workspace lifecycle.

### Semantic ACI (`apps/runtime/src/autonomy/semantic-operation-catalog.ts`)

The single V31M4-owned `SemanticOperationDefinition` registry, containing exactly the nineteen
approved operation IDs and nothing else. Each definition records operation ID, input/result schema
version, effect class, risk class, sandbox requirement, allowed roles, evidence-precondition policy
ID, resource policy, and required parameters.

- `git.worktree` is deliberately absent, and so is any other worktree/workspace-lifecycle
  operation. `WorkspaceManagerPort` remains the sole worktree authority; the model gets read-only
  `git.status` / `git.diff` / `git.history` inside its assigned workspace.
- Role permissions are operation-level. `read` operations are available to manager, executor, and
  auditor; everything else is executor-only and sandbox-required, so the read-only auditor and the
  non-acting manager have no route to a write, execute, or network operation.
- `command.run` is classified `process_execute` / `critical` / sandbox-required with its own
  escape-hatch evidence-policy reference.
- `parseCodePatchScope` requires an expected `ContentHash` fingerprint, a bounded closed
  `SafePath` scope, and a non-empty patch body. `assertCodePatchTargetIsCurrent` rejects a moved
  target with `CONFLICT` rather than overwriting newer work.
- `assertSemanticEffectIsExecutable` is the single gate: an approved operation, a permitted role,
  an `allow` policy decision, a workspace assigned by `WorkspaceManagerPort`, and — for anything
  that is not a pure read — a prepared sandbox. Read operations stay available without a sandbox so
  a denial never traps the investigation path needed to satisfy it.

The evidence-precondition policy IDs are **references only**. No precondition engine and no second
evidence taxonomy was created; the existing `EvidenceRecord` remains the authoritative evidence
type and Task 6 owns the engine.

### Sandbox infrastructure (`packages/infrastructure/src/sandbox/`)

- `SandboxSupervisor` implements `SandboxPort`. `prepare` re-reads the workspace from
  `WorkspaceManagerPort` and refuses anything unknown, sealed/discarded, or inconsistent with the
  handle it was handed, so a forged handle cannot conjure a workspace through this boundary. It
  runs only operations in an explicitly injected closed operation set — the set comes from the
  runtime catalog, so infrastructure enforces it without owning a second copy. A backend that
  raises `SandboxIndeterminateEffectError` yields internal `status: "unknown"` and degrades the
  handle instead of reporting success or inviting a blind retry.
- `ReferenceSandboxBackend` is the hermetic default. It does real work — real `realpath`-based
  containment against the assigned workspace and real SHA-256 fingerprints of real file bytes — and
  performs **no** effects: an effectful request returns an honest `failed` result naming
  `reference_backend_performs_no_effects` rather than fabricating success.
- `DirectDockerSandbox` is the hardened challenger. `buildDockerRunArguments` is exported so the
  security boundary is asserted against the real production argv: `--network none`, `--read-only`,
  `--cap-drop ALL`, `--security-opt no-new-privileges`, non-root `--user`, `--pids-limit`,
  `--cpus`, `--memory`/`--memory-swap`, the assigned workspace as the **only** bind mount, and
  ephemeral `noexec,nosuid,nodev` tmpfs for `/tmp` and a temporary in-container HOME. No Docker
  socket, no `--privileged`, no `--cap-add`, no host PID/network namespace. An egress allowlist it
  cannot yet enforce fails closed with `UNSUPPORTED_OPERATION` instead of widening access. A missing
  container runtime yields `DEPENDENCY_UNAVAILABLE`; isolation is never degraded to keep running.
  Commands are argument arrays — no shell string is ever constructed. This is a challenger, not a
  decision: the frozen boundary is `SandboxPort`, and backend selection stays open until the
  target-host bake-off, which may still conclude `NO_ACCEPTABLE_BACKEND`.

### Adapter protocol 1.1 (`packages/contracts/src/adapter-rpc-v1_1.schemas.ts`)

Additive and side by side. `adapter-rpc.schemas.ts` and `common.schemas.ts` are **byte-unchanged**;
`ADAPTER_PROTOCOL_VERSION` is still `"1.0.0"`.

- `ADAPTER_PROTOCOL_VERSION_1_1 = "1.1.0"`, `SUPPORTED_ADAPTER_PROTOCOL_VERSIONS = ["1.1.0", "1.0.0"]`.
- `adapterInitializeV1_1RequestSchema` (1.1-literal version) and `toolInvokeScopedV1_1RequestSchema`
  (`tool.invoke_scoped`, carrying `taskId` + `workspaceId` + `sandboxId` + semantic `operation`).
  A distinct method name means a 1.0 peer refuses it outright rather than partially understanding it.
- `negotiateAdapterProtocolVersion` selects the highest exact mutually supported version and throws
  otherwise — no range matching, no prerelease tolerance, no closest-version fallback.
- Every 1.1 object is `.strict()`; there is no provider extension bag. The 1.1 result status union
  is `completed | failed | cancelled` — `unknown` never reaches the wire.
- `AdapterRegistry` now takes the supported-version set explicitly and rejects registration under
  any other version. This tightened a previously unvalidated `protocolVersion: string`; its existing
  test kept every assertion and only moved its fixture from `"1"` to `"1.0.0"`.

Semantic operation IDs are validated in contracts by **syntax only**; the closed set lives in the
runtime catalog, so the wire contract does not become a second operation registry.

### Proof

`scripts/prove-autonomy-phase1-real.mjs` runs
`apps/runtime/tests/autonomy/autonomy-phase1-real.target-host.test.ts` with
`V31M4_AUTONOMY_PHASE1_REAL=1`.

## Protocol 1.0 preservation evidence

- `git status --short` shows no modification to `packages/contracts/src/adapter-rpc.schemas.ts` or
  `packages/contracts/src/common.schemas.ts`; `git diff --stat` on both is empty.
- `packages/contracts/tests/adapter-rpc-v1_1.schemas.test.ts` asserts `ADAPTER_PROTOCOL_VERSION`
  is `"1.0.0"`, the 1.0 request union still has exactly **11** members, canonical 1.0 initialize and
  `tool.invoke` payloads round-trip to deep-equal values, and the 1.0 parser rejects
  `tool.invoke_scoped`, a `1.1.0` protocol version, and `taskId`/`sandboxId` added to
  `tool.invoke`.
- `packages/application/src/ports/tool-gateway.port.ts` is unmodified: public
  `ToolInvocationResult.status` is still `completed | cancelled | failed`.
- No runtime API change: no route, command, query, or public schema was added or altered.
  `apps/runtime/src/api/` is untouched.

## Verification

### Focused Task 1 verification

`pnpm exec vitest run packages/domain/tests/ids.test.ts packages/application/tests/sandbox-port.test.ts packages/contracts/tests/adapter-rpc-v1_1.schemas.test.ts packages/infrastructure/tests/sandbox.test.ts packages/infrastructure/tests/adapter-operations.test.ts apps/runtime/tests/autonomy`

**57 passing / 2 skipped / 8 todo (67 total) across 8 passing + 1 skipped test files (9 total).**
The 2 skips and the 1 skipped file are the opt-in target-host proof; the 8 todo are the remaining
program-inventory placeholders owned by later tasks.

### Target-host proof

`node scripts/prove-autonomy-phase1-real.mjs` — **2 passing**, exit 0. Recorded output:

```text
[phase1-proof] docker executable: docker
[phase1-proof] pinned sandbox image: (none supplied)
[phase1-proof] require docker: false
[phase1-proof] prepared reference sandbox sandbox:phase1-reference on real workspace workspace-<uuid>
[phase1-proof] real workspace fingerprint target.ts=5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29
[phase1-proof] reference-backend boundary proof: PASS
[phase1-proof] container runtime (docker) reachable: false
[phase1-proof] pinned sandbox image supplied: false
[phase1-proof] direct-Docker container assertions: NOT PROVEN on this host (prerequisite missing);
               fail-closed behavior verified instead
```

What the proof genuinely exercised: a real `LocalWorkspaceManager` workspace on the real
filesystem, a real `SandboxSupervisor` bound to `WorkspaceManagerPort` authority, real SHA-256
fingerprints of real bytes, a real path-escape refusal against the real filesystem, the governed
effect gate refusing an effect with no sandbox, and `DirectDockerSandbox` failing closed with
`DEPENDENCY_UNAVAILABLE`.

### Full gate

`pnpm check` — **exit 0**:

- `pnpm lint` (Biome): 364 files checked, **0 errors, 9 warnings, 1 info** — the same 9 pre-existing
  warnings and 1 pre-existing info as the Task 0 baseline. Task 1 introduced no new lint diagnostic.
- `pnpm typecheck`: **9/9 packages pass.**
- `pnpm test`: **535 passing / 16 skipped / 8 todo (559 total) across 113 passing + 5 skipped test
  files (118 total).**

Against the Task 0 baseline of 490 passing / 14 skipped / 9 todo (513) across 107 + 5 files (112):
**+45 passing, +2 skipped (the opt-in target-host proof's two tests), −1 todo** (the
`no model-direct effect bypass` inventory entry became executable coverage, per Task 1 Step 6),
**+6 passing files** and no net change in skipped files (the invariants file moved from
skipped-because-all-todo to passing; the new target-host file took its place among the skipped).
**Zero failures, zero regressions.**

`pnpm build`: **9/9 packages pass.** `git diff --check`: clean.

Static guards: largest new source file is 333 lines (`sandbox-supervisor.ts`), all below the 500-line
limit; no explicit `any` in new runtime source; infrastructure imports no `@v31m4/contracts`;
`apps/runtime` imports only frozen-core packages, `zod`, and Node APIs.

## Dependency and supply-chain changes

**None.** No dependency was added, removed, or changed; `package.json` files and `pnpm-lock.yaml`
are untouched, and `pnpm-workspace.yaml allowBuilds` is unchanged. None of Tree-sitter, SCIP,
scip-typescript, ast-grep, MCP, OpenSandbox, OpenShell, or Qwen embeddings was installed.

`turbo.json` gained four `globalPassThroughEnv` entries (`V31M4_AUTONOMY_PHASE1_REAL`,
`V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER`, `V31M4_DOCKER_EXECUTABLE`, `V31M4_SANDBOX_IMAGE`) so the new
opt-in proof's environment variables are declared for cache correctness, exactly as the existing
`V31M4_STAGE4_REAL` entry does. This is configuration, not a dependency.

## Discrepancies between the live repository and the v2 plan

1. **There was no protocol-negotiation implementation to modify.** The plan's Task 1 file list says
   "modify protocol negotiation/adapter invoker infrastructure". In the live tree no `adapter.initialize`
   handshake is performed anywhere — the schema existed but was never sent, and `AdapterRegistry`
   (its only holder of a `protocolVersion`) was referenced solely by a test and validated nothing.
   Negotiation was therefore **added**, in the contracts package (the versioning authority), and
   `AdapterRegistry` was tightened to reject unsupported versions using an injected set. No shadow
   abstraction and no second version list was created. `AdapterInvoker`/`JsonRpcAdapterInvoker` were
   not modified: nothing in Task 1 requires a live 1.1 transport, and a 1.1-speaking adapter first
   appears in Task 4.
2. **`WorkspaceHandle.rootPath` is a project-relative `SafePath`, not a host path.** The plan's
   `SandboxPort.prepare` sketch implies the backend can locate the workspace from the handle; it
   cannot. `SandboxSupervisor` therefore takes an injected `resolveWorkspaceRoot`, so the trusted
   caller — which owns `PathPolicy` and the approved roots — supplies the absolute directory and the
   sandbox never derives host paths itself. This strengthens rather than weakens the boundary.
3. **The plan names two sandbox files; three exist under `sandbox/`.** Only two were created
   (`sandbox-supervisor.ts`, `direct-docker-sandbox.ts`); the hermetic reference backend the plan's
   Step 3 requires lives inside `sandbox-supervisor.ts` rather than in a third file, keeping the
   file count at the plan's `sandbox/*` ownership.

## Unresolved risks

1. **The direct-Docker container assertions are unproven on this host — the Task 1 hard gate's
   "actual target-host sandbox proof" is therefore only partly satisfied.** The Docker CLI is
   installed (`/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe`, client 29.6.2,
   context `desktop-linux`) but the Docker Desktop Linux engine is not running
   (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`), and WSL
   integration is not enabled for this distro, so `/usr/bin/docker` reports
   "could not be found in this WSL 2 distro". Starting Docker Desktop and enabling WSL integration
   are material host actions and were not taken automatically, matching the precedent in
   `docs/reviews/target-host-validation.md`. Consequently the following remain **claimed by
   construction and asserted against the real argv, but not observed in a running container**:
   non-root execution, read-only root filesystem, absent Docker socket, blocked egress, and
   workspace-only write. To close this, enable Docker Desktop WSL integration for this distro and run:

   ```bash
   V31M4_SANDBOX_IMAGE=alpine@sha256:<digest> \
   V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 \
   node scripts/prove-autonomy-phase1-real.mjs
   ```

   No sandbox backend may be promoted on this evidence; the bake-off (Task 11) still owns that
   decision and may still return `NO_ACCEPTABLE_BACKEND`.
2. **No digest-pinned sandbox image is chosen yet.** The proof requires the operator to supply one;
   the code deliberately has no default, because a floating tag would be an unpinned trusted
   dependency.
3. **Egress allowlisting is unimplemented in the Docker backend.** It fails closed today. A future
   phase that needs bounded egress must add a real enforcement mechanism rather than relaxing
   `--network none`.
4. **Role assignments are conservative pending Task 5.** Every non-`read` operation is
   executor-only, including `browser.verify`, which an auditor might reasonably need. Widening it
   requires Task 5's role work and evidence, and fail-closed is the correct default until then.

## Scope statement

This task implemented Task 1 only. No Task Capsule, Execution Ledger, agent-turn loop,
Manager/Executor/Auditor harness, Project Intelligence, embeddings, skills, MCP, memory router,
quality-floor controller, evaluation lab, or self-improvement behavior was added. No runtime API
`1.0.0` surface, adapter protocol `1.0.0` schema, or public tool status was changed, and no sandbox
backend was selected.

---

# Independent review findings and remediation

**Verifier:** independent Codex review of `fc84f37` · **Verdict:** FAIL · **Repair date:** 2026-08-25
**Repair starting HEAD:** `fc84f370359ab1593d013e18b659ab324755fa43`, clean worktree.

Each finding was reproduced against the committed code before any fix, then repaired at the root
cause with a regression that fails without the fix.

## Reproduction

A probe run against `fc84f37` produced this argv from `buildDockerRunArguments` with settings
`{ image: "alpine:latest", userSpec: "0:0", containerWorkdir: "/" }` and operation-independent
parameters `{ executable: "touch", arguments: ["/etc/probe"] }`:

```text
run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges
--user 0:0 --pids-limit 64 --cpus 0.5 --workdir /
--mount type=bind,source=/tmp/probe-XXXXXX,target=/ ... alpine:latest touch /etc/probe
```

That single line reproduces Findings 1 and 3 together: an unpinned image, uid/gid 0, the workspace
bind-mounted **over the container root**, and a caller-chosen executable. Finding 2 was confirmed by
inspection of the same commit: `child_process.spawn` used directly, `docker rm --force` results
discarded with `.catch(() => undefined)`, no pre-abort check, a timeout that killed only the docker
client, and `#sandboxes.delete(id)` executed *before* `backend.destroy`.

## Finding 1 — semantic authorization was not bound to the execution sink

**Root cause:** authorization and execution were separate steps. `SandboxPort.execute` accepted
`(operation: string, parameters: ApplicationJsonObject)`; the supervisor checked only that the
operation name was in an allow-set, and `DirectDockerSandbox` read `parameters.executable` /
`parameters.arguments` for *any* operation. `assertSemanticEffectIsExecutable`,
`parseCodePatchScope`, and `assertCodePatchTargetIsCurrent` existed but had no mandatory production
caller, so they were advisory.

**Repair:**

- `AuthorizedSemanticExecutionPlan` (`packages/application/src/ports/sandbox.port.ts`) is a
  capability token with a private `#authorized` field. `isAuthentic` rejects a structurally
  identical plain object, so a fabricated plan cannot reach a backend. Issuance requires role
  membership, an `allow` policy decision, an **active** workspace, and — for anything that is not a
  pure read — a sandbox whose `taskId`, `jobId`, and `workspaceId` match the request and whose
  status is not `stopped`.
- `SandboxPort.execute` now takes `(sandbox, plan, context)`. `SandboxSupervisor` verifies
  authenticity, re-checks that the plan is bound to this exact sandbox/task/job/workspace, and only
  then dispatches. `SandboxBackend.execute` receives the plan, never raw parameters.
- `authorizeSemanticExecution` (`apps/runtime/src/autonomy/semantic-execution-authorization.ts`) is
  the single mandatory boundary. It **derives** the command:
  `git.status → git status --porcelain=v1`, `git.diff → git diff --no-color -- <validated SafePath
  scope>`, `git.history → git log --no-color --max-count=<bounded int>`; `code.inspect` and
  `code.patch` are backend-native with no command at all; every remaining operation fails closed
  with `UNSUPPORTED_OPERATION` ("no trusted execution binding yet") rather than running whatever was
  supplied. Only `command.run` — the declared escape hatch — may carry a caller-supplied executable,
  still as an argument array.
- For any operation that is not the escape hatch, the presence of `executable`, `arguments`, `argv`,
  `command`, `cmd`, `entrypoint`, `shell`, `image`, `user`, `mount`, `privileged`, or `network` in
  the parameters is a `PERMISSION_DENIED`, not a silent drop.
- `code.patch` is validated at that same boundary: `parseCodePatchScope` requires the expected
  fingerprint and a closed `SafePath` scope; a request with no observed current fingerprint is
  denied because currency cannot be proven; a mismatch is `CONFLICT`. The plan records both
  fingerprints.
- The advisory `assertSemanticEffectIsExecutable` was **removed** so authorization has exactly one
  entry point rather than two overlapping ones.

**Regressions added:** `apps/runtime/tests/autonomy/semantic-execution-authorization.test.ts` (the
exact `git.status` + `touch` probe, twelve smuggling parameter shapes, executable override on reads,
escape-hatch validation, no-trusted-binding fail-closed, patch missing fingerprint / missing or
escaping scope / unprovable currency / stale `CONFLICT`, and binding checks);
`packages/application/tests/sandbox-port.test.ts` (issuance preconditions, forged look-alike);
`packages/infrastructure/tests/sandbox.test.ts` (forged plan, plan replayed against another sandbox
or task); `apps/runtime/tests/autonomy/autonomy-phase1-boundary.test.ts` (end-to-end smuggling
attempt with an assertion that no file appears in the real workspace).

## Finding 2 — the direct-Docker backend bypassed Layer 8 supervision

**Root cause:** a parallel bespoke process authority instead of the existing supervised one.

**Repair:** every docker client invocation runs through `ProcessSupervisor`, so process-group
termination and explicit environment inheritance are the existing Layer 8 behavior. Additionally:

- A pre-aborted `OperationContext.signal` throws `CANCELLED` **before** anything spawns.
- A timeout or cancellation force-removes the named container and then *verifies its absence* with
  `docker ps --all --quiet --filter name=^<name>$`; killing the client alone proves nothing about
  the container.
- A timeout still raises `SandboxIndeterminateEffectError`, which the supervisor surfaces as
  internal `unknown` — never a blind retry.
- Cleanup failure is raised, never suppressed; the previous `.catch(() => undefined)` is gone from
  the verification path.
- `SandboxSupervisor.destroy` calls `backend.destroy` **first** and deletes its entry only on
  success; a failure leaves the sandbox `degraded` and still inspectable. `cancel` degrades the same
  way rather than reporting a clean cancellation it cannot prove.
- Container identity is explicit supervised lifecycle state (a sandbox-id → container-name map).

**Regressions added** (`packages/infrastructure/tests/sandbox.test.ts`, driving a real stub `docker`
child process through the supervisor): pre-aborted signal does not spawn; budget exhaustion triggers
`rm --force` plus the absence check and yields `unknown` + `degraded`; cancellation triggers cleanup;
a container still present after removal surfaces `DEPENDENCY_FAILURE` and keeps the sandbox
degraded; destroy failure preserves reconciliation authority; a plan with no trusted command is
refused rather than invented.

## Finding 3 — Docker configuration could defeat the isolation policy

**Root cause:** settings were accepted unvalidated, and the container workspace target was
caller-supplied.

**Repair:** `assertValidDockerSandboxSettings` runs in the constructor *and* in
`buildDockerRunArguments`, before any probe or execution. It requires
`<repository>@sha256:<64 lowercase hex>` (rejecting floating tags, bare names, wrong digest length,
uppercase hex, and non-sha256 algorithms), a numeric `uid:gid` with neither component 0 (rejecting
`0:0`, `0:n`, `n:0`, `root`, `root:root`, empty), and a non-empty runtime executable.
`containerWorkdir` was **removed from the settings type**: `CONTAINER_WORKDIR = "/workspace"` is a
backend-owned constant, so the workspace can no longer be mounted over `/`.

**Regressions added:** twelve rejected configurations asserted against both
`assertValidDockerSandboxSettings` and the constructor, plus argv assertions that the only bind
mount targets `/workspace` and that `--workdir /workspace` is used.

**Proof corrected:** the target-host test and `scripts/prove-autonomy-phase1-real.mjs` no longer
treat a non-empty `V31M4_SANDBOX_IMAGE` as pinned — the digest syntax is validated, and without a
pinned image the run reports the container assertions as NOT PROVEN. When Docker is available the
proof now asserts the effective UID is non-zero, the effective bind mounts, read-only root, absent
Docker socket, blocked egress, refusal to write outside the workspace, a workspace write observed on
the host filesystem, and verified container removal.

## Finding 4 — repository state falsely advanced the gate

**Repair:** `docs/current-state.md` now records Task 1 as INCOMPLETE with the verification failure,
the four findings, the repair, the still-blocked target-host proof, and **Task 2 as FORBIDDEN**.
This document keeps the original failed evidence above under an explicit superseded heading.

## Preserved verified behavior

Unchanged by the repair: the five durable IDs; exactly nineteen semantic operations with
`git.worktree` absent; `WorkspaceManagerPort` as sole worktree authority; adapter protocol `1.0.0`
byte/behavior compatibility (`adapter-rpc.schemas.ts` and `common.schemas.ts` still unmodified);
additive protocol `1.1.0` with exact-version negotiation and rejection; internal `unknown` kept off
the public v1 tool status; runtime API `1.0.0` untouched; and no dependency, `package.json`, or
lockfile change.

## Repair verification

- Focused Task 1 suites (domain IDs, sandbox port, adapter RPC 1.1, infrastructure sandbox, adapter
  operations, and every `apps/runtime/tests/autonomy` file): **82 passing / 2 skipped / 8 todo
  (92 total) across 9 passing + 1 skipped test files (10 total)**. The 2 skips and the 1 skipped file
  are the opt-in target-host proof.
- `pnpm check`: **exit 0** — lint 366 files, 0 errors (9 pre-existing warnings, 1 pre-existing info),
  typecheck 9/9, **560 passing / 16 skipped / 8 todo (584 total) across 114 passing + 5 skipped test
  files (119 total)**. Against the Task 0 baseline of 490 passing / 14 skipped / 9 todo: **+70
  passing, +2 skipped, −1 todo, zero failures**.
- `pnpm build`: 9/9. `git diff --check`: clean.
- Static/reference proof: `node scripts/prove-autonomy-phase1-real.mjs` — 2 passing, exit 0, with
  the container assertions honestly reported as NOT PROVEN.
- Gate honesty check: `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 node scripts/prove-autonomy-phase1-real.mjs`
  **fails** with "V31M4_SANDBOX_IMAGE is missing or not digest-pinned", exit 1 — the proof cannot be
  claimed PASS while the boundary is unobserved.

## Remaining blocker

The mandatory target-host Docker proof. Docker CLI 29.6.2 is installed but the Docker Desktop Linux
engine is not running and WSL integration is disabled for this distro, and no digest-pinned image has
been chosen. Until a real container runs and every isolation property is observed, **Task 1 is
INCOMPLETE and Task 2 must not begin.** No sandbox backend is promoted; the bake-off may still return
`NO_ACCEPTABLE_BACKEND`.

---

# Independent review round 2 — findings and remediation

**Verifier:** independent Codex re-review of `29f0b55` · **Verdict:** FAIL_IMPLEMENTATION
**Repair starting HEAD:** `29f0b5580f0d3607ad3915515504cede4d06361d`, clean worktree.

Round 1's repair closed the *shape* of the bypass but left the *capability* open. Each round-2
finding was reproduced against `29f0b55` before any fix.

## Reproduction

A probe against `29f0b55` printed:

```text
[probe2 F1] supervisor ACCEPTED a fabricated git.status plan carrying command
            {"executable":"touch","arguments":["/etc/probe"]} -> status=completed
[probe2 F3] same plan replayed -> status=completed
[probe2 F2] stderr-limit kill -> status=failed, sandbox=ready
[probe2 F5] settings with containerWorkdir:"/" accepted -> direct-docker
```

Finding 4 is a proof-completeness gap, confirmed by inspection: the target-host test observed no
HOME/tmpfs behavior and never exercised a real timeout.

## Finding 1 (HIGH) — the public authorization factory recreated the bypass

**Root cause:** `AuthorizedSemanticExecutionPlan.issue` was a public static taking a caller-supplied
`SemanticOperationContract`. `isAuthentic` proved only "constructed by this class", so a fabricated
contract (`operationId: "git.status"`, `allowsCallerSuppliedCommand: true`) minted a plan the
supervisor accepted with an arbitrary command. Structural branding was being used as a security
capability.

**Repair — capability issuance design:**

- The plan constructor is guarded by a module-private symbol; there is no public factory and no
  public `isAuthentic`.
- `createSemanticExecutionAuthority({ generateExecutionPlanId, now })` returns a `mint`/`verify`/
  `consume` triple sharing a **closure-private `WeakSet`**. Nothing outside that closure can add to
  it, so authenticity means "minted by *this* authority" — not class identity, not shape.
- `createSemanticAuthorizationBoundary()` (runtime) creates one authority, keeps `mint` inside its
  closure, and exposes only `authorize(request)` and `capabilities` (`verify` + `consume`).
  `SandboxSupervisor` is configured with that verifier, so a sandbox accepts only capabilities from
  the boundary it is paired with.
- `authorize` reads the contract — effect class, roles, sandbox requirement,
  `allowsCallerSuppliedCommand`, trusted command mapping — from `SEMANTIC_OPERATION_CATALOG`, never
  from the request. `assertEscapeHatchIsExclusive` additionally refuses to honour
  `allowsCallerSuppliedCommand` on anything but `command.run`.

**Regressions:** foreign-authority capability rejected end to end; a fabricated `git.status` +
`touch` contract rejected; non-minted objects (`null`, string, number, look-alike) rejected;
constructor rejects a wrong token and no token; `command.run` is the only catalog entry permitting a
caller command; the boundary test proves a capability from a second boundary is refused.

## Finding 2 (HIGH) — output-limit termination could strand a container

**Root cause:** `runSupervised` tracked only `timedOut`/`cancelled`. `ProcessSupervisor` also kills a
process when `stderrLimitBytes` is exceeded, so that kill was reported as an ordinary non-zero exit
and the sandbox returned to `ready` while the daemon-side container could still be running.

**Repair — process-termination reconciliation:**

- `ProcessSupervisor` gains a `terminationReason` (`output_limit | requested`), set when the
  supervisor itself ends the process. This extends the existing Layer 8 authority; no competing
  supervision was introduced.
- `classifyTermination` maps a run to `exited | timeout | cancelled | output_limit |
  supervisor_signal`, also treating a close-signal with no known reason as a supervisor signal.
- **Any** termination other than `exited` force-removes the named container, verifies its absence,
  and then raises `SandboxIndeterminateEffectError` → internal `unknown` + `degraded`. A cleanup
  failure propagates instead, so the sandbox stays reconcilable. Execution no longer returns a plain
  `cancelled` result for an unconfirmed client death.

**Regressions:** a stub docker floods stderr past the limit; the Layer 8 supervisor kills the
client; `rm --force <name>` and the `ps --all --quiet` absence check are both observed in the stub's
call log; the result is `unknown` and the sandbox `degraded`.

## Finding 3 (MEDIUM) — plan replay and non-atomic patch currency

**Root cause:** capabilities had no identity, no consumption state, and `code.patch` currency was
validated only at issuance, leaving a window for the workspace to change before dispatch.

**Repair — replay protection and atomic currency:**

- Every capability carries `executionPlanId` (injected nonce) and `issuedAt`. `consume` spends it
  once; a replay is `PERMISSION_DENIED`. The supervisor consumes **before** dispatch, so an
  interrupted attempt cannot be retried on the same authority.
- Capabilities may carry a `WorkspaceCurrencyPrecondition` (`path`, `expectedFingerprint`,
  `allowedPathScope`). `assertWorkspaceStillCurrent` runs at the sink immediately before dispatch:
  it rejects a target outside its own scope, re-verifies every declared path is contained in the
  assigned workspace, re-reads the authoritative file, recomputes SHA-256, and raises `CONFLICT` on
  a mismatch. The backend is never reached.
- `code.patch` now requires an explicit `targetPath` that must be inside `pathScope`, so "the
  current file the fingerprint describes" is unambiguous and re-checkable.

**Regressions:** same capability executed twice → rejected; distinct capabilities have distinct ids;
target edited between authorization and dispatch → `CONFLICT` with a backend that records it was
never called; target outside its declared scope → rejected; declared scope escaping the workspace →
rejected; `code.patch` missing/escaping/out-of-scope `targetPath` → rejected.

## Finding 4 (MEDIUM) — the target-host proof was incomplete

**Repair — target-host proof expansion.** When real Docker is available the proof now additionally
observes: `HOME` equals `/home/sandbox`; `TMPDIR` equals `/tmp`; `/proc/self/mounts` shows `/tmp`
and `/home/sandbox` as `tmpfs`; neither scratch mount maps the host workspace directory; both are
writable; and a **real wall-clock timeout** on a bounded `sleep 300` yields `unknown` + `degraded`
with the named container confirmed absent by an `execFileSync` docker query issued **outside** the
code under test. Container removal after a normal run is verified the same independent way. These
join the existing non-zero UID, read-only root, absent socket, blocked egress, refusal to write
outside the workspace, and host-observed workspace write.

## Finding 5 (LOW) — unknown container-workdir inputs were silently accepted

**Repair — strict Docker configuration validation.** `assertValidDockerSandboxSettings` now
allowlists exactly `image`, `dockerExecutable`, `userSpec`, and `maxOutputBytes`; any other key is
rejected. `containerWorkdir` in particular fails loudly rather than being ignored, because a caller
that believes it relocated the workspace target is reasoning about a boundary that no longer exists.
`CONTAINER_WORKDIR = "/workspace"` remains backend-owned.

**Regressions:** `containerWorkdir` `/`, `/tmp/unsafe`, and even `/workspace` rejected, plus
`privileged`, `network`, and `mounts`, against both the validator and the constructor.

## Architecture note

`packages/application/src/ports/sandbox.port.ts` reached 532 lines and the existing source-size
guard failed. The capability machinery moved to
`packages/application/src/ports/semantic-execution-capability.ts` (238 + 306 lines). The two files
reference each other only through erased type-only imports, so there is no runtime cycle. The guard
was not weakened.

## Preserved verified behavior

Unchanged: exactly nineteen semantic operations with `git.worktree` absent; `WorkspaceManagerPort`
as sole worktree authority; adapter protocol `1.0.0` byte/behavior compatibility with
`ADAPTER_PROTOCOL_VERSION = "1.0.0"`; additive `1.1.0` with exact-version negotiation; public
`ToolInvocationResult.status` unchanged; runtime API `1.0.0` unchanged; no dependency, lockfile, or
`allowBuilds` change; Docker client through `ProcessSupervisor`; pre-abort no-spawn; timeout,
cancel, and destroy cleanup; failed destroy retaining degraded state; digest-pinned image
validation; non-zero uid/gid; fixed `/workspace`; `--network none`; read-only root; `--cap-drop
ALL`; `no-new-privileges`; PID/CPU/memory bounds; no Docker socket; ephemeral internal scratch.

## Round-2 verification

- Focused Task 1 suites (domain IDs, sandbox port, adapter RPC 1.1, infrastructure sandbox, adapter
  operations, supervised processes, and every `apps/runtime/tests/autonomy` file): **103 passing /
  2 skipped / 8 todo (113 total) across 10 passing + 1 skipped test files (11 total)**.
- `pnpm check`: **exit 0** — lint 367 files, 0 errors (9 pre-existing warnings, 1 pre-existing
  info), typecheck 9/9, **577 passing / 16 skipped / 8 todo (601 total) across 114 passing + 5
  skipped test files (119 total)**.
- `pnpm build`: 9/9. `git diff --check`: clean.
- Static/reference proof: `node scripts/prove-autonomy-phase1-real.mjs` — 2 passing, exit 0, with
  the container assertions honestly reported as NOT PROVEN.
- Gate honesty check: `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 node scripts/prove-autonomy-phase1-real.mjs`
  exits **1**.

## Remaining blocker (unchanged)

The mandatory target-host Docker proof. No container runtime is reachable and no digest-pinned image
is supplied, so the isolation properties remain unobserved. **Task 1 is INCOMPLETE and Task 2 must
not begin.** No sandbox backend is promoted.

---

# Independent review round 3 — findings and remediation

**Verifier:** independent Codex re-review of `8671024` · **Verdict:** FAIL_IMPLEMENTATION
**Repair starting HEAD:** `8671024ba25a88c49f0ee5be2395e1992ee8ec1a`, clean worktree.

## Reproduction

Probes against `8671024` printed:

```text
[probe3 F1] workspace sealed before execute -> dispatched=true, status=completed
[probe3 F2] docker exit 125 -> status=failed, sandbox=ready
[probe3 F3] stdout bytes emitted with a 1024-byte limit: 16384000, exit=0, reason=undefined
[probe3 symlink] accepted {"sub/link/missing.ts":""}
```

Round 2 bound *authorization* to execution; round 3 found that the **workspace** was still trusted
from an earlier read, that a Docker CLI exit code was being treated as container evidence, that
"bounded output" bounded one stream, and that a path beneath an escaping symlink parent counted as
contained. Finding 4 is a proof-completeness gap, confirmed by inspection.

## Finding 1 (HIGH) — execution did not re-read the authoritative workspace

**Root cause:** `WorkspaceManagerPort.get` was consulted at `prepare`, after which execution
trusted the captured `WorkspaceHandle`. A workspace sealed, discarded, or replaced in between still
reached the backend.

**Repair — authoritative workspace at dispatch.** `SandboxSupervisor.execute` now runs in a fixed
order: verify capability → binding checks → allowed operation → workspace-write gate → **consume
capability** → `beginExecution` (lease + authoritative re-read) → identity check → canonical-root
re-resolve → currency preconditions → dispatch. The workspace must exist, be `active`, keep its id,
and match the prepare-time `projectId`/`purpose`/`rootPath`/`createdAt`; the re-resolved root must
`realpath`-equal the prepared one. A pre-dispatch refusal does **not** mark the sandbox degraded —
nothing ran.

**Repair — lifecycle race.** `WorkspaceExecutionInterlock` decorates the one `WorkspaceManagerPort`
and is installed as *the* workspace manager, so there is no second authority. It keeps two
synchronously maintained sets: sandboxes currently dispatching, and workspaces currently being
sealed or discarded. `beginExecution` registers its lease **before its first `await`**, which makes
"no seal can start after this point" a real guarantee rather than a hopeful one; `seal`/`discard`
register their marker the same way, closing the mirror-image race. Either side losing is a
deterministic `CONFLICT`.

**Regressions:** sealed after prepare → no dispatch; discarded after prepare → no dispatch (`NOT_FOUND`);
authoritative record replaced (same id, new `createdAt`) → no dispatch; resolved root changed → no
dispatch; seal and discard both refused while an effect is mid-dispatch, then succeeding once it
finishes; execution refused while a seal is in flight.

## Patch currency and containment hardening

**Containment.** `containedPath` previously fell back to the lexical path when `realpath` failed,
so a nonexistent target under an escaping symlink parent looked contained — precisely the case a
future patch backend would use to create a file outside the workspace. It now walks to the deepest
existing ancestor, canonicalizes that, and re-appends the remaining segments, catching an escaping
link whether it is the target, its parent, or any ancestor. Ordinary nonexistent paths inside the
workspace still resolve.

**Compare-and-apply boundary.** `SandboxExecutionSpec` carries `applyWorkspaceChange`, the only
sanctioned write: it re-checks the plan's declared fingerprint and performs an atomic temp-write +
rename **inside the same call**, under the supervisor's execution lease. There is no "just write"
entry point. `SandboxBackend.supportsWorkspaceWrite` must be explicitly declared, and the supervisor
refuses a `workspace_write` effect to any backend that has not — so a write path cannot appear by
accident. Task 1 does not implement a patch engine; it fixes the boundary a later one must use.

**Regressions:** nonexistent target, existing file, the link itself, and a deep nested path all
rejected under an escaping symlink parent; ordinary nonexistent in-workspace path still resolves;
write effect refused for a non-write-capable backend; compare-and-apply succeeds while current;
compare-and-apply refuses with `CONFLICT` when the target changes *inside* the backend after the
supervisor's own check, leaving the racing write intact.

## Finding 2 (HIGH) — abnormal Docker client exits bypassed reconciliation

**Root cause:** a clean close with no supervisor reason was classified `exited`, so `docker`'s own
failure exit (125) was reported as an ordinary container-command failure and the sandbox returned
to `ready` without any evidence about the container.

**Repair.** A `SandboxRunOutcome` model distinguishes `completed_successfully`,
`container_command_failed_confirmed`, `docker_client_abnormal_exit`, `timeout`, `cancellation`,
`output_limit`, `supervisor_signal`, and `dependency_spawn_failure`. Exit 0 with a clean termination
is the only unconditional success. Exit 125 or a null exit is never treated as a container result.
Any other non-zero exit is reported as an ordinary failure **only** after `docker ps --all --quiet
--filter name=^…$` proves the container is gone; if it survives, or its state cannot be read, the
outcome is abnormal. Every abnormal outcome force-removes the container, verifies absence, and
surfaces an indeterminate effect (`unknown` + `degraded`); a cleanup failure propagates so the
sandbox stays reconcilable.

**Regressions:** exit 125 → `unknown` + `degraded` + `rm --force`; non-zero exit with proven absence
→ ordinary `failed` with `outcome: container_command_failed_confirmed` and the absence check
recorded; non-zero exit with a surviving container → `DEPENDENCY_FAILURE` + `degraded`.

## Finding 3 (MEDIUM) — only stderr was bounded; `maxOutputBytes` was unvalidated

**Repair.** `ProcessSupervisor` gained `maxCombinedOutputBytes`, counting stdout **and** stderr
against one budget and terminating the process group with `terminationReason = "output_limit"`.
It is opt-in on purpose: attaching a stdout counter puts the stream into flowing mode, which would
change behavior for the JSON-RPC adapter callers that read stdout as a protocol channel. Only byte
counts are retained, never the output, so counting cannot be turned into a memory amplifier. The
sandbox — which owns both streams — opts in. `maxOutputBytes` must now be a number, finite, an
integer, `> 0`, and `<= MAX_ALLOWED_OUTPUT_BYTES` (64 MiB).

**Regressions:** stdout-only overflow, stderr-only overflow, and combined overflow where neither
stream alone exceeds the budget all yield `output_limit`; stdout is untouched when no combined
budget is set; a self-directed exit reports no termination reason while `stop()` reports
`requested`; stdout flood through the Docker backend reconciles the container and leaves the effect
`unknown` + `degraded`; `0`, `-1`, `NaN`, `Infinity`, `1.5`, `"unbounded"`, and `64 MiB + 1` are all
rejected while `1`, `4096`, and exactly 64 MiB are accepted.

## Finding 4 (MEDIUM) — the target-host proof lacked runtime attestation

**Repair.** The proof now reads `/proc/self/status` **inside the real container** and requires
`CapEff == 0000000000000000`, `CapBnd == 0000000000000000`, and `NoNewPrivs == 1`. Docker argv
remains supplemental evidence only. Parsing fails closed: a missing field is a failed observation,
never a silently skipped check. The parser lives in
`apps/runtime/tests/autonomy/runtime-privilege-attestation.ts` and has its own hermetic regression,
so the rules that decide whether a real container passes are themselves tested on a host with no
Docker.

**Regressions:** retained `CapEff` rejected; retained `CapBnd` rejected; `NoNewPrivs != 1` rejected;
each missing field rejected by name; non-integer `NoNewPrivs` rejected; a fully hardened status
accepted.

## Architecture note

The sandbox modules exceeded the 500-line source guard again and were split along real seams rather
than weakening the guard: `workspace-guards.ts` (containment, fingerprints, identity, root, and
compare-and-apply), `reference-sandbox.ts`, `docker-sandbox-configuration.ts` (settings validation
and argv), plus the new `workspace-execution-interlock.ts`. Largest sandbox file is now 361 lines.

## Round-3 verification

- Focused Task 1 suites (domain IDs, sandbox port, adapter RPC 1.1, infrastructure sandbox, adapter
  operations, supervised processes, and every `apps/runtime/tests/autonomy` file): **129 passing /
  2 skipped / 8 todo (139 total) across 11 passing + 1 skipped test files (12 total)**.
- `packages/infrastructure/tests/supervised-processes.test.ts`: **9 passing**.
- `pnpm check`: **exit 0** — lint 373 files, 0 errors (9 pre-existing warnings, 1 pre-existing
  info), typecheck 9/9, **603 passing / 16 skipped / 8 todo (627 total) across 115 passing + 5
  skipped test files (120 total)**.
- `pnpm build`: 9/9. `git diff --check`: clean.
- Static/reference proof: `node scripts/prove-autonomy-phase1-real.mjs` — 2 passing, exit 0, with
  the container assertions honestly reported as NOT PROVEN.
- Gate honesty check: `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 node scripts/prove-autonomy-phase1-real.mjs`
  exits **1**.

## Remaining blocker (unchanged)

The mandatory target-host Docker proof. No container runtime is reachable and no digest-pinned image
is supplied, so UID, read-only root, socket absence, egress, workspace-only write, tmpfs scratch,
real timeout cleanup, and the new capability/no-new-privileges attestation remain unobserved.
**Task 1 is INCOMPLETE and Task 2 must not begin.** No sandbox backend is promoted.

---

# Independent review round 4 — findings and remediation

**Verifier:** independent GitHub source review of `6b2d4ba` · **Repair starting HEAD:**
`6b2d4ba2bfeabbc0f0ca5d1cbdb0c4feb2dcdde4`, clean worktree. Each claim was treated as untrusted and
reproduced before any fix.

## Reproduction

```text
[probe4 F1]  second lease still held, seal permitted anyway: true
[probe4 F1b] two seals ran concurrently: true
[probe4 F2]  host file outside workspace now contains: export const value = 9;
```

F3 was reproduced directly on this host: `touch /v31m4-root-probe` fails with `Permission denied`
while `awk '$5=="/"' /proc/self/mountinfo` reports `rw,relatime`. The failed write proves the
process is unprivileged, not that the filesystem is read-only.

After the repair the same probes report `seal permitted: false`, `concurrent: false`, and the
outside file still holding `ORIGINAL HOST CONTENT`.

## Finding 1 (HIGH) — the workspace interlock was not multiplicity-safe

**Root cause:** leases were tracked as `Map<workspaceId, Set<sandboxId>>`. Two executions from one
sandbox collapsed into a single set entry, so the first `release()` deleted the holder while the
second effect was still running and `seal`/`discard` then proceeded under it. `#mutating` recorded
only a workspace id and never refused a second overlapping mutation.

**Repair.** At most one claim per workspace, of either kind, held in `Map<workspaceId,
WorkspaceClaim>`. Each claim carries a `randomUUID()` identity; a lease's `release()` clears the
workspace **only if that exact claim still holds it**, which makes release idempotent and makes a
stale handle harmless. `#claim` is synchronous and runs before any `await`, so the ordering is a
real guarantee.

**Policy, stated explicitly:** effect dispatch is **exclusive per workspace**. `command.run` and
`code.patch` obviously mutate the workspace, but so can a nominally read-only operation — it still
runs a process against the same writable mount — so no operation is classified as a harmless
concurrent reader. Lifecycle changes are exclusive against effects and against each other. Whoever
loses gets a deterministic `CONFLICT`.

**Regressions:** a second `beginExecution` is refused for the same sandbox id *and* a different
one; a fresh lease after release has a different `leaseId`; a stale lease handle released twice
does not free the live claim, and lifecycle stays blocked until the live lease releases; seal and
discard both refused while a lease is held, then permitted; concurrent seal/seal and seal/discard
serialize with `concurrent === false`; discard in flight refuses both a seal and a new execution.

## Finding 2 (HIGH) — compare-and-apply could be captured by a pre-placed temporary symlink

**Root cause:** the replacement path was `${contained}.v31m4-apply` — entirely predictable.
`writeFile` follows a symlink, so an attacker able to pre-create that path pointed the "safe"
temporary write at any file the runtime could reach. The probe overwrote a file in a separate
temporary directory outside the workspace, before the rename ever happened.

**Repair.** The replacement is created in the already-validated **canonical parent** (itself
re-checked for containment) with an unguessable name (`.v31m4-apply-<16 random bytes>`) via
`open(path, "wx", 0o600)` — `O_CREAT|O_EXCL`, which fails outright on an existing path, symlink or
not, instead of following it. Content is written through that descriptor. The expected fingerprint
is checked before the write *and again immediately before the rename*, so nothing may move the
target while the new content is being written. Every failure path closes the descriptor and unlinks
the temporary. Collision retries a fresh name, then fails safely.

**Regressions:** a pre-placed temp symlink leaves the outside file byte-identical while the real
target is replaced and no stray temporary remains; a successful apply is atomic and leaves no
temporary; a stale expectation yields `CONFLICT`, leaves the target untouched, and cleans up; a
symlinked target, an escaping symlink parent, and a nonexistent path beneath one are all
`PERMISSION_DENIED` with the outside file unchanged; a target outside its own declared scope is
refused.

## Finding 3 (MEDIUM) — the read-only-root proof was a false positive

**Repair.** `parseRootFilesystemMountState` parses `/proc/self/mountinfo`, takes the **last** record
for `/` (a later mount shadows an earlier one), and reports the mount's own options;
`assertReadOnlyRootFilesystem` requires `ro`. The target-host proof now reads the container's mount
table and asserts that, keeping the failed `touch /` as supplemental evidence only. Malformed
records and a missing root record are failures, not skipped checks.

**Egress hardening.** The proof previously treated any failure of `getent hosts example.com` as
proof of a blocked network — a missing utility fails identically. It now first asserts
`command -v getent` succeeds, so the probe mechanism is proven present before its failure is used
as evidence.

**Regressions (hermetic, no Docker required):** `ro` root accepted; `rw` root rejected even though a
non-root write would still fail; missing root record rejected; empty input rejected; malformed
record rejected; shadowing verified in both directions.

## Round-4 verification

- Focused Task 1 suites: **144 passing / 2 skipped / 8 todo (154 total) across 11 passing + 1
  skipped test files (12 total)**.
- `packages/infrastructure/tests/supervised-processes.test.ts`: **9 passing**.
- `pnpm check`: **exit 0** — lint 373 files, 0 errors (9 pre-existing warnings, 1 pre-existing
  info), typecheck 9/9, **618 passing / 16 skipped / 8 todo (642 total) across 115 passing + 5
  skipped test files (120 total)**.
- `pnpm build`: 9/9. `git diff --check`: clean.
- Static/reference proof: 2 passing, exit 0, container assertions honestly NOT PROVEN.
- `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1` exits **1**.
- No dependency, lockfile, `allowBuilds`, adapter-protocol-1.0, or runtime-API-1.0 change.

## Remaining blocker (unchanged)

The mandatory target-host Docker proof. No container runtime is reachable and no digest-pinned image
is supplied, so every isolation property — UID, read-only root mount, socket absence, egress, tmpfs
scratch, workspace-only write, capability attestation, and real timeout cleanup — remains
unobserved. **Task 1 is INCOMPLETE and Task 2 must not begin.** No sandbox backend is promoted.

---

# Independent review round 5 — finding and remediation

**Verifier:** independent re-review of `3bd7b8a` · **Repair starting HEAD:**
`3bd7b8a678d23a78e147e5e0c7b0ecd9afaaa04e`, clean worktree.

## Finding (MEDIUM) — the network proof only proved DNS failure

Round 4 hardened the egress probe to confirm `getent` exists before using its failure as evidence.
That closed "missing utility looks like blocked network" but not the deeper problem: a broken name
lookup is not absence of egress.

**Reproduction, on this fully networked host:**

```text
$ getent hosts example.invalid ; echo $?
2                                  # the round-4 assertion (status === "failed") is satisfied

$ for i in /sys/class/net/*; do echo "${i##*/}"; done
eth0
eth1
lo
loopback0

$ cat /proc/net/route
Iface   Destination  Gateway   Flags ... Mask
eth0    00000000     0100000A  0003  ... 00000000     # default route
eth0    0000000A     00000000  0001  ... 00FFFFFF

$ timeout 8 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'
TCP connect to 1.1.1.1:443 SUCCEEDED
```

So the proof would have printed "network egress: blocked" on a machine with three non-loopback
interfaces, a default route, and working outbound TCP. That is a false PASS of the Task 1 network
isolation requirement.

## Repair — observe the isolation, do not infer it

`--network none` establishes a network namespace containing only loopback with no route off it, and
that state is kernel-visible. `apps/runtime/tests/autonomy/runtime-network-attestation.ts` adds:

- `parseNetworkInterfaces` / `assertOnlyLoopbackInterfaces` — the effective interface set must be
  exactly `{ lo }`. An empty listing or an unexpanded glob is a failed observation, not "no
  interfaces".
- `parseRoutingTable` / `assertNoExternalRoutes` — `/proc/net/route` must contain no default route
  (destination and mask both `00000000`) and no route at all on a non-loopback interface. A missing
  header means the table was never read; a short record is malformed. Both fail.

The target-host proof now reads the interface set with shell globbing (`for i in /sys/class/net/*`)
rather than `ls`, so the observation does not depend on which userspace tools the image ships, and
reads `/proc/net/route` directly. The live connection attempt is **supplemental**: it uses a numeric
IP so it needs no DNS, runs only when a suitable tool is present, and is skipped with an honest
report otherwise — correctness never depends on an optional utility being installed. If the tool is
present the connection must fail, because success would contradict the kernel observations.

The proof no longer emits any egress claim unless those observations pass. `getent` is no longer
required by the proof at all.

## Regressions (hermetic, no Docker required)

Interfaces: only `lo` accepted (including duplicate/whitespace-padded input); `eth0`+`lo`,
`lo`+`docker0`, `tun0`, and the exact four-interface set observed on this host all rejected; empty
input, whitespace-only input, and an unexpanded glob rejected as unread observations.

Routes: header-only table accepted with zero routes; the real connected fixture rejected with its
default route correctly identified on `eth0`; a non-default route off a non-loopback interface
rejected; a default route rejected even when it sits on loopback; empty input, a table with no
header, and a short record all rejected.

## Round-5 verification

- Focused Task 1 suites: **152 passing / 2 skipped / 8 todo (162 total) across 12 passing + 1
  skipped test files (13 total)**.
- `packages/infrastructure/tests/supervised-processes.test.ts`: **9 passing**.
- `pnpm check`: **exit 0** — lint 375 files, 0 errors (9 pre-existing warnings, 1 pre-existing
  info), typecheck 9/9, **626 passing / 16 skipped / 8 todo (650 total) across 116 passing + 5
  skipped test files (121 total)**.
- `pnpm build`: 9/9. `git diff --check`: clean.
- Static/reference proof: 2 passing, exit 0, container assertions honestly NOT PROVEN.
- `V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1` exits **1**.
- Rounds 1–4 preserved; no dependency, lockfile, `allowBuilds`, adapter-protocol-1.0, or
  runtime-API-1.0 change.

One lint suppression was added with its reason: the shell parameter expansion `${i##*/}` sent to the
container trips `noTemplateCurlyInString`, which reads it as a mistaken JS template placeholder.
Warning count is unchanged from the frozen baseline.

## Remaining blocker (unchanged)

The mandatory target-host Docker proof. No container runtime is reachable and no digest-pinned image
is supplied, so every isolation property — including the new interface and routing-table
observations — remains unobserved. **Task 1 is INCOMPLETE and Task 2 must not begin.** No sandbox
backend is promoted.

---

# Final implementation repair — policy/resource authority, Docker ownership, degraded state, and proof completeness

**Repair starting HEAD:** `bf5ef96b059e26d0176fbf6cf81a37d96d169731`. The repair was resumed
from its preserved interrupted worktree; no reset, restore, stash, or restart from the base was
performed. The last interrupted edit was audited first: it retained the exact task/job/workspace/
sandbox predicates and added `sandbox.status === "ready"`; identity validation had not been
replaced by status validation.

## Before-fix reproductions

The five independent findings were reproduced before repair:

- Policy/parser/degraded/collision probe:
  `pnpm exec vitest run apps/runtime/tests/autonomy/semantic-policy-authority.test.ts packages/infrastructure/tests/sandbox.test.ts apps/runtime/tests/autonomy/runtime-network-attestation.test.ts apps/runtime/tests/autonomy/runtime-privilege-attestation.test.ts`
  failed **10 / 80** tests. A real policy deny was ignored in favor of caller
  `policyDecision: "allow"`; canonical risk/evidence/resource data and grant expiry were absent;
  a degraded sandbox redispatched and cancel restored it to ready; `sandbox:a-b` and `sandbox:a:b`
  collided; malformed route, `NoNewPrivs: 1.0`, capability hex, and mountinfo were accepted.
- Ownership probes:
  `pnpm exec vitest run packages/infrastructure/tests/sandbox.test.ts -t 'foreign|collision-resistant'`
  failed **2 / 2 selected** tests: punctuation-colliding IDs shared a name and foreign same-name
  cleanup was not refused.
- Effective-inspection probe:
  `pnpm exec vitest run packages/infrastructure/tests/docker-sandbox-inspection.test.ts` failed at
  collection because the live Docker inspection module did not exist.

## Repairs

1. The runtime-owned authorizer snapshots the request before its first `await`, derives policy
   attributes and execution solely from the canonical catalog, and calls `PolicyEnginePort`.
   Caller policy/risk/effect/resource/scope keys are rejected. Deny and `require_approval` cannot
   mint; the latter returns `APPROVAL_REQUIRED` for the existing governed approval flow. An allow
   seals `policyId` and optional expiry plus catalog risk, evidence-precondition identifier, and
   resource ceilings into the issuer-bound capability. Expiry is inclusive and rechecked by both
   verify and consume. The evidence-precondition identifier is metadata only in Task 1; no Task-6
   evidence engine was introduced.
2. Direct Docker uses the stricter of catalog/sandbox wall-clock and output limits. The existing
   `WorkspaceExecutionInterlock` permits at most one effect per workspace, which is no weaker than
   catalog `maxConcurrent` values 1 or 4. Workspace roots are canonical before becoming mount
   authority.
3. Container names are SHA-256-derived from the full `SandboxId`; duplicate live SandboxIds are a
   conflict, including while asynchronous preparation is still in flight. Run argv adds exact
   sandbox/task/job/workspace labels. Every destructive cleanup first
   performs supervised Docker inspection, checks the deterministic name and all ownership labels,
   removes only the observed full container ID, and independently verifies ID absence. Missing,
   ambiguous, or foreign ownership leaves authoritative degraded state intact.
4. `SandboxSupervisor.execute` accepts ordinary work only from authoritative `ready`. Cleanup of a
   degraded sandbox cannot prove prior effect nonapplication and therefore cannot restore ready.
   Execution claims `running` synchronously before its first asynchronous validation; cancel and
   destroy use a mutually exclusive lifecycle claim, cannot race a pending dispatch, and delete
   only their exact authoritative entry.
5. `/proc/net/route`, `/proc/self/status`, and `/proc/self/mountinfo` parsing is strict and
   fail-closed. The target-host proof now complements kernel observations with supervised live
   Docker inspection of exact ownership, non-root user, read-only root, network none, dropped
   capabilities, no-new-privileges, canonical workspace bind, approved tmpfs, and absence of any
   extra bind, volume, or Docker socket.

During the interrupted-patch audit two integration gaps were corrected before final verification:
behavioral regressions were added for catalog resource ceilings, and the live inspection path was
changed from re-serializing an already parsed observation to validating it directly. Additional
adversarial review found and fixed request mutation across asynchronous policy evaluation,
duplicate SandboxId overwrite, non-canonical mount authority, and an empty-first duplicate
privilege field.

A fresh independent post-repair source review found two additional sink-timing gaps and both were
reproduced before correction. First, a policy grant valid at consumption could expire during
asynchronous workspace validation and still dispatch; the sink now repeats issuer/expiry
verification at the final synchronous edge immediately before `backend.execute`, while retaining
consume-before-effect single use. Second, cancel/destroy could overlap that same pre-dispatch
window and erase or clean lifecycle state before the effect launched; the synchronous execution
and lifecycle claims above now make the overlap a deterministic `CONFLICT`. The proof harness's
independent Docker absence query was also moved from a direct child-process invocation to the
existing `ProcessSupervisor`, without making the query dependent on the Docker backend under test.

## Permanent regressions and verification

- Policy: naked allow rejected, real allow accepted, deny rejected, approval-required blocked for
  governed approval, expiry rejected at issuance and at the final post-await dispatch edge, exact
  request snapshot bound, caller authority-key downgrade rejected, immutable catalog
  risk/evidence/resource data preserved.
- Resources: semantic wall-clock/output ceilings cannot be weakened by looser sandbox/backend
  settings; per-workspace interlock remains stricter than catalog concurrency limits.
- Docker identity/lifecycle: punctuation collision, duplicate SandboxId, foreign labels, no foreign
  removal, concurrent duplicate preparation, execution-vs-cancel/destroy exclusion, cleanup by
  inspected ID, timeout/cancel/output-flood reconciliation, cleanup survival, and supervised live
  inspection.
- State/parsers/proof: degraded redispatch and cancel restoration refused; malformed route/status/
  mountinfo rejected; extra bind, volume, wrong workspace source, wrong ownership, relaxed network/
  read-only state, Docker socket, and malformed inspect JSON rejected.

Exact verification on the repaired working tree:

- Focused Task 1: **177 passing / 2 skipped / 8 todo (187 total)** across **14 passing + 1 skipped
  files (15 total)**.
- `packages/infrastructure/tests/supervised-processes.test.ts`: **9 passing** outside the command
  sandbox. (Inside that wrapper, process-group signals are denied; the identical suite passes on
  the real host execution boundary.)
- Non-mandatory proof harness: **2 passing**; reference/static behavior passed and Docker isolation
  was explicitly **NOT PROVEN** because no digest-pinned image was supplied. Mandatory Docker mode
  was not run.
- `pnpm check`: exit 0 — lint **378 files**, 0 errors, 9 pre-existing warnings, 1 pre-existing info;
  typecheck **9/9**; tests **651 passing / 16 skipped / 8 todo (675 total)** across **118 passing + 5
  skipped files (123 total)**.
- `pnpm build`: **9/9 successful**. `git diff --check`: clean.
- Exactly 19 semantic operations; no model-facing `git.worktree`; no dependency, lockfile,
  `allowBuilds`, adapter-protocol-1.0, public runtime-API-1.0, or public v1 tool-status change; no
  Task-2 implementation.

## Remaining hard-gate blocker (unchanged)

The mandatory target-host Docker proof has deliberately not been run in this implementation repair.
The final read-only prerequisite inspection found a Windows Docker CLI shim on `PATH`, WSL2, no
`/var/run/docker.sock`, no `V31M4_SANDBOX_IMAGE`, and `docker version` reporting that Docker is
unavailable until Docker Desktop WSL integration is enabled. This inspection created no container
and is not sandbox proof.
Until it independently observes a real digest-pinned container satisfying every isolation and
cleanup assertion, **Task 1 remains INCOMPLETE, Task 2 remains forbidden, and no sandbox backend is
promoted**.
