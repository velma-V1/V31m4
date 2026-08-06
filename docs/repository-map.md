# V31M4 Repository Ownership Map

## Current implemented ownership

| Path | Owner | Responsibility |
|---|---|---|
| `/AGENTS.md` | Repository governance | Mandatory human and AI contribution rules |
| `/repo_map.md` | Repository governance | Exact current implementation state |
| `/docs` | Architecture governance | Source-of-truth architecture, versioning, and implementation planning |
| `/schemas` | Contract governance | Portable draft 2020-12 schemas for manifests, workflows, evidence, learning, capabilities, and achievements |
| `/packages/domain/src/value-objects` | Domain core | Canonical validated primitive values |
| `/packages/domain/src/entities` | Domain core | Immutable entities, invariants, decisions, and lifecycle transitions |
| `/packages/domain/src/index.ts` | Domain core | Public domain package API only |
| `/packages/domain/tests` | Domain verification | Layer 1 regression and Layer 2 behavior verification |
| `/packages/contracts/src/common.schemas.ts` | Contract core | Versions, branded primitives, safe JSON, pagination, and API errors |
| `/packages/contracts/src/*-schemas.ts` | Contract core | Strict bounded API, event, workflow, and adapter payload schemas |
| `/packages/contracts/src/index.ts` | Contract core | Public contracts package API only |
| `/packages/contracts/tests` | Contract verification | Runtime contract, protocol, compatibility, JSON Schema, and parity verification |
| Root configuration | Build governance | Workspace, compiler, lint, test, and build orchestration |

## Current dependency graph

```text
Root tooling
    ↓
packages/contracts tests ─────→ root schemas
    ↓
packages/contracts public API
    ↓
packages/domain public API
    ↓
domain entities
    ↓
domain value objects, errors, and events
```

`packages/domain` imports no other workspace package. `packages/contracts` imports only the domain public API and Zod.

## Contract ownership

| Contract group | Files | Strict responsibility |
|---|---|---|
| Common boundary | `common.schemas.ts` | Versioning, canonical primitives, safe recursive JSON, request metadata, pagination, and errors |
| Runtime resources | `projects.schemas.ts`, `missions.schemas.ts`, `jobs.schemas.ts`, `evidence.schemas.ts`, `capabilities.schemas.ts` | Authoritative resource command, query, state, evidence, verification, delivery, and promotion payloads |
| Capability endpoints | `models.schemas.ts`, `tools.schemas.ts`, `plugins.schemas.ts`, `practice.schemas.ts`, `avatar.schemas.ts` | Provider-neutral capability discovery, invocation, workflow, practice, and avatar payloads |
| Event stream | `runtime-events.schemas.ts` | Closed, versioned, aggregate-consistent client event union |
| Adapter protocol | `adapter-rpc.schemas.ts` | Closed JSON-RPC requests, notifications, results, and errors |
| Portable schemas | `/schemas/*.schema.json` | External manifest and portable-record validation independent of TypeScript |

## Update rule

Every layer must update this ownership map and the root `repo_map.md` in the same commit. A path may not be added without an owner and one strict responsibility.
