# V31M4 Repository Map

## Current State

**Layer:** Authoritative Runtime Layer 10
**Branch:** `main`
**Parent layer:** hardened Layer 5 `5746e5f2571a08dea3cce0493adeac92ae025135`
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

Layer 7 adds real SQLite transactions, revisioned/append-only records, transactional
outbox and idempotency storage, content-addressed artifacts, and verified backup/restore
on the canonical Layer 6. Layer 8 adds supervised process management, JSON-RPC
framing/correlation, adapter registration with restart-budget protection, bounded
scheduling, resource monitoring, secret leases, and redacted logging. Layer 9 adds the
production gateways: real-path containment (`PathPolicy`), a fail-closed rule-based policy
engine, a durable plugin registry, and supervised provider-neutral model/tool/kernel
gateways. Layers 7–9 live in `packages/infrastructure`. Layer 10 adds the authoritative
runtime under `apps/runtime`: a `node:http` HTTP surface with local session authentication,
typed command/query/event routes, an idempotent external-command executor, the durable
committed-event replay store, a resumable event-stream coordinator (replay-before-live,
internal-gap and retention `refresh_required` refusal, bounded slow-consumer disconnect),
startup recovery over the durable log, and checkpoint-safe shutdown. The superseded Layer 6
was used only as reference and reconciled according to
`docs/reviews/layer-6-reconciliation-matrix.md`.

### Core completion scope decision (historical) and current department state

V31M4 core (L1–10) completed first, deferring Video Production and 3D/Game Production until
afterward; their original preserved designs live under `docs/deferred/video-production/` and
`docs/deferred/game-production/` as historical reference. That deferral is now resolved: both
departments were subsequently implemented as post-core, removable first-party plugins
(`packages/department-host`, `plugins/video-production`, `plugins/game-production`) — see
"Implemented and functional" below and `docs/reviews/post-core-program-status.md`. Neither is a
core dependency, startup dependency, release gate, packaging prerequisite, or acceptance
prerequisite; the core remains frozen and imports nothing from them.

Open Generative AI is not a core dependency; it may be evaluated only for optional reuse inside
the Video Production department.

### Implemented and functional

```text
packages/
├── domain/                              # Layer 1-2: primitives and 23 immutable entities
├── contracts/                           # Layer 3: strict APIs, events, manifests, RPC, + forbidden-key guard
├── application/
    ├── src/
    │   ├── index.ts                     # public application API (ports + services)
    │   ├── application-json.ts
    │   ├── application-errors.ts
    │   ├── operation-context.ts
    │   ├── port-types.ts
    │   ├── ports/                        # 26 Layer 4 infrastructure-free ports
    │   ├── services/                     # Layer 5: 9 application services
    │       ├── compute-governor.ts
    │       ├── context-compiler.ts
    │       ├── diversity-planner.ts
    │       ├── evidence-linker.ts
    │       ├── champion-selector.ts
    │       ├── improvement-policy.ts
    │       ├── capability-calculator.ts
    │       ├── practice-selector.ts
    │       ├── avatar-unlock-engine.ts
    │       └── internal/deterministic.ts # private deterministic helpers (not exported)
    │   └── use-cases/                    # Layer 6: 21 canonical + 2 approval-lifecycle entrypoints
    └── tests/                            # Layer 4–6 verification
├── infrastructure/                      # L7 persistence + L8 processes/rpc/scheduling/secrets/adapters/logging + L9 gateways/policy/paths/plugins + L10 event-replay store
└── department-host/                     # Post-core: generic removable-department/plugin host SDK (lifecycle, isolation, rollback) on the core ports

adapters/
└── local-supervised/                    # Optional Stage 4 Ollama model, contained kernel, and independent verifier JSON-RPC children

apps/
├── runtime/                             # Layer 10: authoritative runtime plus explicit hermetic_reference/supervised_local execution composition
└── departments-integration/             # Post-core: independence-matrix integration tests (core-only / both departments / after removal)

plugins/
├── video-production/                    # Post-core: removable Video Production department (shot pipeline: generate→QC→correct→assemble+verify)
└── game-production/                     # Post-core: removable 3D/Game Production department (scene pipeline: acquire→build→validate→package+verify)

schemas/                                 # 7 portable draft 2020-12 schemas
docs/                                    # Architecture, maps, plans, reviews, and deferred extension designs
```

