# V31M4 Repository Map

## Current State

**Layer:** Domain Entity Layer 2  
**Branch:** `agent/domain-entities-layer-2`  
**Parent layer:** `agent/foundation-core`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
packages/domain/
├── src/
│   ├── index.ts
│   ├── domain-errors.ts
│   ├── domain-events.ts
│   ├── value-objects/
│   │   ├── ids.ts
│   │   ├── content-hash.ts
│   │   ├── safe-path.ts
│   │   ├── score.ts
│   │   └── resource-budget.ts
│   └── entities/
│       ├── project.ts
│       ├── requirement.ts
│       ├── mission-contract.ts
│       ├── job.ts
│       ├── checkpoint.ts
│       ├── artifact.ts
│       ├── evidence-record.ts
│       ├── claim.ts
│       ├── production-twin.ts
│       ├── capability-profile.ts
│       ├── model-profile.ts
│       ├── tool-profile.ts
│       ├── plugin-profile.ts
│       ├── solver-candidate.ts
│       ├── verification-result.ts
│       ├── issue-record.ts
│       ├── repair-record.ts
│       ├── champion-decision.ts
│       ├── delivery-receipt.ts
│       ├── training-packet.ts
│       ├── practice-task.ts
│       ├── promotion-record.ts
│       └── avatar-state.ts
└── tests/
    ├── Layer 1 regression suite: 8 files
    └── Layer 2 entity suite: 8 files
```

Repository governance, workspace configuration, architecture documentation, and the Layer 1 foundation remain present from the parent branch.

### Verified behavior

- Projects, jobs, issues, claims, training packets, practice tasks, plugins, and avatar state enforce explicit lifecycle transitions.
- Mission contracts require outputs, requirements, acceptance criteria, and evidence coverage for every mandatory criterion.
- Jobs emit immutable events and preserve verified checkpoint identity across emergency stopping.
- Artifacts preserve content-addressed lineage; accepted evidence remains immutable and artifact-backed.
- Candidate originals remain distinct from reconstructed candidate lineage.
- Verification cannot pass when a mandatory check fails or is missing.
- Champion delivery requires complete requirement and mandatory-check coverage.
- Training packets remain quarantined until leakage checks and verification pass.
- Capability measurements require sample size, difficulty range, timestamps, and immutable evidence.
- Practice results remain isolated and cannot enter quarantine without evidence.
- Avatar unlocks are permanent, evidence-linked, and cannot be equipped before they are earned.

### Verification result

- Strict TypeScript source compilation: passed.
- Full Layer 1 and Layer 2 TypeScript test compilation: passed with local Vitest type compatibility.
- Layer 1 regression and Layer 2 behavior execution: 92 passing cases across 16 files.
- Source files: 31.
- Largest source file: 265 lines, below the 500-line architecture limit.
- Placeholder scan: passed.
- Forbidden dependency scan: passed.

### Not implemented

Everything outside the domain package remains specified but absent. No application ports, application services, persistence, runtime API, desktop, CLI, gateways, adapter protocol, adapters, plugin SDK, plugins, laboratories, or production workflows exist yet.
