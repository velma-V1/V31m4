# V31M4 Current State

This file is a concise operational handoff for future Claude Code sessions. It records verified repository state and should be updated whenever branch, implementation, verification, blockers, or remaining work materially changes.

## Repository state

- Branch: `canonical/layers-6-10`
- Handoff baseline commit before this file was added: `2fe85cd708c6dffd4d05872f3a85926648e6a676`
- Live HEAD: verify from git at every session start; do not trust a stored SHA as current after subsequent commits.
- Architecture baseline: `V31M4-SRS-001 / 1.0.0`
- Hardened ancestor: `5746e5f2571a08dea3cce0493adeac92ae025135`
- Canonical continuation is based on the hardened Layer 5 line. Older Layer 6 implementations are reference material only.

## Verified implemented state

- Layers 1-5: hardened baseline complete before this canonical continuation.
- Layer 6: 21 application use-case orchestration entrypoints are present under `packages/application/src/use-cases`.
- Layer 7: SQLite persistence, transactional outbox/idempotency, content-addressed artifacts, and verified backup/restore are present under `packages/infrastructure`.
- Layer 8: repository evidence records process supervision, JSON-RPC framing/correlation, adapter registration, restart-budget protection, bounded scheduling, resource monitoring, secret leases, and redacted logging.
- Layer 9: governed production gateways — real-path containment (`PathPolicy`), a fail-closed rule-based policy engine, a durable plugin registry, and supervised provider-neutral model/tool/kernel gateways under `packages/infrastructure/src/{paths,policy,plugins,gateways}`.
- Layer 10: authoritative runtime under `apps/runtime` — a `node:http` surface with local session authentication, typed command/query/event routes, an idempotent external-command executor, the durable committed-event replay store (`packages/infrastructure/src/events/event-replay-store.ts`), a resumable event-stream coordinator (replay-before-live boundary, internal-gap and retention `refresh_required` refusal, bounded slow-consumer disconnect with a resumable cursor), startup recovery over the durable log, and checkpoint-safe shutdown.

## Important repository evidence already inspected

- `repo_map.md` reports Layer 6 use cases and Layer 7 infrastructure with a full Layer 1-8 regression of 286 passing cases across 60 test files.
- `docs/repository-map.md` records ownership for the Layer 6 application-use-case surface and Layer 7 persistence/artifact infrastructure.
- `docs/reviews/layers-1-8-improvement-ledger.md` records Layer 8 process/adapter infrastructure and its failure-path coverage.

Reconciled on 2026-08-08: `repo_map.md` labelled the current layer as Layer 8 and recorded Layer 7 persistence plus Layer 8 process/adapter infrastructure with the regression numbers noted then. Superseded on 2026-08-09: the L1–10 core is complete and `repo_map.md` now labels the current layer as Authoritative Runtime Layer 10; the current verified evidence is in the "Known verification evidence" section below (340 tests / 71 files).

## Known verification evidence

Latest repository-map evidence inspected during handoff setup reports:

Re-run and verified on 2026-08-09 after completing the Layer 10 authoritative runtime:

- Full Layer 1-10 regression: 340 passing cases across 71 test files.
- Layer 10 authoritative-runtime + audit regression: external-command idempotency, durable event replay, event-stream coordinator, config validation, live HTTP surface (SSE replay, cross-restart recovery, SSE-disconnect cleanup), integrated hardening, plus the production-readiness audit fixes (idempotency-store write-failure propagation, empty-secret redaction).
- `pnpm typecheck`: 5/5 packages pass (domain, contracts, application, infrastructure, runtime).
- `pnpm build`: 5/5 packages pass (`tsc --noEmit`).
- `pnpm lint` and `pnpm check`: green (0 errors, 1 info).

Do not treat these results as proof for later changes. Re-run the appropriate focused and full gates after modifying code.

## Resolved architectural direction

