# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Domain Entity Layer 2**. The implemented code contains repository governance, dependency-free domain primitives, and the complete immutable domain entity model. Runtime services, application use cases, persistence, interfaces, adapters, plugins, laboratories, and production workflows remain intentionally absent until their prerequisite layers are verified.

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
4. `docs/repository-map.md`
5. `repo_map.md`
6. `AGENTS.md`

## Current implemented package

`@v31m4/domain` now provides:

- Branded durable identifiers
- SHA-256 content hashes
- Safe project-relative paths
- Normalized scores and resource budgets
- Typed domain errors and immutable domain events
- Projects, missions, requirements, jobs, and checkpoints
- Artifacts, evidence, claims, and the Production Twin
- Model, tool, plugin, and capability profiles
- Solver candidates, verification results, issues, and repairs
- Champion decisions and delivery receipts
- Training packets, practice tasks, promotions, and avatar state