The core (L1–10) is frozen — no uncontrolled redesign, core dependency direction still enforced,
existing public APIs/contracts not casually changed — with one narrow, evidence-backed, explicitly
approved exception already made (commit `2786ca9`, see "Core freeze" in `docs/current-state.md`);
`department-host` and the `plugins/*` departments are additive post-core
packages that depend on the core only through existing ports. Core imports nothing from them, and the
departments do not import each other — each is independently removable. Real production tools sit
behind replaceable adapter boundaries, with deterministic reference adapters retained for CI/unit
verification. Two of those boundaries now have a real, target-host-validated implementation as well
as their reference adapter: Video's `AssemblyAdapter` (real ffmpeg) and `VisionQcAdapter` (real
ffmpeg + a real installed Ollama vision model) — see `docs/reviews/target-host-validation.md`. The
remaining boundaries (Video `ShotGenerationAdapter`; Game/3D's `AssetAdapter`/`SceneBuildAdapter`/
`SceneValidationAdapter`/`PackageAdapter`) still have only their reference adapter: ComfyUI
(Video's real generation tool) is installed (`/home/xxthatguyxx/ComfyUI`, WSL-native, confirmed
2026-08-09) but not yet executed or adapter-integrated for V31M4; Summer (the Game department's
primary execution platform — see
`docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`) is not installed on
the current target machine. See `docs/reviews/target-host-validation.md` for the authoritative
per-tool capability matrix.

### System-build program execution truth (`apps/runtime`, distinct from the department adapters above)

| Component | Status |
|---|---|
| Default `hermetic_reference` kernel/model/verifier | Reference — retained for deterministic core boot and tests; no external service required |
| Explicit `supervised_local` `stage4.tiny-code` path | VERIFIED REAL — installed Ollama 0.32.7 `devstral-small-2:24b` inference, three supervised child processes, contained checkpointed kernel apply, independent Node command verifier, immutable evidence, champion/delivery gate, and exactly-once restart reconciliation |
| Explicit `supervised_local` `software.production.v1` path | VERIFIED REAL — strict project-owned build packet, bounded multi-file context/change manifest, isolated atomic kernel edits, packet-declared independent Node check, immutable evidence/delivery, idempotent replay, restart readback, and installed `devstral-small-2:24b` target-host proof |
| SQLite persistence, artifact store, workspace filesystem, event outbox, SSE stream, restart recovery | Real |
| `pnpm dev` boot, `project.create`/`mission.submit`/`job.start`/`job.execute` commands, operator UI panels (project/mission/job-start/job-execute) | Real, HTTP-verified against a real server + real SQLite |
| `mission.list` / `job.list` / `candidate.list` / `evidence.list` query surface | VERIFIED — authenticated strict `POST /queries/:type`, existing Layer 4 repositories, relationship validation, filtered pagination, valid empty/error/auth behavior, and persisted restart-stable results |
| `plugin.register` / `approval.decide` / `approval.list` governance surface | VERIFIED — real require-approval policy, durable pending/grant/deny/consume, exact action/resource/requester/context/scope/expiry matching, single use, audit, rollback, idempotent replay, auth and restart stability |
| Operator UI browser-driven proof | VERIFIED — Playwright Chromium drives the authenticated full workflow, rendered results/events, runtime restart + SSE cursor resume, durable job readback, and a visible unauthenticated-command denial |

### Verified application-service behavior

- Services import only the public domain API and application-local files; no infrastructure, contracts, adapters, plugins, UI, or provider SDKs.
- Services are deterministic: no hidden clock, no hidden randomness; time and seeds enter through inputs.
- Services return frozen decisions and plans; they never persist or publish directly.
- The compute governor never selects a high-confidence mode without verification and never exceeds the approved budget.
- The champion selector never uses model confidence or model size and excludes unverified, missing-check, or critically-risky candidates.
- The capability calculator uses only verified production measurements, isolates practice evidence, and bounds every score step.
- The avatar unlock engine never unlocks from model claims or unverified practice, preserves prior permanent unlocks, and never equips a locked item.