- Current canonical contracts/interfaces are authoritative over superseded/reference branches.
- Old Layer 6 may be used for behavioral comparison only.
- Do not rename current APIs or create compatibility shims merely to imitate old names.
- Application use cases orchestrate through existing domain/services/ports and preserve transaction/external-call boundaries.
- World/runtime/API concerns belong to their owning later layers rather than being forced into earlier core layers.

## Production departments (current state)

The departments are implemented and verified as removable first-party departments on the generic
host SDK; they are **not** deferred. What remains is the real production-adapter implementation and
execution for external tools (see `real_external_adapters` below and
`docs/reviews/target-host-validation.md`).

```text
CORE := {
  status: FROZEN_L1_L10,
  baseline: 78dc2b7,
  dependency_on_video: false,
  dependency_on_game_3d: false,
  MUST preserve_extension_points(DEPARTMENT_HOST)
}

DEPARTMENT_HOST := {
  status: IMPLEMENTED,           // packages/department-host
  role: GENERIC_REMOVABLE_DEPARTMENT_PLATFORM
}

VIDEO := {
  status: IMPLEMENTED,           // plugins/video-production, verified + removable
  role: REMOVABLE_FIRST_PARTY_DEPARTMENT,
  core_dependency: false,
  host_dependency: true,
  real_external_adapters: {
    AssemblyAdapter: REAL_FFMPEG_VALIDATED,        // FfmpegAssemblyAdapter, see target-host-validation.md
    VisionQcAdapter: REAL_FFMPEG_OLLAMA_VALIDATED, // OllamaVisionQcAdapter (qwen3.5:9b), see target-host-validation.md
    ShotGenerationAdapter: TARGET_HOST_VALIDATION_PENDING   // ComfyUI/gen model — not installed here;
                                                             // no installed Ollama model does video/image
                                                             // generation
  },
  open_generative_ai_core_dependency: false
}

GAME_3D := {
  status: IMPLEMENTED,           // plugins/game-production, verified + removable
  role: REMOVABLE_FIRST_PARTY_DEPARTMENT,
  core_dependency: false,
  host_dependency: true,
  execution_platform_decision: SUMMER,   // 2026-08-09, architecture only, no code changed —
                                          // see docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md
  real_external_adapters: TARGET_HOST_VALIDATION_PENDING    // SummerAdapter (Godot via Summer's MCP/CLI);
                                                              // direct Blender/Unreal adapters out of scope for now
}
```

Distinction: the departments themselves are implemented and verified using deterministic reference
adapters (orchestration, caching, checkpoint/resume, output verification, and removability all
pass). Two of Video's real production adapters are now implemented and target-host-validated
(ffmpeg `AssemblyAdapter`, ffmpeg+Ollama `VisionQcAdapter`). Still incomplete: Video's
`ShotGenerationAdapter` (ComfyUI/generation model) and all of Game/3D's real adapters (Summer,
reaching Godot via its own MCP/CLI, per
`docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`) — none of these
tools are installed here. This remains target-host validation, not department work. Do not
describe the departments as deferred. Open Generative AI is not a core dependency; it may be
evaluated only for optional reusable parts within the Video department.

## Areas already mapped

Unless new evidence, compile/test failures, changed interfaces, or contradictions require reinspection, avoid broad rediscovery of:

- Layer 1-5 hardened architecture and contracts.
- Layer 6 application port surface and use-case ownership.
- Layer 7 persistence/artifact ownership.
- Existing architecture/source-of-truth documents already referenced by `AGENTS.md`.

Use targeted search/read for the exact interface or invariant needed by the current task.

## Resolved blocker (2026-08-08)

At `6c24c9e` the infrastructure package did not build: `packages/infrastructure/src/index.ts`
exported `./artifacts/content-addressed-artifact-store.js`, but that source file had never
been committed (only its test and the barrel export existed), so infrastructure typecheck
failed and 7 of 9 infra test files failed on the broken barrel import. The store was
implemented from the existing `content-addressed-artifacts` test and the `ArtifactStorePort`
contract (streamed SHA-256 hashing, atomic hash-addressed blob write, content dedup,
expected-hash verification before persistence, transactional metadata with rollback blob
cleanup). Infrastructure and the full Layer 1-8 gate are now green (numbers above).

