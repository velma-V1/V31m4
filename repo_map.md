# V31M4 Repository Map

## Current State

**Layer:** Application Services Layer 5
**Branch:** `claude/v31m4-layers-validation-impl-dmlccn`
**Parent layer:** `agent/application-ports-layer-4`
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

Layer 5 adds the deterministic, infrastructure-free application services on top of the
Layer 4 ports, and repairs the proven Layer 1–4 defects surfaced by running the real
pinned toolchain (`corepack enable && pnpm install && pnpm typecheck && pnpm test && pnpm build`).

### Implemented and functional

```text
packages/
├── domain/                              # Layer 1-2: primitives and 23 immutable entities
├── contracts/                           # Layer 3: strict APIs, events, manifests, RPC, + forbidden-key guard
└── application/
    ├── src/
    │   ├── index.ts                     # public application API (ports + services)
    │   ├── application-json.ts
    │   ├── application-errors.ts
    │   ├── operation-context.ts
    │   ├── port-types.ts
    │   ├── ports/                        # 26 Layer 4 infrastructure-free ports
    │   └── services/                     # Layer 5: 9 application services
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
    └── tests/                            # Layer 4 + Layer 5 verification (16 files)

schemas/                                 # 7 portable draft 2020-12 schemas
docs/                                    # Architecture, maps, versioning, plans, and the Layer 1-5 improvement ledger
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
- **Layer 4** application-port regression: **16 passing cases across 6 test files**.
- **Layer 5** application-service regression: **91 passing cases across 10 test files**.
- **Full Layer 1–5 regression:** **232 passing cases across 40 test files**.
- **Typecheck:** `pnpm typecheck` → 3/3 packages pass. **Build:** `pnpm build` → 3/3 pass. Application declaration emission: **41 `.d.ts` modules, 0 errors**.
- **Static:** total source files **87** (domain 31, contracts 15, application 41); **9 services**; largest source file **468 lines** (`packages/contracts/src/common.schemas.ts`); **0 explicit `any`** across Layers 1–5 source; no provider SDK imports; no placeholders in Layer 5.
- **Improvements made:** **4** proven Layer 1–4 corrections (see `docs/reviews/layers-1-5-improvement-ledger.md`).

### Known limitation

`pnpm lint` (`biome ci .`) still reports **pre-existing** formatting violations on Layer 1–4
files that predate any Biome run (the earlier layer branches had no registry access to run
Biome). Those files are intentionally left untouched to keep unrelated style churn out of
this focused diff; all files added or substantively changed by Layer 5 pass `biome ci`.
Because native `pnpm check` therefore stays red on that pre-existing formatting, the Layer 5
pull request remains a draft.

### Not implemented

No Layer 6 use cases, infrastructure implementations, database schema, artifact
implementation, runtime API server, desktop, CLI, adapter-protocol package,
model/tool/kernel adapters, plugin SDK, plugins, laboratories, or production workflows
exist. Layer 6 was not implemented.
