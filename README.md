# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Application Use Cases Layer 6**. The implemented code contains repository governance, the immutable domain model, strict external contracts, seven portable JSON Schemas, the complete infrastructure-free application port boundary, nine deterministic application decision services, and 21 transactional application use cases. Persistence implementations, runtime interfaces, adapters, plugins, laboratories, and production workflows remain intentionally absent until their prerequisite layers are verified.

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

Provides the complete Layer 4 boundary, Layer 5 decision services, and Layer 6 orchestration:

- Typed application errors and safe internal JSON data
- Immutable operation context with actor, correlation, idempotency, cancellation, and deadlines
- Optimistic-concurrency and versioned-record primitives
- Atomic unit-of-work participation for authoritative writes
- Project, mission, job, evidence, candidate, capability, workflow, and training repositories
- Artifact, event, model, tool, plugin, kernel, and verifier boundaries
- Policy, approvals, audit, scheduling, resources, secrets, clock, workspace, configuration, and backup boundaries
- Compute governance, context compilation, solver diversity, evidence linking, champion selection, improvement policy, capability calculation, practice selection, and avatar unlock evaluation
- Policy-gated projects and missions, durable job control, solving, verification, repair, delivery, controlled learning, idle practice, avatar evaluation, plugin registration, and governed model/tool invocation

The package imports only the public `@v31m4/domain` API.