## Current task / next action

1. Layer 9 governed production gateways: DONE and verified green — `PathPolicy` real-path
   containment, fail-closed `RuleBasedPolicyEngine`, `SqlitePluginRegistry`, and supervised
   `SupervisedModel/Tool/ProductionKernel` gateways under
   `packages/infrastructure/src/{paths,policy,plugins,gateways}`.
2. Layer 10 authoritative runtime (Task 5 in
   `docs/superpowers/plans/2026-08-07-layers-6-10-canonical.md`): DONE and verified green
   (2026-08-09) under `apps/runtime`. Composition root, strict validated config,
   authenticated local sessions, typed command/query/event routes, error mapping,
   idempotent external-command executor, durable committed-event replay store + resumable
   event-stream coordinator, startup recovery, and checkpoint-safe shutdown. Full gate:
   typecheck 5/5, 340 tests / 71 files, build 5/5, lint/check clean. Transport decision: the
   event stream is served over SSE (Last-Event-ID ↔ `afterSequence`) on `node:http` rather
   than a hand-rolled WebSocket framing layer — the zero-runtime-dependency, correctness-
   maximizing binding for a loopback local-first runtime; the coordinator is transport-
   agnostic so a WebSocket binding can be added later without touching replay semantics.
3. Task 6 integrated Layers 1–10 hardening: DONE (2026-08-09). Adversarial regressions on the
   new L10 surface (hostile input, concurrent idempotent/conflicting writers, transactional
   rollback) plus a clean-room dependency/architecture review; no defects confirmed. Ledger:
   `docs/reviews/integrated-hardening-ledger.md`.
4. Task 7 clean-checkout verification: DONE (2026-08-09). Detached worktree at the final SHA,
   `pnpm install --frozen-lockfile`, full gate reproduced green (typecheck 5/5, build 5/5,
   lint/check clean, largest source 468 lines, 0 explicit `any`).
   Evidence: `docs/reviews/clean-checkout-verification.md`.
5. Production-readiness audit: DONE (2026-08-09). One HIGH (idempotency-store swallowed
   non-duplicate write failures) and three MEDIUM/LOW fixes (health metric truthfulness/perf,
   SSE mid-backpressure disconnect leak, empty-secret log redaction), each with a regression;
   remaining surfaces audited sound. Report: `docs/reviews/production-readiness-audit.md`.
6. Canonical promotion: COMPLETE (2026-08-09). `canonical/layers-6-10` was fast-forwarded from
   `6c24c9e` to the frozen audited **code** baseline `78dc2b7` (clean fast-forward, 0 divergent
   commits, no force). `78dc2b7` is immutable: it pins the audited L1–10 product-code tree. Since
   then, `canonical/layers-6-10` and the source branch `claude/v31m4-layers-validation-impl-dmlccn`
   must remain aligned, and later commits have added documentation/control-state and **additive
   post-core packages**; the **frozen L1–10 core source tree is unchanged** — no commit modifies the
   audited product-code baseline. Do not copy a live HEAD SHA from this document — always verify the
   current HEAD from git at session start.
