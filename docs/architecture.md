# V31M4 Architecture

**Specification:** `V31M4-SRS-001`  
**Baseline:** `1.0.0`

V31M4 is a local-first modular monolith with Clean Architecture dependency direction, hexagonal ports, isolated external adapters, durable event-driven orchestration, and removable production plugins.

## Dependency direction

```text
Interface applications
        ↓
Runtime SDK and versioned contracts
        ↓
Application use cases and ports
        ↓
Domain entities and value objects

Infrastructure implements application ports.
Adapters implement the versioned adapter protocol.
Plugins register bounded capabilities through the plugin SDK and contracts.
Laboratories remain isolated from production state.
```

Dependencies always point toward the domain. The domain package has no runtime, infrastructure, adapter, plugin, UI, provider, filesystem, process, network, database, or schema-library dependencies.

## State authority

The future runtime process will own authoritative project, mission, job, evidence, checkpoint, artifact, capability, promotion, and avatar state. Interfaces may cache and display that state but never own it.

## Domain authority

Layer 2 establishes immutable domain state and transition rules before persistence or orchestration exists. Domain factories validate all externally supplied values. Transition functions return new frozen state and never mutate prior state. Illegal lifecycle movement raises typed domain errors.

Job lifecycle transitions also produce immutable domain events. Models, adapters, tools, and interfaces cannot directly alter domain state.

## Contract authority

Layer 3 establishes the only supported external shapes for runtime APIs, event streams, adapter messages, plugin manifests, workflows, evidence, training packets, capability packages, and avatar achievements.

Contract rules:

- Every bounded object rejects unknown properties.
- Every API request carries exact contract version `1.0.0` and a request identifier.
- Every adapter message uses JSON-RPC `2.0` and protocol version `1.0.0` where negotiation occurs.
- Durable identifiers are validated by the domain package rather than reimplemented.
- Timestamps use canonical UTC ISO-8601 with milliseconds.
- Recursive JSON values must be finite, acyclic, plain-object based, and free of prototype-pollution keys.
- Runtime events form a closed discriminated union and their aggregate envelope must match the typed payload identifier.
- Provider SDK request and response types cannot cross the model or tool gateway boundary.
- Root JSON Schemas are independently compilable draft 2020-12 documents with versioned schema IDs.
- TypeScript and JSON manifest schemas share parity tests for overlapping contracts.

## Verification authority

Models may propose solutions, critiques, claims, and repairs. Models may not certify their own work. Acceptance requires independent deterministic evidence whenever deterministic verification is available.

The implemented domain and contract layers enforce:

- Evidence records are immutable and artifact-backed.
- Verified checkpoints require evidence.
- Mandatory verification failures prevent a passing result.
- Missing mandatory checks produce an inconclusive result.
- Champion delivery requires complete mandatory and requirement coverage.
- Training data begins quarantined and cannot be promoted before verification.
- Avatar unlock records require immutable evidence.
- Mission submissions cover every mandatory criterion with explicit evidence requirements.
- Workflow stages reference known dependencies and form an acyclic graph.
- Plugin required and optional tool sets are disjoint.
- API, event, and RPC messages cannot silently accept unsupported fields or versions.

## Current implemented boundary

Contracts and Schema Layer 3 contains repository governance, domain primitives, all Layer 2 domain entities, the complete `@v31m4/contracts` package, seven root JSON Schemas, public exports, compatibility rules, and behavior tests.

No application ports, application services, persistence, runtime API server, desktop UI, CLI, gateways, adapter implementations, plugin SDK, plugins, laboratories, or production workflows are implemented.
