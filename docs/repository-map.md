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
| `/packages/application/src/ports` | Application boundary | Twenty-six infrastructure-free persistence, execution, governance, and operations ports |
| `/packages/application/src/services` | Application services | Nine deterministic, infrastructure-free decision and planning services (Layer 5) |
| `/packages/application/src/services/internal` | Application services | Private deterministic helpers (fingerprint, canonical stringify, seeded RNG); never exported |
| `/packages/application/src/use-cases` | Application use cases | Twenty-one transactional orchestration entrypoints and private pagination/authorization helpers |
| `/packages/application/src/index.ts` | Application core | Public application package API only (ports and services) |
| `/packages/application/tests/use-cases` | Application verification | Layer 6 correctness, failure, pagination, approval, workspace, and orchestration tests |
| `/packages/application/tests` | Application verification | Runtime primitives, public API, transaction requirements, dependency boundaries, file-size checks, services, and use cases |
| `/packages/contracts/src/forbidden-key-guard.ts` | Contract core | Prototype-pollution property-name guard for external message boundaries |
| Root configuration | Build governance | Workspace, compiler, lint, test, and build orchestration |
| `/packages/infrastructure/src/database` | Persistence infrastructure | SQLite authority, migrations, revisions, records, and durable idempotency |
| `/packages/infrastructure/src/events` | Event infrastructure | Ordered transactional outbox and publication state |
| `/packages/infrastructure/src/artifacts` | Artifact infrastructure | Atomic SHA-256 content-addressed artifact storage |
| `/packages/infrastructure/src/backup` | Recovery infrastructure | Verified SQLite backup manifests and staged restore |
| `/packages/infrastructure/tests` | Infrastructure verification | Real SQLite, concurrency, rollback, outbox, artifact, backup, and architecture tests |

## Current dependency graph

```text
Root tooling
    ↓
packages/application tests
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
| Runtime resources | `projects.schemas.ts`, `missions.schemas.ts`, `jobs.schemas.ts`, `evidence.schemas.ts`, `capabilities.schemas.ts`, `learning.schemas.ts` | Authoritative resource command, query, state, evidence, verification, delivery, promotion, training-packet, and capability-profile payloads |
| Capability endpoints | `models.schemas.ts`, `tools.schemas.ts`, `plugins.schemas.ts`, `practice.schemas.ts`, `avatar.schemas.ts` | Provider-neutral capability discovery, invocation, workflow, practice, and avatar payloads |
| Event stream | `runtime-events.schemas.ts` | Closed, versioned, aggregate-consistent client event union |
| Adapter protocol | `adapter-rpc.schemas.ts` | Closed JSON-RPC requests, notifications, results, and errors |
| Portable schemas | `/schemas/*.schema.json` | External manifest and portable-record validation independent of TypeScript |

## Application port ownership

| Port group | Files | Strict responsibility |
|---|---|---|
| Atomic persistence | `unit-of-work`, project, mission, job, evidence, candidate, capability, workflow, training ports | Transactions, optimistic concurrency, append-only records, and durable aggregate access |
| External execution | artifact, event, model, tool, plugin, kernel, verifier ports | Provider-neutral execution, cancellation, health, artifact integrity, and committed event publication |
| Governance | policy, approval, audit ports | Separate authorization decisions, approval lifecycle, and append-only execution history |
| Operations | scheduler, resource, secret, clock, workspace, configuration, backup ports | Durable scheduling, system readings, bounded secrets, deterministic time, isolation, configuration, and recovery |

## Application service ownership

| Service | File | Strict responsibility |
|---|---|---|
| Compute governor | `compute-governor.ts` | Select execution depth and a clamped budget; refuse or defer when resources, deadline, or verification make a safe selection impossible |
| Context compiler | `context-compiler.ts` | Build the smallest sufficient deterministic context; preserve mandatory material; report omissions and a fingerprint |
| Diversity planner | `diversity-planner.ts` | Generate materially distinct seeded solver configurations within budget |
| Evidence linker | `evidence-linker.ts` | Link records; compute coverage; surface orphan, wrong-subject, missing, and conflicting evidence |
| Champion selector | `champion-selector.ts` | Select a verified champion, a Pareto set, or no verified solution using verified metrics only |
| Improvement policy | `improvement-policy.ts` | Decide whether a concrete, verifiable, material repair round is justified; report remaining risk |
| Capability calculator | `capability-calculator.ts` | Compute bounded evidence-backed capability updates with difficulty and recency weighting |
| Practice selector | `practice-selector.ts` | Select a safe, isolated practice task for a weak capability, or none |
| Avatar unlock engine | `avatar-unlock-engine.ts` | Apply permanent evidence-backed unlocks; reject claims and unverified practice; preserve prior unlocks |

## Application use-case ownership

`packages/application/src/use-cases` owns project/mission planning, durable job lifecycle,
solver/verification/repair, champion/delivery/training/promotion, practice/avatar, plugin
registration, and governed model/tool invocation. Exact reconciliation decisions are in
`docs/reviews/layer-6-reconciliation-matrix.md`.

## Update rule

Every layer must update this ownership map and the root `repo_map.md` in the same commit. A path may not be added without an owner and one strict responsibility.
