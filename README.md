# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Contracts and Schema Layer 3**. The implemented code contains repository governance, dependency-free domain primitives, the complete immutable domain entity model, strict TypeScript runtime contracts, versioned client events, a closed adapter JSON-RPC protocol, and seven draft 2020-12 JSON Schemas. Runtime services, application use cases, persistence, interfaces, adapters, plugins, laboratories, and production workflows remain intentionally absent until their prerequisite layers are verified.

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
