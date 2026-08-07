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
| `/packages/application/src/application-json.ts` | Application core | Safe finite acyclic internal JSON values without contract-layer dependency |
| `/packages/application/src/application-errors.ts` | Application core | Typed orchestration and dependency failures with immutable details |
| `/packages/application/src/operation-context.ts` | Application core | Actor, correlation, idempotency, cancellation, and deadline context |
| `/packages/application/src/port-types.ts` | Application core | Pagination, revisions, health, receipts, and subscriptions |
| `/packages/application/src/ports` | Application boundary | Twenty-seven infrastructure-free persistence, execution, governance, and operations ports |
| `/packages/application/src/services` | Application services | Nine deterministic compute, context, diversity, evidence, champion, improvement, capability, practice, and avatar decision services |
| `/packages/application/src/use-cases` | Application orchestration | Twenty-one transactional project, mission, job, solver, verification, repair, delivery, learning, practice, avatar, plugin, model, and tool use cases |
| `/packages/application/src/index.ts` | Application core | Public application package API only |
| `/packages/application/tests` | Application verification | Runtime primitives, ports, services, public API, dependency boundaries, failure paths, and file-size checks |
| Root configuration | Build governance | Workspace, compiler, lint, test, and build orchestration |

## Current dependency graph

```text
Root tooling
    ↓
packages/application tests
    ↓
packages/application use cases
    ↓
packages/application services and ports
    ↓
packages/application public API ─────→ packages/domain public API

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

`packages/domain` imports no other workspace package. `packages/contracts` imports only the domain public API and Zod. `packages/application` imports only the domain public API.

## Contract ownership

| Contract group | Files | Strict responsibility |
|---|---|---|
| Common boundary | `common.schemas.ts` | Versioning, canonical primitives, safe recursive JSON, request metadata, pagination, and errors |
| Runtime resources | `projects.schemas.ts`, `missions.schemas.ts`, `jobs.schemas.ts`, `evidence.schemas.ts`, `capabilities.schemas.ts` | Authoritative resource command, query, state, evidence, verification, delivery, and promotion payloads |
| Capability endpoints | `models.schemas.ts`, `tools.schemas.ts`, `plugins.schemas.ts`, `practice.schemas.ts`, `avatar.schemas.ts` | Provider-neutral capability discovery, invocation, workflow, practice, and avatar payloads |
| Event stream | `runtime-events.schemas.ts` | Closed, versioned, aggregate-consistent client event union |
| Adapter protocol | `adapter-rpc.schemas.ts` | Closed JSON-RPC requests, notifications, results, and errors |
| Portable schemas | `/schemas/*.schema.json` | External manifest and portable-record validation independent of TypeScript |

## Application port ownership

| Port group | Files | Strict responsibility |
|---|---|---|
| Atomic persistence | `unit-of-work`, project, mission, job, evidence, candidate, capability, workflow, training, practice ports | Transactions, optimistic concurrency, append-only records, and durable aggregate access |
| External execution | artifact, event, model, tool, plugin, kernel, verifier ports | Provider-neutral execution, cancellation, health, artifact integrity, and committed event publication |
| Governance | policy, approval, audit ports | Separate authorization decisions, approval lifecycle, and append-only execution history |
| Operations | scheduler, resource, secret, clock, workspace, configuration, backup ports | Durable scheduling, system readings, bounded secrets, deterministic time, isolation, configuration, and recovery |

## Application service ownership

| Service | Strict responsibility |
|---|---|
| `compute-governor.ts` | Select governed execution depth and bounded resources |
| `context-compiler.ts` | Build deterministic smallest-sufficient context |
| `diversity-planner.ts` | Create materially distinct solver configurations |
| `evidence-linker.ts` | Calculate evidence traceability and criterion coverage |
| `champion-selector.ts` | Select a verified champion, Pareto set, or no solution |
| `improvement-policy.ts` | Permit only material verifiable repair rounds |
| `capability-calculator.ts` | Calculate bounded evidence-backed capability measurements |
| `practice-selector.ts` | Choose safe isolated idle practice |
| `avatar-unlock-engine.ts` | Apply permanent capability-bound evidence unlocks |

## Update rule

Every layer must update this ownership map and the root `repo_map.md` in the same commit. A path may not be added without an owner and one strict responsibility.


## Application use-case ownership

| Use-case group | Strict responsibility |
|---|---|
| Project and planning | Create governed projects, submit immutable missions, and compose execution plans |
| Durable jobs | Start, checkpoint, resume, and stop through durable prepare and finalized outcomes |
| Solver and repair | Create isolated candidates, verify independently, record issues, and apply targeted repairs |
| Delivery and learning | Select champions, deliver verified results, quarantine training, and promote capabilities |
| Practice and progression | Run isolated idle practice and evaluate evidence-backed avatar unlocks |
| External capability governance | Register plugins and invoke models or tools through policy, approvals, and audit |
