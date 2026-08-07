# V31M4 Dependency Rules

## Application Services Layer 5

### `packages/domain`

Allowed:

- ECMAScript language and standard library features
- Files inside `packages/domain/src`
- Type-only and runtime imports between domain entities and value objects

Forbidden:

- Node-specific filesystem, process, networking, worker, or database APIs
- React, Tauri, Fastify, Drizzle, Zod, provider SDKs, or production-tool SDKs
- Imports from `apps`, `packages/contracts`, `packages/application`, `packages/infrastructure`, `adapters`, `plugins`, or `labs`
- Circular imports, hidden global state, or mutation of accepted domain objects
- Provider-specific response or request types

### `packages/contracts`

Allowed:

- The public `@v31m4/domain` package API
- Zod runtime validation and type inference
- Node standard-library imports in contract tests only
- Ajv and ajv-formats in JSON Schema tests only

Forbidden:

- Imports from domain internal paths
- Imports from runtime, application, infrastructure, adapters, plugins, UI, or laboratories
- Provider SDKs or provider-specific payload types
- Filesystem, network, process, database, or secret access in contract source
- Permissive object schemas that silently strip unknown fields
- Unversioned API, event, manifest, workflow, or adapter messages
- Unbounded recursive `unknown` values

### `packages/application`

Allowed:

- The public `@v31m4/domain` package API
- Files inside `packages/application/src`
- Node standard-library imports in application tests only

Forbidden:

- Imports from `@v31m4/contracts` or contract internal paths
- Imports from runtime, infrastructure, adapters, plugins, UI, or laboratories
- Provider SDKs, database drivers, process APIs, filesystem APIs, network clients, or secret implementations in application source
- Optional transaction parameters on authoritative writes
- Unversioned mutable writes without explicit `WriteCondition`
- Raw provider errors crossing a port boundary
- Long-running operations without `OperationContext` and cancellation semantics
- Direct secret strings retained beyond a bounded secret lease

### Application port rules

- Application source defines ports, pure shared primitives, and deterministic decision services only.
- Every authoritative repository mutation requires `UnitOfWorkTransaction`.
- Every mutable aggregate write uses `WriteCondition` and returns `Versioned<T>`.
- External execution ports expose provider-neutral request and result types.
- Audit storage is append-only and distinct from policy and approval storage.
- Workspace operations make isolation, sealing, snapshotting, and disposal explicit.
- Services produce immutable decisions and do not perform direct persistence or external execution.
- Service time, resources, and randomness are explicit inputs.
- Source files remain below 500 lines.

### Contract construction rules

- Every bounded object uses strict validation.
- Every array with identifier semantics enforces uniqueness where duplication is invalid.
- Cross-field invariants use explicit semantic refinements.
- Durable identifiers reuse domain parsers.
- External JSON values reject cycles, non-finite numbers, non-plain objects, and dangerous property names.
- Runtime events use a closed discriminated union and verify aggregate consistency.
- Adapter RPC uses a closed method set for protocol `1.0.0`.
- Schema changes require the versioning process in `docs/contract-versioning.md`.
- Source files remain below 500 lines.

### `schemas`

- Every schema uses JSON Schema draft 2020-12.
- Every schema has an immutable versioned `$id`.
- Bounded objects set `additionalProperties` to `false`.
- Identifier arrays use `uniqueItems` where order does not imply duplication.
- Semantic rules that JSON Schema cannot express are documented with `$comment` and enforced by `@v31m4/contracts`.

## Dependency graph

```text
application tests → application services and ports → application public API → domain public API
contracts tests → contracts public API → domain public API
JSON Schema tests → root schemas
packages/domain → nothing outside domain
```

## Future direction

```text
apps → runtime-sdk / ui-kit / application / infrastructure
infrastructure → application ports / domain / adapter-protocol
application → domain public API
contracts → domain public API
plugins → plugin-sdk / contracts
adapters → adapter-protocol / external SDK
```

Architecture checks must reject every reverse dependency.