### Verification result (dependency-backed)

- **Layer 1** foundation/primitive regression: **62 passing cases across 8 test files**.
- **Layer 2** domain-entity regression: **30 passing cases across 8 test files**.
- **Layer 3** runtime contract regression (non-schema): **29 passing cases across 7 test files**.
- **Layer 3** portable JSON Schemas: **7 of 7 compiled under Ajv draft 2020-12**, unique versioned `$id`s, **4 passing schema tests**.
- **Layer 3** prototype-pollution / hostile-input hardening: **5 passing cases** (`security.schemas.test.ts`).
- **Layer 4** application-port regression: **16 passing cases across 6 test files**.
- **Layer 5** application-service regression: **97 passing cases across 10 test files** (includes a seeded budget fuzz, order-invariance, and purity guardrails).
- **Layer 6** application-use-case regression: **19 passing cases across 8 focused test files**, plus domain/contract practice-parity coverage.
- **Frozen L1–10 core regression (audited baseline `78dc2b7`, historical):** **340 passing cases
  across 71 test files**, as of that specific immutable commit. One file inside this set —
  `packages/application/src/use-cases/select-champion.ts` — has since received one explicitly
  approved core correction (commit `2786ca9`, with a dedicated regression test); this baseline
  number describes `78dc2b7` itself, not the current tree. See "Core freeze" in
  `docs/current-state.md` for the full explanation.
- **Stage 1 current full workspace regression (re-run 2026-08-11):** **410 passing cases / 10
  skipped (420 total) across 90 passing + 2 skipped test files (92 total)**. The two new passing
  cases are the real Playwright Chromium operator workflow/restart proof and its focused idle-SSE
  header regression. Chromium used three Ubuntu shared-library packages extracted reversibly under
  `/tmp` because the target WSL image lacks those libraries and sudo authentication was unavailable;
  no system or repository binary installation was performed.
- **Stage 2 current full workspace regression (re-run 2026-08-11):** **413 passing cases / 10
  skipped (423 total) across 91 passing + 2 skipped test files (93 total)**. Stage 2 adds one strict
  mission/candidate list-contract case and two real HTTP + real SQLite query cases. The focused
  Stage 2 selection is 10/10 across 3 files; the complete owning contract/runtime selection is
  83/83 across 21 files. The integration proof exposed and protects the relationship-filter-before-
  pagination correction for mission/job/candidate/evidence items, totals, offsets, and cursors,
  plus exact rejection of partially numeric pagination cursors.
- **Stage 3 current full workspace regression (re-run 2026-08-11):** **436 passing cases / 10
  skipped (446 total) across 97 passing + 2 skipped test files (99 total)**. Stage 3 adds the real
  durable approval lifecycle and its contract/application/runtime/governance proofs, then the
  integrity realignment adds permanent regressions for generic approval-state forgery, strict
  cursor/config parsing, post-commit transaction errors, JSON-RPC listener cleanup, and runtime
  source-size/explicit-`any` boundaries. Focused Stage 3 verification is 98/98 across 30 files; the
  post-repair cross-layer integrity selection is 195/195 across 46 files.
- **Stage 4 current full workspace regression (re-run 2026-08-11):** **453 passing cases / 11
  skipped (464 total) across 100 passing + 3 skipped test files (103 total)**. The explicitly
  opt-in real Ollama test is skipped by the hermetic gate and passed separately 1/1 with installed
  Ollama 0.32.7 `devstral-small-2:24b`. Focused Stage 4/owning-layer verification is 52/52 across
  11 files; post-reconciliation runtime verification is 19/19 across 4 files. `pnpm check`,
  dependency/source-size/explicit-`any` guards, and the independent real target-host proof pass.
- **Item 1 current full workspace regression (re-run 2026-08-12):** **472 passing cases / 12
  skipped (484 total) across 104 passing + 3 skipped test files (107 total)**. Focused general
  production verification is 28 passing / 1 opt-in skip across 8 files; the separate installed
  Ollama acceptance passed 1/1 with `devstral-small-2:24b`. Lint has 0 errors (9 existing
  warnings, 1 existing info), typecheck is 9/9, and the reversible browser runtime libraries under
  `/tmp` were used without installing a system or repository binary.
