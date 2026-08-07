# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Persistence and Artifacts Layer 7**. The implemented code contains
repository governance, the immutable domain model, strict external contracts, seven
portable JSON Schemas, the complete infrastructure-free application port boundary, and the
nine deterministic services and 21 transactional use cases built on those ports. Layers
1–7 are dependency-backed and regression tested against the pinned toolchain. SQLite
units of work, revisions, durable idempotency/outbox records, content-addressed artifacts,
and verified backup/restore are implemented. Runtime interfaces, adapters, plugins,
laboratories, and production workflows remain intentionally absent.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.17.0

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile=false
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

## Source of truth

Read these files in order before making changes:

1. `docs/repository-specification.md`
2. `docs/architecture.md`
3. `docs/dependency-rules.md`
4. `docs/contract-versioning.md`
5. `docs/repository-map.md`
6. `repo_map.md`
7. `AGENTS.md`

## Implemented packages

### `@v31m4/domain`

Provides branded identifiers, immutable entities, lifecycle invariants, evidence rules, candidate lineage, verification decisions, quarantined learning state, capability profiles, practice tasks, promotions, and avatar state.

### `@v31m4/contracts`

Provides strict Zod schemas and inferred TypeScript payload types for:

- Projects, missions, jobs, checkpoints, artifacts, evidence, and capabilities
- Models, tools, plugins, workflows, idle practice, and the capability avatar
- Client-streamable runtime events
- Adapter and production-kernel JSON-RPC messages
- Exact contract and protocol version checks
- Finite, acyclic, prototype-safe recursive JSON values

## Root JSON Schemas

The `schemas/` directory contains machine-readable draft 2020-12 definitions for adapter manifests, plugin manifests, workflows, evidence records, training packets, capability packages, and achievement rules.

### `@v31m4/application`

Provides the complete Layer 4 port boundary, Layer 5 services, and Layer 6 use cases.

Layer 4 ports:

- Typed application errors and safe internal JSON data
- Immutable operation context with actor, correlation, idempotency, cancellation, and deadlines
- Optimistic-concurrency and versioned-record primitives
- Atomic unit-of-work participation for authoritative writes
- Project, mission, job, evidence, candidate, capability, workflow, and training repositories
- Artifact, event, model, tool, plugin, kernel, and verifier boundaries
- Policy, approvals, audit, scheduling, resources, secrets, clock, workspace, configuration, and backup boundaries

Layer 5 services (deterministic, infrastructure-free decision and planning functions):

- **Compute governor** — execution-depth and budget selection
- **Context compiler** — smallest sufficient deterministic context packages
- **Diversity planner** — materially distinct solver configurations
- **Evidence linker** — traceability, coverage, and evidence-gap detection
- **Champion selector** — verified champion, Pareto set, or no verified solution
- **Improvement policy** — justified refinement/repair decisions
- **Capability calculator** — bounded evidence-backed capability updates
- **Practice selector** — safe isolated practice-task selection
- **Avatar unlock engine** — permanent evidence-backed avatar unlocks

Layer 6 exports 21 use cases covering projects, missions, planning, durable jobs, solver
and verification workflows, issue repair, champion delivery, controlled learning,
practice/avatar progression, plugins, models, and tools.

### `@v31m4/infrastructure`

Provides the Layer 7 SQLite transaction and record substrate, transactional outbox,
durable idempotency store, atomic SHA-256 artifact storage, and verified backup/restore.

The package imports only the public `@v31m4/domain` API.
