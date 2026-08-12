# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The frozen core (Layers 1–10) is complete and audited: the immutable domain model, strict
external contracts, seven portable JSON Schemas, the infrastructure-free application port
boundary, nine deterministic services, 21 transactional use cases, SQLite persistence with
durable idempotency/outbox and content-addressed artifacts, supervised process/adapter
infrastructure, governed model/tool/kernel gateways, and the authoritative local runtime
(`apps/runtime`: HTTP command/query routes, resumable SSE event streaming, startup recovery,
checkpoint-safe shutdown).

Post-core, additive work implements a generic removable-department host
(`packages/department-host`) and two removable first-party departments,
`plugins/video-production` and `plugins/game-production`, plus their independence
verification (`apps/departments-integration`). See `docs/current-state.md` and `repo_map.md`
for exact current implementation and verification evidence — this file is a general overview,
not the authoritative state record.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.17.0

The real-browser regression is part of `pnpm test` and `pnpm check`. Prepare Chromium and its host
libraries once on a clean Linux/WSL verification machine:

```bash
pnpm exec playwright install --with-deps chromium
```

This is a development/test prerequisite only; Playwright is not used by runtime startup or
production execution.

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile=false
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

## Running the runtime

```bash
pnpm dev
```

Boots the authoritative runtime (`apps/runtime`) directly from TypeScript source via `tsx`,
no build step required. On first run this creates `runtime-data/` (gitignored) containing the
SQLite database and a generated local dev session token, printed to the terminal along with
the operator URL and example `curl` commands. Reruns reuse the same token and database, so
state (and the session) survives a restart. Stop with `Ctrl-C` for a graceful, checkpoint-safe
shutdown.

`runtime-data/` is local-only; it is never committed. To point at a different location or
port, set `V31M4_DATABASE`, `V31M4_HOST`, `V31M4_PORT`, or `V31M4_ACTOR_ID` before running.

## Source of truth

Read these files in order before making changes:

1. `docs/current-state.md`
2. `repo_map.md`
3. `docs/architecture.md`
4. `docs/repository-map.md`
5. `docs/dependency-rules.md`
6. `docs/contract-versioning.md`
7. `AGENTS.md`

`docs/repository-specification.md` is a frozen baseline design reference, not a current
implementation map — see `docs/current-state.md` for what is actually implemented today.

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