- **Current full post-core workspace regression (re-run and verified at `86c3d1a`, without
  `V31M4_TARGET_HOST`):** **408 passing cases / 10 skipped (418 total) across 89 passing + 2
  skipped test files (91 total)** — the frozen core tests plus the additive post-core packages:
  department host (12), Video Production (7 reference-adapter cases passing + 10 real-adapter
  cases correctly skipped across the two target-host test files), 3D/Game Production (8), and
  department independence/integration (2). The 10 skipped cases are the real ffmpeg/Ollama
  target-host tests (5 each for `AssemblyAdapter` and `VisionQcAdapter`); they pass for real when
  run with `V31M4_TARGET_HOST=1` on a machine with ffmpeg and Ollama installed — see
  `docs/reviews/target-host-validation.md`. They are never required, and never silently skipped
  without being reported as skipped, for normal workspace verification. 6 added cases are new
  static dependency-boundary tests — one per package that previously lacked one (`domain`,
  `contracts`, `department-host`, `plugins/video-production`, `plugins/game-production`,
  `apps/runtime`) — scanning each package's `src` for import specifiers and asserting they match
  exactly the allowed set documented in `docs/dependency-rules.md`, mirroring the existing pattern
  in `packages/application` and `packages/infrastructure`. 19 cases are the system-build program's
  vertical slice: `project.create` (5), the static operator-UI route (2), `mission.submit` (4),
  `job.start` (4), `job.execute` — the full solver → verify → select-champion → deliver chain
  through the real Layer 6 use cases (3), and one end-to-end test that runs the entire mission
  flow, shuts the runtime down, boots a brand-new instance against the same SQLite file, and
  confirms every record and the durable event sequence recovered (1). 8 cases are the P0
  direct-command idempotency repair (commit `51d10b4`): same-key/different-payload conflict,
  same-key/different-command-type conflict, concurrent-duplicate collapse, restart replay,
  canonical post-completion replay, and fail-closed behavior on an interrupted claim, for both
  `job.start` and `job.execute`. 6 cases are the P1 negative-verification path (commit `2786ca9`):
  5 integration tests forcing verification failure through job.execute end to end (no champion, no
  delivery, durable failure state, restart-proven) plus 1 unit regression test for the
  `select-champion.ts` fix that made the path reachable at all. The evidence-durable-readback proof
  (P1, commit `86c3d1a`) added 0 net cases — it extended the existing restart-recovery test's
  assertions in place rather than adding new test cases. Stage 1 Browser UI Proof adds one real
  Playwright Chromium workflow/restart regression and one focused idle-SSE-header regression. The
  browser run found and fixed one real defect: the SSE route now flushes its 200 headers immediately
  so an authenticated client can establish an idle stream before the first event. See "System
  build" in
  `docs/current-state.md` for exactly what this covers and what remains.
- **Layer 7–9** real-infrastructure regression: **41 passing cases across 13 test files** (persistence/artifacts/backup, supervised processes/JSON-RPC/adapters, plus L9 path policy, rule-based policy engine, plugin registry, and supervised model/tool gateways with provider fallback and failure classification).
- **Layer 10** authoritative runtime regression: **29 passing cases across 6 test files** (5 runtime + the infrastructure replay store) — external-command idempotency (run-once retry, payload/type conflict, version-conflict with no stored record), durable event replay (ordering, internal-gap refusal, retention `refresh_required`), the event-stream coordinator (replay-before-live boundary, bounded slow-consumer disconnect with a resumable cursor), config validation, the live HTTP surface (auth denial, idempotent write + query, version conflict, SSE replay, cross-restart durable-log recovery + health), and the integrated hardening pass (hostile input, concurrent idempotent/conflicting writers, and transactional rollback). See `docs/reviews/integrated-hardening-ledger.md`.
- **Typecheck / Build:** the frozen audited L1–10 core (5 packages: domain, contracts, application, infrastructure, runtime) is **5/5** typecheck and **5/5** build; the current full post-core workspace (9 packages, adding department-host and the three department/integration packages) is **9/9** typecheck and **9/9** build (each package compiles under `tsc --noEmit`).
- **Static:** largest source file **468 lines** (`packages/contracts/src/common.schemas.ts`); **0 explicit type `any`** across Layers 1–6 source; no provider SDK imports; all source files remain below 500 lines.
- **Layer 6 improvements:** seven recorded corrections covering workspace identity, contract parity, transaction phasing, pagination, approval expiry, resume validation, and finish-stop safety (see `docs/reviews/layers-1-6-improvement-ledger.md`).

