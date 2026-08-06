# V31M4

V31M4 is a local-first modular production operating system that coordinates replaceable models, tools, plugins, durable jobs, independent verification, evidence, and controlled self-improvement.

## Repository status

The repository is in **Foundation/Core Layer 1**. The implemented code currently contains only dependency-free domain primitives and repository governance. Runtime services, applications, plugins, adapters, and production workflows are intentionally absent until their prerequisite layers are verified.

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

- `@v31m4/domain`: branded identifiers, SHA-256 content hashes, safe project-relative paths, normalized scores, resource budgets, domain errors, and immutable domain events.
