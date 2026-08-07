# V31M4 Repository Map

## Current State

**Layer:** Application Use Cases Layer 6  
**Branch:** `agent/application-use-cases-layer-6`  
**Parent layer:** `agent/application-services-layer-5`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
packages/
├── domain/                              # Layers 1-2, including durable practice workspace identity
├── contracts/                           # Layer 3 plus practice lifecycle parity correction
└── application/
    ├── src/
    │   ├── application primitives
    │   ├── ports/                       # 27 infrastructure-free ports
    │   ├── services/                    # 9 deterministic Layer 5 services
    │   └── use-cases/
    │       ├── project, mission, and execution planning
    │       ├── durable job lifecycle
    │       ├── solver, verification, issue, and repair
    │       ├── champion, delivery, training, and promotion
    │       ├── idle practice and avatar progression
    │       └── governed plugin, model, and tool operations
    └── tests/                            # 23 application test files

schemas/                                 # 7 portable draft 2020-12 schemas
docs/
├── reviews/layers-1-6-improvement-ledger.md
└── superpowers/plans/2026-08-06-application-use-cases-layer-6.md
```

### Verified Layer 6 behavior

- Project creation is policy-gated, revisioned, transactional, and audited.
- Missions are immutable and accepted only for active projects.
- Planning composes compute governance, smallest-sufficient context, and material solver diversity.
- Job start, checkpoint, resume, and stop follow durable prepare, external invoke, finalize-or-fail phases.
- Solver candidates and repairs run in isolated workspaces and preserve immutable lineage.
- Independent verification evidence, issues, repairs, champion decisions, and delivery receipts are persisted through ports.
- Training packets remain quarantined until verified, then promote atomically with capability history.
- Idle practice persists the opaque workspace ID and reliably disposes it when stopped.
- Avatar and practice evaluation consume complete pagination rather than silently truncating records.
- Plugins, models, and tools are governed by policy, approval, gateway, and audit boundaries.

### Correctness review

- Added durable practice workspace identity across domain, contract, port, and use-case layers.
- Corrected practice contract lifecycle parity.
- Replaced ambiguous critical `afterCommit` orchestration with explicit two-phase job operations.
- Fixed stale `startJob` return state.
- Added complete pagination and repeated-cursor protection.
- Fixed exact approval-expiration semantics.

### Verification result

- Layer 1-2 domain regression: **92 passing cases across 16 files**.
- Layer 3 contracts and portable schemas: **35 passing cases across 9 files**.
- Layer 4-6 application verification: **60 passing cases across 23 files**.
- Combined Layer 1-6 behavior: **187 passing cases across 48 files**.
- Strict TypeScript checks for domain, contracts, and application: passed.
- Application source files and declarations: **63**.
- Application ports: **27**.
- Application services: **9**.
- Public use cases: **21** plus one internal support module.
- Largest application source file: **142 lines**.
- Placeholder, forbidden dependency, JSON Schema, pagination, and file-size checks: passed.

### Environment limitation

The environment cannot install packages from the public npm registry. Committed tests use the pinned workspace dependencies and Vitest imports; verification used the available TypeScript compiler and isolated compatible local packages. A networked environment must run `corepack enable && pnpm install && pnpm check` before stacked pull requests are marked ready.

### Not implemented

No Layer 7 persistence, runtime API server, desktop, CLI, adapter-protocol implementation package, external adapters, plugin SDK, plugins, laboratories, or production workflows exist yet.
