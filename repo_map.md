# V31M4 Repository Map

## Current State

**Layer:** Authoritative Runtime Layer 10
**Branch:** `canonical/layers-6-10`
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
    │   └── use-cases/                    # Layer 6: 21 orchestration entrypoints
    └── tests/                            # Layer 4–6 verification
├── infrastructure/                      # L7 persistence + L8 processes/rpc/scheduling/secrets/adapters/logging + L9 gateways/policy/paths/plugins + L10 event-replay store
└── department-host/                     # Post-core: generic removable-department/plugin host SDK (lifecycle, isolation, rollback) on the core ports

apps/
├── runtime/                             # Layer 10: node:http runtime, auth, typed routes, external-command executor, event-stream coordinator, recovery, shutdown
└── departments-integration/             # Post-core: independence-matrix integration tests (core-only / both departments / after removal)

plugins/
├── video-production/                    # Post-core: removable Video Production department (shot pipeline: generate→QC→correct→assemble+verify)
└── game-production/                     # Post-core: removable 3D/Game Production department (scene pipeline: acquire→build→validate→package+verify)

schemas/                                 # 7 portable draft 2020-12 schemas
docs/                                    # Architecture, maps, plans, reviews, and deferred extension designs
```

The core (L1–10) is frozen; `department-host` and the `plugins/*` departments are additive post-core
packages that depend on the core only through existing ports. Core imports nothing from them, and the
departments do not import each other — each is independently removable. Real production tools sit
behind replaceable adapter boundaries, with deterministic reference adapters retained for CI/unit
verification. Two of those boundaries now have a real, target-host-validated implementation as well
as their reference adapter: Video's `AssemblyAdapter` (real ffmpeg) and `VisionQcAdapter` (real
ffmpeg + a real installed Ollama vision model) — see `docs/reviews/target-host-validation.md`. The
remaining boundaries (Video `ShotGenerationAdapter`; Game/3D's `AssetAdapter`/`SceneBuildAdapter`/
`SceneValidationAdapter`/`PackageAdapter`) still have only their reference adapter: their real tools
(ComfyUI/a generation model; Blender/Godot/Unreal) are not installed on the current target machine.

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
- **Frozen L1–10 core regression (audited baseline `78dc2b7`):** **340 passing cases across 71 test files**.
- **Current full post-core workspace regression (re-run and verified 2026-08-09, without
  `V31M4_TARGET_HOST`):** **369 passing cases / 10 skipped (379 total) across 75 passing + 2
  skipped test files (77 total)** — the frozen core tests plus the additive post-core packages:
  department host (12), Video Production (7 reference-adapter cases passing + 10 real-adapter
  cases correctly skipped across the two target-host test files), 3D/Game Production (8), and
  department independence/integration (2). The 10 skipped cases are the real ffmpeg/Ollama
  target-host tests (5 each for `AssemblyAdapter` and `VisionQcAdapter`); they pass for real when
  run with `V31M4_TARGET_HOST=1` on a machine with ffmpeg and Ollama installed — see
  `docs/reviews/target-host-validation.md`. They are never required, and never silently skipped
  without being reported as skipped, for normal workspace verification.
- **Layer 7–9** real-infrastructure regression: **41 passing cases across 13 test files** (persistence/artifacts/backup, supervised processes/JSON-RPC/adapters, plus L9 path policy, rule-based policy engine, plugin registry, and supervised model/tool gateways with provider fallback and failure classification).
- **Layer 10** authoritative runtime regression: **29 passing cases across 6 test files** (5 runtime + the infrastructure replay store) — external-command idempotency (run-once retry, payload/type conflict, version-conflict with no stored record), durable event replay (ordering, internal-gap refusal, retention `refresh_required`), the event-stream coordinator (replay-before-live boundary, bounded slow-consumer disconnect with a resumable cursor), config validation, the live HTTP surface (auth denial, idempotent write + query, version conflict, SSE replay, cross-restart durable-log recovery + health), and the integrated hardening pass (hostile input, concurrent idempotent/conflicting writers, and transactional rollback). See `docs/reviews/integrated-hardening-ledger.md`.
- **Typecheck / Build:** the frozen audited L1–10 core (5 packages: domain, contracts, application, infrastructure, runtime) is **5/5** typecheck and **5/5** build; the current full post-core workspace (9 packages, adding department-host and the three department/integration packages) is **9/9** typecheck and **9/9** build (each package compiles under `tsc --noEmit`).
- **Static:** largest source file **468 lines** (`packages/contracts/src/common.schemas.ts`); **0 explicit type `any`** across Layers 1–6 source; no provider SDK imports; all source files remain below 500 lines.
- **Layer 6 improvements:** seven recorded corrections covering workspace identity, contract parity, transaction phasing, pagination, approval expiry, resume validation, and finish-stop safety (see `docs/reviews/layers-1-6-improvement-ledger.md`).

### Native gate status

All native gates are green across the full post-core workspace (re-run 2026-08-09): `pnpm typecheck`
(9/9), `pnpm build` (9/9), `pnpm test` (**369 passing / 10 skipped across 75 passing + 2 skipped
test files**, no `V31M4_TARGET_HOST` set), `pnpm lint` (0 errors, 5 warnings, 1 info), and `pnpm
check` (aggregates lint + typecheck + test; PASS) — the frozen L1–10 core subset is 340 cases / 71
files at 5/5. The repo-wide Biome formatting debt from the
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
implementations — these remain on their deterministic reference adapter because their real tools
(ComfyUI/a generation model; Blender/Godot/Unreal) are not installed on the current target
machine.
