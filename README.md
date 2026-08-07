# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Application Services Layer 5**. The implemented code contains
repository governance, the immutable domain model, strict external contracts, seven
portable JSON Schemas, the complete infrastructure-free application port boundary, and the
nine deterministic application services built on those ports. Layers 1–5 have been
dependency-backed, regression tested, and put through a four-pass hardening review against
the pinned toolchain: **243 passing cases across 41 test files**, full workspace typecheck
and build pass, **9 services**, **0 explicit `any`** across Layers 1–5 source, and the
largest source file is **468 lines**.
Layer 6 use cases, persistence implementations, runtime interfaces, adapters, plugins,
laboratories, and production workflows remain intentionally absent.

Note: `pnpm lint` still reports pre-existing Biome formatting violations on Layer 1–4 files
that predate any Biome run; those untouched files are deliberately left out of this focused
diff. Every file added or substantively changed for Layer 5 passes `biome ci`.

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

Provides the complete Layer 4 port boundary and the Layer 5 application services.

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

The package imports only the public `@v31m4/domain` API.
