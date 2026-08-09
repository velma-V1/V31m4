# V31M4 Dependency Rules

## Frozen core rules

### `packages/domain`

Allowed:

- ECMAScript language and standard library features
- Files inside `packages/domain/src`
- Type-only and runtime imports between domain entities and value objects

Forbidden:

- Node-specific filesystem, process, networking, worker, or database APIs
- React, Tauri, Fastify, Drizzle, Zod, provider SDKs, or production-tool SDKs
- Imports from `apps`, `packages/contracts`, `packages/application`, `packages/infrastructure`, adapters, plugins, departments, UI, or labs
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
- Imports from runtime, application, infrastructure, adapters, plugins, departments, UI, or laboratories
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
- Imports from runtime, infrastructure, adapters, plugins, departments, UI, or laboratories
- Provider SDKs, database drivers, process APIs, filesystem APIs, network clients, or secret implementations in application source
- Optional transaction parameters on authoritative writes
- Unversioned mutable writes without explicit `WriteCondition`
- Raw provider errors crossing a port boundary
- Long-running operations without `OperationContext` and cancellation semantics
- Direct secret strings retained beyond a bounded secret lease

### Application service rules

- Service source imports only `@v31m4/domain` and application-local files.
- Services are deterministic: no `Date.now()`, no `Math.random()`, no hidden global state. Time enters through inputs or `ClockPort`; seeds enter explicitly.
- Services return frozen decisions and plans; they never persist, publish, or invoke external systems directly.
- Every rejection is a typed application error or an explicit decision result.
- Service internals under `services/internal` are private and never exported from `src/index.ts`.
- Source files remain below 500 lines.

### Application port rules

- Application source defines interfaces and pure shared primitives only.
- Every authoritative repository mutation requires `UnitOfWorkTransaction`.
- Every mutable aggregate write uses `WriteCondition` and returns `Versioned<T>`.
- External execution ports expose provider-neutral request and result types.
- Audit storage is append-only and distinct from policy and approval storage.
- Workspace operations make isolation, sealing, snapshotting, and disposal explicit.
- Source files remain below 500 lines.

### Application use-case rules

- Use cases import only the domain public API and application-local ports, services, and helpers.
- Every authoritative mutation executes through `UnitOfWorkPort`.
- External execution occurs only before or after a committed transaction, never inside one.
- Mutable writes supply the currently read revision; immutable records are appended.
- Authoritative paginated reads consume all pages and reject repeated cursors.
- Approval expiry is inclusive: `expiresAt <= now` is expired.
- Workspace cleanup uses the persisted opaque workspace ID, not a display path.
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

### `packages/infrastructure`

- Source may import only `@v31m4/application`, `@v31m4/domain`, declared infrastructure libraries, and Node infrastructure APIs.
- SQLite writes execute only inside the owning `SqliteRuntimeDatabase` unit of work.
- Mutable records require explicit `WriteCondition`; immutable records are insert-only.
- Outbox writes share the authoritative state transaction.
- Artifact promotion is atomic and hash-verified; backup restore verifies before replacement.
- Layer 8 process/RPC/adapter/scheduling/resource/secret/logging implementations remain infrastructure-owned.
- Layer 9 path/policy/plugin/model/tool/kernel gateway implementations remain infrastructure-owned.
- Layer 10 durable event replay implementation may live here but runtime composition remains under `apps/runtime`.
- Source files remain below 500 lines.
- Semantic rules that JSON Schema cannot express are documented with `$comment` and enforced by `@v31m4/contracts`.

### `apps/runtime`

Allowed:

- Public APIs of frozen-core packages required to compose the authoritative runtime.
- Node runtime APIs needed for the local HTTP surface and lifecycle coordination.

Forbidden:

- Imports from post-core department packages.
- Video/Game-specific business logic or external production-tool SDKs.
- Direct ownership of department-specific state.

Rules:

- Runtime is the authoritative local process and owns composition, session auth, typed command/query/event routes, recovery, replay coordination, and shutdown.
- Optional departments/tools must never be required for runtime startup, core tests, packaging, or release acceptance.

## Post-core department rules

### `packages/department-host`

Purpose: generic removable-department lifecycle and isolation boundary.

Allowed runtime dependencies:

- Public `@v31m4/application` APIs needed for generic lifecycle, plugin registration, unit-of-work, and governed host behavior.
- Public `@v31m4/domain` APIs needed by the generic department host contract/implementation.
- Package-local files and Node APIs required by the host implementation.

Allowed dev/test dependencies:

- `@v31m4/infrastructure` only for tests/support where declared; this is not a production/runtime dependency.

Forbidden:

- Imports from Video or Game department packages.
- Video/Game-specific business logic, model/provider types, or production-tool SDKs.
- Direct SQLite/database ownership outside existing application/infrastructure boundaries.
- Core changes required solely to support one department.

### `plugins/video-production`

Allowed runtime dependencies:

- `@v31m4/application`
- `@v31m4/department-host`
- Node APIs required by plugin-owned real adapters
- External tools/models only behind the plugin's typed adapter interfaces

Forbidden runtime dependencies:

- `@v31m4/infrastructure`
- `@v31m4/game-production`
- Core/database internals
- Provider/tool-specific types leaking across the department's public contracts

Rules:

- Video owns its shot-generation/QC/assembly workflow and adapter implementations.
- Deterministic reference adapters remain the default for normal CI/unit verification.
- Real adapter tests are target-host gated and must report skips honestly when prerequisites are absent.
- External process invocation must use argument arrays or a typed protocol/client boundary; no unescaped shell command construction.

### `plugins/game-production`

Allowed runtime dependencies:

- `@v31m4/application`
- `@v31m4/department-host`
- Node APIs needed by future plugin-owned real adapters
- Summer only behind the existing `AssetAdapter`, `SceneBuildAdapter`, `SceneValidationAdapter`, and `PackageAdapter` boundaries once validated

Forbidden runtime dependencies:

- `@v31m4/infrastructure`
- `@v31m4/video-production`
- Core/database internals
- Summer/Godot/Unreal/Blender-specific types in frozen-core contracts
- A parallel custom Godot agent stack while Summer is the approved primary execution substrate

Rules:

- Game owns its scene acquire/build/validate/repair/package workflow.
- Deterministic reference adapters remain the default for normal CI/unit verification.
- Summer-hosted AI/cloud capabilities are optional and never a core dependency.
- Direct Blender/Unreal adapters and custom Godot orchestration remain out of scope until the Summer path is installed, capability-verified, and target-host validated.

### `apps/departments-integration`

Allowed:

- `@v31m4/department-host`
- Video and Game department public APIs
- Test/integration support required to prove install/start/invoke/remove independence

Forbidden:

- Production business logic ownership
- Making either department a core dependency
- Creating cross-department runtime coupling

Purpose: verify the independence matrix only.

## Current dependency graph

```text
apps/runtime
    ↓
packages/infrastructure
    ↓
packages/application
    ↓
packages/domain

packages/contracts ─────→ packages/domain

packages/department-host ─────→ packages/application + packages/domain
plugins/video-production ─────→ packages/department-host + packages/application
plugins/game-production  ─────→ packages/department-host + packages/application

apps/departments-integration
    ↓
packages/department-host + plugins/video-production + plugins/game-production
```

`packages/department-host` may use `@v31m4/infrastructure` only as a dev/test dependency, never as a runtime source dependency. The frozen core imports no department package. Video and Game do not import one another. Architecture tests must reject reverse dependencies and any post-core dependency that turns an optional department into a core startup requirement.
