# V31M4 Repository Map

## Current State

**Layer:** Supervised Adapter Infrastructure Layer 8
**Branch:** `canonical/layers-6-10`
**Parent layer:** hardened Layer 5 `5746e5f2571a08dea3cce0493adeac92ae025135`
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

Layer 7 adds real SQLite transactions, revisioned/append-only records, transactional
outbox and idempotency storage, content-addressed artifacts, and verified backup/restore
on the canonical Layer 6. Layer 8 adds supervised process management, JSON-RPC
framing/correlation, adapter registration with restart-budget protection, bounded
scheduling, resource monitoring, secret leases, and redacted logging. Both live in
`packages/infrastructure`. The superseded Layer 6 was used only as reference and
reconciled according to `docs/reviews/layer-6-reconciliation-matrix.md`.

### Core completion scope decision

Video Production and 3D/Game Production are deferred until after V31M4 core completion.
They remain first-party removable production plugins in the architecture, but neither is a
core dependency, startup dependency, release gate, packaging prerequisite, or acceptance
prerequisite. Their preserved designs live under `docs/deferred/video-production/` and
`docs/deferred/game-production/`.

Core work may build only generic extension seams needed by production plugins. No
video-specific or game-specific implementation belongs in the core completion path.
Open Generative AI is not a core dependency; it may be evaluated later only for optional
reuse inside the deferred Video Production department.

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
└── infrastructure/                      # Layer 7 persistence (SQLite, artifacts, outbox, backup) + Layer 8 processes/rpc/scheduling/secrets/adapters/logging

schemas/                                 # 7 portable draft 2020-12 schemas
docs/                                    # Architecture, maps, plans, reviews, and deferred extension designs
```

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
- **Full Layer 1–8 regression:** **286 passing cases across 60 test files** (re-run and verified 2026-08-08).
- **Layer 7–8** real-infrastructure regression: **21 passing cases across 9 test files** (SQLite core, outbox/idempotency, content-addressed artifacts, backup/restore, supervised processes, JSON-RPC, adapter isolation/operations, architecture).
- **Typecheck:** `pnpm typecheck` → **4/4 packages pass**. **Build:** `pnpm build` → **4/4 pass** (each package compiles under `tsc --noEmit`).
- **Static:** largest source file **468 lines** (`packages/contracts/src/common.schemas.ts`); **0 explicit type `any`** across Layers 1–6 source; no provider SDK imports; all source files remain below 500 lines.
- **Layer 6 improvements:** seven recorded corrections covering workspace identity, contract parity, transaction phasing, pagination, approval expiry, resume validation, and finish-stop safety (see `docs/reviews/layers-1-6-improvement-ledger.md`).

### Native gate status

All native gates are green: `pnpm typecheck`, `pnpm test` (**286 cases across 60 files**),
`pnpm build`, `pnpm lint`, and `pnpm check`. The repo-wide Biome formatting debt from the
earlier no-network layer branches was cleared in an isolated formatting-only commit; two
Biome rules that genuinely conflict with the tsconfig / intentional code were resolved
(`useLiteralKeys` off — conflicts with `noPropertyAccessFromIndexSignature`; a justified
`biome-ignore` for the safe-path control-character regex). Contracts and application both
enforce the 500-line source limit via a `source-size` test; the largest source file is 468
lines and no file exceeds 500.

### Not implemented

Layer 8 supervised process/adapter infrastructure (process supervision, JSON-RPC framing,
adapter registration, scheduling, resource monitoring, secret leases, redacted logging) is
implemented in `packages/infrastructure`. Not yet implemented: the runtime API server
(HTTP/WebSocket) and composition root, desktop, CLI, concrete model/tool/kernel adapters,
plugin SDK, plugins, laboratories, and production workflows. Video Production and 3D/Game
Production are intentionally deferred and are not counted as missing core implementation.