### Native gate status

All native gates are green across the full post-core workspace (re-run 2026-08-11 for Stage 3):
`pnpm check` PASS — `pnpm lint` 0 errors (9 pre-existing warnings, 1 pre-existing info), `pnpm
typecheck` 9/9, and `pnpm test` **436 passing / 10 skipped across 97 passing + 2 skipped test
files**. Browser execution used the reversible `/tmp` shared-library setup recorded in
`docs/current-state.md`; `V31M4_TARGET_HOST` was not set. The frozen L1–10 core
subset, as audited at `78dc2b7` (historical), was 340 cases / 71 files at 5/5. The repo-wide Biome formatting debt from the
earlier no-network layer branches was cleared in an isolated formatting-only commit; two
Biome rules that genuinely conflict with the tsconfig / intentional code were resolved
(`useLiteralKeys` off — conflicts with `noPropertyAccessFromIndexSignature`; a justified
`biome-ignore` for the safe-path control-character regex). Contracts and application both
enforce the 500-line source limit via a `source-size` test; the largest source file is 468
lines and no file exceeds 500.

### Not implemented

Layers 1–10 core is complete. Layers 8–9 are implemented in `packages/infrastructure`:
supervised process/adapter infrastructure (process supervision, JSON-RPC framing, adapter
registration, scheduling, resource monitoring, secret leases, redacted logging) and production
gateways (real-path `PathPolicy` containment, fail-closed rule-based policy engine, durable
plugin registry, and supervised provider-neutral model/tool/kernel gateways with fallback and
failure classification). **Layer 10** is implemented under `apps/runtime`: the authoritative
`node:http` runtime, composition root, durable committed-event replay, the resumable
event-stream coordinator, and the external-command idempotency contract. Post-core, the generic
department/plugin host SDK (`packages/department-host`) and the removable Video and 3D/Game
departments (`plugins/*`) are implemented and verified (see
`docs/reviews/post-core-program-status.md`). Two real, target-host-validated production adapters
are implemented for Video: `FfmpegAssemblyAdapter` and `OllamaVisionQcAdapter` (see
`docs/reviews/target-host-validation.md`). Not yet implemented outside that: desktop, CLI,
laboratories, additional production workflows, outbox retention/pruning (an additive operational
feature — see `docs/reviews/production-readiness-audit.md`), Video's `ShotGenerationAdapter`, and
any of 3D/Game's real `AssetAdapter`/`SceneBuildAdapter`/`SceneValidationAdapter`/`PackageAdapter`
implementations — these remain on their deterministic reference adapter: ComfyUI is installed but
not yet executed or adapter-integrated for V31M4; Summer (the Game department's primary execution
platform per
`docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`) is not installed on
the current target machine. Within the system-build program (`apps/runtime`): P0 direct-command
idempotency repair, P1 negative-verification-path/evidence-durable-readback proof, Stage 1 Browser
UI Proof, Stage 2 List/Query Surface, and Stage 3 Approval-Flow Proof plus system-integrity/drift
realignment are complete. The generic `record.put` mutation bypass is removed; only typed mutation
  surfaces remain. Stage 4 now proves one explicit optional real supervised model/verifier/
  production-kernel path for the allowlisted `stage4.tiny-code` workflow, including restart
  reconciliation. The next incomplete system-build item is its bounded generalization to real
  project-owned coding workspaces/build packets and repair rounds, recorded in
  `docs/current-state.md` and the Stage 4 proof.
