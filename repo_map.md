# V31M4 Repository Map

## Current State

**Layer:** Foundation/Core Layer 1  
**Branch:** `agent/foundation-core`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
/
├── AGENTS.md
├── README.md
├── repo_map.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── vitest.workspace.ts
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .env.example
├── docs/
│   ├── repository-specification.md
│   ├── architecture.md
│   ├── dependency-rules.md
│   ├── repository-map.md
│   └── superpowers/plans/2026-08-06-foundation-core.md
└── packages/domain/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── domain-errors.ts
    │   ├── domain-events.ts
    │   └── value-objects/
    │       ├── ids.ts
    │       ├── content-hash.ts
    │       ├── safe-path.ts
    │       ├── score.ts
    │       └── resource-budget.ts
    └── tests/
        ├── domain-errors.test.ts
        ├── domain-events.test.ts
        ├── ids.test.ts
        ├── content-hash.test.ts
        ├── safe-path.test.ts
        ├── score.test.ts
        ├── resource-budget.test.ts
        └── public-api.test.ts
```

### Verified behavior

- Branded durable identifiers accept canonical values and reject empty, padded, malformed, and oversized values.
- Content hashes accept only canonical lowercase SHA-256 hexadecimal strings.
- Safe paths reject absolute paths, traversal, Windows device names, forbidden characters, duplicate separators, and non-canonical segments.
- Scores remain within the inclusive range `0..1`.
- Resource budgets enforce integer, range, and optional-resource invariants.
- Domain errors preserve typed codes and frozen details.
- Domain events preserve immutable payloads, metadata, and occurrence time.

### Not implemented

Everything outside Foundation/Core Layer 1 remains specified but absent. No runtime, desktop, CLI, application services, persistence, gateways, adapters, plugins, laboratories, or production workflows exist yet.