7. Post-core program (2026-08-09) — see `docs/reviews/post-core-program-status.md`:
   - **Main promotion: COMPLETE.** `main` fast-forwarded `fbbebdd → 9801338` (clean FF, 38 commits,
     no force); `main` == `canonical/layers-6-10` == source branch. Since `78dc2b7` the frozen L1–10
     core source is unchanged; later commits added documentation/control-state plus the additive
     post-core packages (`packages/department-host`, `plugins/video-production`,
     `plugins/game-production`, `apps/departments-integration`) and the corresponding
     `pnpm-lock.yaml` update. Invariant: FROZEN_CORE_TREE = unchanged; POST_CORE_CODE = additive.
   - **Stable core tag: local only, remote push BLOCKED.** Annotated `v31m4-core-l1-10-stable` created
     locally at `9801338`; `git push` of the tag ref returns HTTP 403 (egress/org policy allows
     branch pushes, denies tag-ref pushes), and no GitHub MCP tag/release/ref tool exists. Needs an
     admin to allow tag pushes or a human to create the tag/release at `9801338`.
   - **Core freeze: IN EFFECT.** L1–L10 frozen; the post-core work added new packages only and
     changed no core source (verified: core imports nothing from the host/departments).
   - **Department host SDK: COMPLETE.** `packages/department-host` — generic removable-department
     lifecycle (install→enable→start→invoke/health→stop→disable→remove) on the existing
     `PluginRegistryPort` + unit of work, with swappable isolation connector, workspace rollback, and
     fail-closed manifest/version/permission/dependency checks. 12 tests.
   - **Video Production department: COMPLETE.** `plugins/video-production` — removable; per-shot
     generate→vision-QC→bounded-correction→assemble with output verification, checkpoint/resume, and
     project/cache storage separation; production tools (ffmpeg/Blender/ComfyUI/generation-vision
     models) behind replaceable adapters with deterministic reference adapters. 7 tests.
   - **3D/Game Production department: COMPLETE.** `plugins/game-production` — removable, independent of
     Video; per-scene acquire→build→validate→bounded-repair→package with verification and
     checkpoint/resume; engines (Godot/Unreal/Blender) behind replaceable adapters. 8 tests.
   - **Independence matrix: VERIFIED.** `apps/departments-integration` — core-only, both departments
     together, cross-removal independence, and host operable after both removed. Dependency direction
     verified (no core→department imports; no video↔game import; departments' src import only
     application + department-host). Full gate (re-run 2026-08-09): typecheck 9/9, 375 tests / 10
     skipped across 83 test files, build 9/9, lint/check clean.
   - **Dependency-boundary tests added (2026-08-09).** `domain`, `contracts`, `department-host`,
     `plugins/video-production`, `plugins/game-production`, and `apps/runtime` each gained a static
     import-boundary test (matching the pre-existing pattern in `application`/`infrastructure`),
     machine-verifying the allowed-import sets in `docs/dependency-rules.md` instead of relying on
     documentation/code-review alone. `packages/domain` gained `@types/node` as a **test-only**
     devDependency (matching `packages/contracts`' existing precedent) purely so its test file can
     use `node:fs`/`node:path`; domain's own new test asserts its `src` still imports nothing
     non-relative, so this does not weaken domain's runtime isolation.
   - **Outbox retention: intentionally deferred** pending workload evidence.
   - **Target-host validation: IN PROGRESS** on the actual local target machine (WSL2 on Windows 11,
     RTX 4070 SUPER 12GB). Capability matrix, honesty rule, and per-adapter evidence:
     `docs/reviews/target-host-validation.md`.
     - **DONE (2026-08-09):** Video `AssemblyAdapter` real implementation —
       `FfmpegAssemblyAdapter` (`plugins/video-production/src/ffmpeg-assembly-adapter.ts`), backed by
       the real Windows `ffmpeg.exe` invoked from WSL (no shell string construction, argument-array
       spawn, no `@v31m4/infrastructure` runtime dependency added — department dependency direction
       preserved). Real-tool tests gated behind `V31M4_TARGET_HOST=1`
       (`plugins/video-production/tests/ffmpeg-assembly-adapter.target-host.test.ts`, 5 tests: real
       concat + checksum/hash verification, missing-file/corrupt-file/bad-executable failure paths,
       pre-aborted cancellation), skip cleanly without the flag. `ReferenceAssemblyAdapter` unchanged.
       Video package gate: typecheck clean, lint clean (0 errors), 12/12 tests pass with
       `V31M4_TARGET_HOST=1`, 7/12 (5 skipped) without it.
     - **DONE (2026-08-09):** Video `VisionQcAdapter` real implementation —
       `OllamaVisionQcAdapter` (`plugins/video-production/src/ollama-vision-qc-adapter.ts`), backed
       by real ffmpeg frame extraction plus a real inference call to the installed vision-capable
       Ollama model `qwen3.5:9b` (GPU-loaded, RTX 4070 SUPER 12GB; no download performed — model was
       already installed). Fails closed on missing/undecodable shot media, unreachable Ollama
       server, and malformed/unparseable model response (never a silent pass). Root-cause fix
       applied and evidenced: `qwen3.5:9b` is a reasoning model, and Ollama's `format:"json"`
       constrains its hidden reasoning tokens too, so it returned an empty response until `think:
       false` was added. Real-tool tests gated behind `V31M4_TARGET_HOST=1`
       (`plugins/video-production/tests/ollama-vision-qc-adapter.target-host.test.ts`, 5 tests:
       exactly one real model-inference call plus 4 fast failure/cancellation paths), skip cleanly
       without the flag or when the model/server aren't available. Shared process-supervision logic
       extracted to `plugins/video-production/src/internal/run-external-process.ts` and reused by
       both real adapters (no duplicate cancellation/timeout/stderr-capture logic).
       Video package gate: typecheck clean, lint clean (0 errors), 17/17 tests pass with
       `V31M4_TARGET_HOST=1`; without the flag, the 10 real-tool tests (across both real adapters)
       skip cleanly and 7 reference-adapter tests still pass.
     - **PENDING:** Blender, Godot, Unreal, Summer, ComfyUI are not installed on this machine
       (checked Program Files, Start Menu, winget, registry App Paths — none found); installing
       them is a material user choice (large downloads/licensing) and was not done automatically.
       No real `ShotGenerationAdapter` exists yet — no installed Ollama model does video/image
       generation (they are text/vision LLMs), and ComfyUI/a generation model would need to be
       installed.
     - **Game department execution-platform decision (2026-08-09):** Summer is the primary
       execution platform for the Game department's real adapters, reaching Godot through Summer's
       own MCP/CLI, behind the *existing* `AssetAdapter`/`SceneBuildAdapter`/
       `SceneValidationAdapter`/`PackageAdapter` ports — no new port surface, no code changed. A
       direct Blender/Unreal adapter and any custom Godot agent bridge are explicitly out of scope
       until the Summer path is real and validated. Architecture only; no `SummerAdapter` is
       implemented. See
       `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`.
   - **System-assembly program started (2026-08-09):** turning the verified backend into a
     runnable, operable system, not just a passing test suite. Status: `pnpm dev` boots the
     runtime for real (`scripts/dev.mjs`); one real business command (`project.create`) is wired
     end-to-end through the runtime's command dispatcher; a minimal real operator UI exists. See
     "System build (2026-08-09 onward)" below for exactly what's done and what remains — do not
     re-derive this from the git log; the section below is the authoritative summary.

## System build (2026-08-09 onward)

Turning the verified L1–10 core + post-core departments into a runnable, operable system. Three
commits so far, each independently verified (full gate green) and pushed:

1. **`pnpm dev` is a real, verified boot path.** `scripts/dev.mjs` creates `runtime-data/`
   (already gitignored — anticipated), generates/persists a local dev session token there, and
   runs `apps/runtime/src/main.ts` via `tsx` (no build step). Verified with real process
   execution: fresh boot, `GET /health`, authenticated command dispatch, clean SIGINT shutdown,
   and restart recovery (same token/database reused; durable log head and a pre-restart record
   both survived). `tsx` needed esbuild's native postinstall, allowlisted in
   `pnpm-workspace.yaml` (`allowBuilds.esbuild: true`, dev-only).
2. **`project.create` is the runtime's first real Layer 6 use-case command** — see
   `apps/runtime/src/use-case-infrastructure.ts` and `composition-root.ts`. Until this, the
   command dispatcher (`RuntimeService`) had exactly one handler, `record.put` (a generic KV
   write proving the mechanism only) — none of the 21 use cases were reachable over HTTP. Closing
   this gap required realizing `packages/infrastructure` implements only generic Layer 7
   primitives (`SqliteRecordStore`, `SqliteOutbox`, ...), not concrete adapters for the
   domain-specific Layer 4 ports (`ProjectRepositoryPort`, `ApprovalStorePort`, `AuditStorePort`,
   `ClockPort`) — composing those was left to whichever composition root wires a real use case,
   exactly `apps/runtime`'s job. Also required a `passthroughUnitOfWork` adapter: Layer 6 use
   cases open their own transaction, but `ExternalCommandExecutor` already opens one per command
   (so the idempotency record commits atomically with the effect) and `SqliteRuntimeDatabase`
   forbids nested transactions — the passthrough runs the use case against the *same* transaction
   instead of opening a new one, so nothing about the idempotency guarantee was weakened. No
   frozen-core file changed. `apps/runtime` gained `@v31m4/contracts` and `zod` as real
   (previously transitive-only) dependencies, used to validate/translate the external payload at
   the runtime boundary, matching the already-documented intent for where that translation
   belongs. Verified with real HTTP requests against a real server + real SQLite: happy path,
   fail-closed policy denial (wrong role), malformed-payload 400 (not an opaque 500), idempotent
   retry (no duplicate write), and a live SSE sequence bump.
3. **A minimal real operator UI** — `apps/runtime/public/index.html`, served at `GET /`
   (unauthenticated, like `/health`) by the existing runtime HTTP server; no framework, no build
   step, no second process/port. Covers session token entry, system health, and project creation
   (the only two real commands/queries that exist), plus a live event log using a hand-rolled
   SSE-over-fetch reader (`EventSource` cannot set the `Authorization` header this runtime's
   `/events` route requires, and weakening that requirement to suit the browser API was rejected).
   Verified against the real wire format: captured actual SSE bytes from a real `project.create`
   call and confirmed they match exactly what the client-side parser reads.

**Not yet done** (in priority order for continuing this program):

- **`mission.submit` and `job.start`/status commands** — same pattern as `project.create`
  (contract validation → real use case → real port adapters → passthrough transaction → policy
  rule → event), but each needs its own Layer 4 port adapters (`MissionRepositoryPort`,
  `JobRepositoryPort`, workflow/evidence ports as needed). This is the next concrete step toward
  a full vertical slice (create project → submit mission → start job → observe progress →
  verify → evidence → result); nothing about the pattern is unknown, it is more of the same kind
  of wiring `project.create` just proved out.
- **Job execution itself** (`run-solver-forge`, `verify-candidates`, `select-champion`,
  `deliver-result`) is unwired — no model/tool gateway wiring exists yet in the composition root
  for these use cases to call through.
- **Operator UI surfaces** for missions/jobs/approvals/evidence/results do not exist — deferred
  because the commands/queries behind them do not exist yet; adding UI panels for
  not-yet-real data would be exactly the fabricated status this program's own rules forbid.
- **Video `ShotGenerationAdapter`** (needs ComfyUI — confirmed installed at
  `/home/xxthatguyxx/ComfyUI` on 2026-08-09, WSL-native, not the Windows side this repo's earlier
  target-host scan checked; not yet run/exercised, so no real execution is claimed — see
  `docs/reviews/target-host-validation.md`) and **Game's Summer-backed real adapters** (needs
  Summer, not installed) remain as previously recorded — unrelated to the system-build program
  above, tracked independently in the Video/Game sections.

## Session-start rule

Read this file first, verify branch/HEAD/status/diff, then continue from the latest verified incomplete task. Do not rescan the entire repository unless evidence requires it.
