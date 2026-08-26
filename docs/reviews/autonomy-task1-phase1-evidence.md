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
