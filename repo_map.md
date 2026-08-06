# V31M4 Repository Map

## Current State

**Layer:** Contracts and Schema Layer 3  
**Branch:** `agent/contracts-schema-layer-3`  
**Parent layer:** `agent/domain-entities-layer-2`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
packages/
├── domain/
│   ├── README.md
│   ├── src/
│   │   ├── domain-errors.ts
│   │   ├── domain-events.ts
│   │   ├── index.ts
│   │   ├── value-objects/                 # 5 canonical primitives
│   │   └── entities/                      # 23 immutable domain entities
│   └── tests/                             # 16 Layer 1-2 test files
└── contracts/
    ├── README.md
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── common.schemas.ts
    │   ├── projects.schemas.ts
    │   ├── missions.schemas.ts
    │   ├── jobs.schemas.ts
    │   ├── evidence.schemas.ts
    │   ├── capabilities.schemas.ts
    │   ├── models.schemas.ts
    │   ├── tools.schemas.ts
    │   ├── plugins.schemas.ts
    │   ├── practice.schemas.ts
    │   ├── avatar.schemas.ts
    │   ├── runtime-events.schemas.ts
    │   └── adapter-rpc.schemas.ts
    └── tests/
        ├── common.schemas.test.ts
        ├── runtime-resources.schemas.test.ts
        ├── capability-endpoints.schemas.test.ts
        ├── runtime-events.schemas.test.ts
        ├── adapter-rpc.schemas.test.ts
        ├── json-schemas.test.ts
        ├── compatibility.test.ts
        └── public-api.test.ts

schemas/
├── adapter-manifest.schema.json
├── plugin-manifest.schema.json
├── workflow.schema.json
├── evidence-record.schema.json
├── training-packet.schema.json
├── capability-package.schema.json
└── achievement-rule.schema.json

docs/
├── architecture.md
├── dependency-rules.md
├── contract-versioning.md
├── repository-map.md
└── superpowers/plans/2026-08-06-contracts-schema-layer-3.md
```

Repository governance, workspace configuration, the Layer 1 foundation, and the complete Layer 2 entity model remain present from the parent branches.

### Verified contract behavior

- Every bounded API, event, RPC, workflow, and manifest object rejects unknown properties.
- Contract, event, adapter-protocol, and JSON Schema documents use exact version `1.0.0` compatibility.
- Durable identifiers, content hashes, safe paths, scores, and resource budgets reuse domain validation.
- Canonical timestamps require UTC ISO-8601 with milliseconds and reject normalized lookalikes.
- Recursive JSON values reject cycles, non-finite numbers, non-plain objects, and prototype-pollution keys.
- Mission submissions require unique IDs and explicit evidence coverage for every mandatory criterion.
- Jobs, checkpoints, evidence, capability scores, deliveries, promotions, practice tasks, and avatar state enforce cross-field invariants.
- Model and tool payloads remain provider-neutral and reject provider extension fields.
- Plugin tool sets are unique and disjoint; workflow dependency graphs reference known stages and remain acyclic.
- Runtime events form a closed union and require the aggregate envelope to match the typed payload identifier.
- Adapter JSON-RPC accepts only the declared method set and keeps success and error responses mutually exclusive.
- TypeScript and JSON plugin/workflow schemas have permanent parity checks.
- Seven portable JSON Schemas compile independently under draft 2020-12.

### Verification result

- Layer 1-2 domain regression: **92 passing cases across 16 test files**.
- Layer 3 contract verification: **33 passing cases across 8 test files**.
- Combined verified behavior: **125 passing cases across 24 test files**.
- Strict TypeScript contract source and test compilation: passed.
- Contract declaration emission: **14 declaration files**, with **zero `any` occurrences**.
- Independent JSON Schema validation: **7 of 7 passed** with Ajv-compatible tests and Python `jsonschema` draft 2020-12 checks.
- Domain and contract source files: **45**.
- Largest source file: **452 lines**, below the 500-line architecture limit.
- Placeholder scan: passed.
- Forbidden contract dependency scan: passed.
- JSON parsing and unique schema-ID checks: passed.

### Environment limitation

The execution environment cannot access the public npm registry. The committed package uses normal pinned dependencies and Vitest/Ajv imports, while local verification used the available TypeScript compiler plus isolated API-compatible local test shims and an independent Python JSON Schema validator. A networked environment must run `corepack enable && pnpm install && pnpm check` before the pull request is marked ready.

### Not implemented

Everything outside the domain and contracts packages remains specified but absent. No application ports, application services, persistence, runtime API server, desktop, CLI, gateways, adapter-protocol implementation package, model/tool/kernel adapters, plugin SDK, plugins, laboratories, or production workflows exist yet.
