# V31M4 Dependency Rules

## Domain Entity Layer 2

### `packages/domain`

Allowed:

- ECMAScript language and standard library features
- Files inside `packages/domain/src`
- Type-only and runtime imports between domain entities and value objects

Forbidden:

- Node-specific filesystem, process, networking, worker, or database APIs
- React, Tauri, Fastify, Drizzle, Zod, provider SDKs, or production-tool SDKs
- Imports from `apps`, `packages/application`, `packages/infrastructure`, `adapters`, `plugins`, or `labs`
- Circular imports
- Imports through another package's internal path
- Hidden global state
- Mutation of an accepted domain object
- Provider-specific response or request types

### Entity rules

- Factories validate every externally supplied property.
- Collections are copied, deduplicated where required, and frozen.
- State transitions return new frozen objects.
- Terminal state transitions are explicit.
- Evidence-backed states require evidence identifiers.
- Domain events use JSON-compatible recursively frozen payloads.
- Factories and transitions raise `DomainError`, never untyped string errors.
- Entity files remain below 500 lines.

### Root governance and tooling

Root configuration may reference workspace packages and development tools. It must not contain domain behavior.

## Future direction

```text
apps → runtime-sdk / ui-kit / application / infrastructure
infrastructure → application ports / domain / adapter-protocol
application → domain
contracts → domain types
plugins → plugin-sdk / contracts
adapters → adapter-protocol / external SDK
domain → nothing outside domain
```

Architecture checks must reject every reverse dependency.
