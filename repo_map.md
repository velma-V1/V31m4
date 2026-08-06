# V31M4 Repository Map

## Current State

**Layer:** Application Ports Layer 4  
**Branch:** `agent/application-ports-layer-4`  
**Parent layer:** `agent/contracts-schema-layer-3`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`

### Implemented and functional

```text
packages/
├── domain/                              # Layer 1-2: primitives and 23 immutable entities
├── contracts/                           # Layer 3: strict APIs, events, manifests, and RPC
└── application/
    ├── README.md
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── application-json.ts
    │   ├── application-errors.ts
    │   ├── operation-context.ts
    │   ├── port-types.ts
    │   └── ports/
    │       ├── unit-of-work.port.ts
    │       ├── project-repository.port.ts
    │       ├── mission-repository.port.ts
    │       ├── job-repository.port.ts
    │       ├── evidence-repository.port.ts
    │       ├── candidate-repository.port.ts
    │       ├── capability-repository.port.ts
    │       ├── artifact-store.port.ts
    │       ├── event-bus.port.ts
    │       ├── model-gateway.port.ts
    │       ├── tool-gateway.port.ts
    │       ├── plugin-registry.port.ts
    │       ├── production-kernel.port.ts
    │       ├── verifier.port.ts
    │       ├── policy-engine.port.ts
    │       ├── scheduler.port.ts
    │       ├── resource-monitor.port.ts
    │       ├── training-store.port.ts
    │       ├── secret-store.port.ts
    │       ├── clock.port.ts
    │       ├── workflow-repository.port.ts
    │       ├── workspace-manager.port.ts
    │       ├── audit-store.port.ts
    │       ├── approval-store.port.ts
    │       ├── configuration-store.port.ts
    │       └── backup-store.port.ts
    └── tests/                            # 6 Layer 4 test files

schemas/                                 # 7 portable draft 2020-12 schemas
docs/                                    # Architecture, maps, versioning, and Layer 1-4 plans
```

### Verified application behavior

- Application source imports only the public domain API and application-local files.
- External API contracts do not leak inward into application ports.
- Safe internal JSON rejects cycles, non-finite numbers, accessors, symbols, sparse arrays, class instances, and dangerous prototype keys.
- Application errors preserve typed codes, retryability, immutable safe details, and hidden causes.
- Operation contexts validate actor identity, roles, correlation, idempotency, canonical timestamps, cancellation, and deadlines.
- Authoritative writes require explicit unit-of-work transaction participation.
- Mutable writes require explicit optimistic-concurrency conditions and return versioned records.
- Immutable mission, evidence, candidate, repair, promotion, and audit records use append-only operations.
- Models, tools, plugins, kernels, and verifiers use provider-neutral application DTOs.
- Secret access uses bounded leases; isolated work uses explicit workspace handles.
- Policy, approvals, and audit history are separate non-interchangeable boundaries.
- Workflow, configuration, backup, and recovery boundaries are explicit before infrastructure exists.

### Verification result

- Layer 1-2 domain regression: **92 passing cases across 16 test files**.
- Layer 3 non-schema contract regression: **29 passing cases across 7 test files**.
- Layer 3 portable JSON Schemas: **7 of 7 valid**, unique versioned IDs, and four direct sample validations.
- Layer 4 application verification: **14 passing cases across 6 test files**.
- Combined executable behavior: **139 passing cases across 30 test files**, counting the four schema-test behaviors and all prior layers.
- Strict TypeScript checks for domain, contracts, and application: passed.
- Application declaration emission and public API scan: passed.
- Application source files: **31**.
- Application ports: **26**.
- Largest application source file remains below the 500-line architecture limit.
- Placeholder and forbidden-dependency scans: passed.

### Environment limitation

The environment cannot install packages from the public npm registry. Committed tests use normal pinned dependencies and Vitest imports; local verification used the available TypeScript compiler and isolated compatible test packages. A networked environment must run `corepack enable && pnpm install && pnpm check` before the stacked pull requests are marked ready.

### Not implemented

No application services or use cases, infrastructure implementations, database schema, artifact implementation, runtime API server, desktop, CLI, adapter-protocol package, model/tool/kernel adapters, plugin SDK, plugins, laboratories, or production workflows exist yet.
