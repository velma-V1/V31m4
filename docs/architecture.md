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

## Application boundary authority

Layer 4 defines the only supported interfaces through which application services may access persistence, artifacts, events, external models, production tools, plugins, kernels, verification, policy, scheduling, resources, secrets, isolated workspaces, configuration, approvals, audit history, and backups.

Application rules:

- `@v31m4/application` imports only the public `@v31m4/domain` API and application-local files.
- External API and adapter payload schemas remain in `@v31m4/contracts`; they are translated at runtime boundaries rather than imported into the application core.
- Every long-running or external call receives an immutable `OperationContext` carrying actor identity, correlation, idempotency, cancellation, and an optional deadline.
- Every authoritative write participates in a `UnitOfWorkTransaction`.
- Mutable records use explicit optimistic-concurrency `WriteCondition` values and return `Versioned<T>`.
- Missions, evidence, candidates, repairs, promotions, audit records, and other immutable records are append-only.
- Models, tools, and kernels expose provider-neutral results and explicit cancellation.
- Secrets are accessed through bounded leases rather than retained as long-lived values.
- Candidate, repair, tool, practice, and verification work occurs through explicit isolated-workspace handles.
- Policy decisions, approval records, and audit records are separate boundaries so authorization cannot be inferred from logging or vice versa.

## Application services authority

Layer 5 implements the deterministic application services that turn domain state and
Layer 4 ports into decisions and plans. Services own orchestration logic; they do not own
side effects.

Application service rules:

- Service source imports only the public `@v31m4/domain` API and application-local files.
- Services are deterministic for identical inputs: no hidden clock, no hidden randomness. Time enters through inputs or `ClockPort`; random seeds enter explicitly.
- Services return immutable decisions and plans. They never persist, never publish events, and never invoke models or tools directly; external effects go through Layer 4 ports.
- Every rejection is a typed application error or an explicit decision result.
- Models may not certify their own work. Model confidence and model size are never treated as evidence or as a proxy for quality.
- Original candidates, artifacts, evidence, checkpoints, and permanent unlocks are never overwritten; practice evidence is isolated from production.

The nine services are: compute governor, context compiler, diversity planner, evidence
linker, champion selector, improvement policy, capability calculator, practice selector,
and avatar unlock engine.

## Application use-case authority

Layer 6 coordinates the 21 production use cases through Layer 4 ports and Layer 5
services. Authoritative mutations occur inside units of work and publish their domain
events through the transactional event boundary. Mutable records use current revisions;
immutable records remain append-only. External model, tool, verifier, workspace, and
kernel calls never run inside an authoritative transaction. Job operations use explicit
prepare, invoke, and finalize-or-fail phases. Authoritative collection decisions consume
all pages and fail on repeated cursors. Exact-expiry approvals are expired, and idle
practice persists the opaque workspace identity used for cleanup.

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

Application Use Cases Layer 6 contains repository governance, the complete domain and
contract layers, seven root JSON Schemas, the complete `@v31m4/application` port boundary,
the nine deterministic services, and 21 transactional application use cases. Layers 1–6
are dependency-backed and regression tested against the pinned toolchain.

No infrastructure implementations, runtime API server, desktop UI, CLI,
adapter implementations, plugin SDK, plugins, laboratories, or production workflows are
implemented.
