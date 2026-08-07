# V31M4 Repository Map

## Current State

**Layer:** Application Services Layer 5  
**Branch:** `agent/application-services-layer-5`  
**Parent layer:** `agent/application-ports-layer-4`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
packages/
├── domain/                              # Layers 1-2: primitives and 23 immutable entities
├── contracts/                           # Layer 3: strict APIs, events, manifests, RPC, schemas
└── application/
    ├── src/
    │   ├── application-json.ts
    │   ├── application-errors.ts
    │   ├── operation-context.ts
    │   ├── port-types.ts
    │   ├── ports/                       # 26 Layer 4 ports
    │   └── services/
    │       ├── compute-governor.ts
    │       ├── context-compiler.ts
    │       ├── diversity-planner.ts
    │       ├── evidence-linker.ts
    │       ├── champion-selector.ts
    │       ├── improvement-policy.ts
    │       ├── capability-calculator.ts
    │       ├── practice-selector.ts
    │       └── avatar-unlock-engine.ts
    └── tests/                            # 15 application test files

schemas/                                 # 7 portable draft 2020-12 schemas
docs/
├── architecture.md
├── dependency-rules.md
├── repository-map.md
├── contract-versioning.md
├── reviews/layers-1-5-improvement-ledger.md
└── superpowers/plans/2026-08-06-application-services-layer-5.md
```

### Verified Layer 5 behavior

- Compute selection supports direct, checked, competitive, and adversarial execution with resource and verification gates.
- Context compilation preserves mandatory information, prunes optional overflow, and produces stable fingerprints.
- Solver plans are pairwise materially distinct and deterministic for a seed.
- Evidence coverage preserves missing, failed, inconclusive, conflicting, and orphan records.
- Champion selection excludes mandatory failures and unresolved critical issues.
- Improvement policy rejects cosmetic, repeated, exhausted, and unverifiable repair loops.
- Capability updates require unique leakage-checked evidence and bound practice influence.
- Practice selection enforces idle time, safety, cooldown, rotation, resources, and independent verification.
- Avatar unlocks require passed independent evidence explicitly bound to each required capability.

### Correctness review

- Fixed a high-severity avatar progression weakness that permitted evidence about an unrelated subject.
- Added a regression test proving unrelated acceptance-criterion evidence cannot unlock a capability achievement.
- Reconfirmed that application services import no contracts, infrastructure, Node APIs, provider SDKs, or external implementations.

### Verification result

- Layer 1-2 domain regression: **92 passing cases across 16 files**.
- Layer 3 contracts and portable schemas: **33 passing cases across 8 files**.
- Layer 4-5 application verification: **43 passing cases across 15 files**.
- Combined Layer 1-5 behavior: **168 passing cases across 39 files**.
- Strict TypeScript checks for domain, contracts, and application: passed.
- Application source declarations: **40**, with zero explicit `any` types.
- Application source files: **40**.
- Application ports: **26**.
- Application services: **9**.
- Largest application source file: **142 lines**.
- Placeholder, forbidden dependency, JSON Schema, and file-size checks: passed.

### Environment limitation

The environment cannot install packages from the public npm registry. Committed tests use the pinned workspace dependencies and Vitest imports; verification used the available TypeScript compiler and isolated compatible local packages. A networked environment must run `corepack enable && pnpm install && pnpm check` before stacked pull requests are marked ready.

### Not implemented

No Layer 6 use cases, Layer 7 persistence, runtime API server, desktop, CLI, adapter-protocol implementation package, external adapters, plugin SDK, plugins, laboratories, or production workflows exist yet.
