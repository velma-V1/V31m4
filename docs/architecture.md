# V31M4 Architecture

**Specification:** `V31M4-SRS-001`  
**Baseline:** `1.0.0`

V31M4 is a local-first modular monolith with Clean Architecture dependency direction, hexagonal ports, isolated external adapters, durable event-driven orchestration, and removable production plugins.

## Dependency direction

```text
Interface applications
        ↓
Runtime SDK and versioned contracts
        ↓
Application use cases and ports
        ↓
Domain entities and value objects

Infrastructure implements application ports.
Adapters implement the versioned adapter protocol.
Plugins register bounded capabilities through the generic department/plugin host and existing application contracts.
Laboratories remain isolated from production state.
```

Dependencies always point toward the domain. The domain package has no runtime, infrastructure, adapter, plugin, UI, provider, filesystem, process, network, database, or schema-library dependencies.

## State authority

The authoritative runtime process owns project, mission, job, evidence, checkpoint, artifact, capability, promotion, and avatar state. Interfaces may cache and display that state but never own it.

## Domain authority

Layer 2 establishes immutable domain state and transition rules before persistence or orchestration exists. Domain factories validate all externally supplied values. Transition functions return new frozen state and never mutate prior state. Illegal lifecycle movement raises typed domain errors.

Job lifecycle transitions also produce immutable domain events. Models, adapters, tools, and interfaces cannot directly alter domain state.

## Contract authority

Layer 3 establishes the only supported external shapes for runtime APIs, event streams, adapter messages, plugin manifests, workflows, evidence, training packets, capability packages, and avatar achievements.

Contract rules:

- Every bounded object rejects unknown properties.
- Every API request carries exact contract version `1.0.0` and a request identifier.
- Every adapter message uses JSON-RPC `2.0` and protocol version `1.0.0` where negotiation occurs.
- Durable identifiers are validated by the domain package rather than reimplemented.
- Timestamps use canonical UTC ISO-8601 with milliseconds.
- Recursive JSON values must be finite, acyclic, plain-object based, and free of prototype-pollution keys.
- Runtime events form a closed discriminated union and their aggregate envelope must match the typed payload identifier.
- Provider SDK request and response types cannot cross the model or tool gateway boundary.
- Root JSON Schemas are independently compilable draft 2020-12 documents with versioned schema IDs.
- TypeScript and JSON manifest schemas share parity tests for overlapping contracts.

## Application boundary authority

Layer 4 defines the only supported interfaces through which application services may access persistence, artifacts, events, external models, production tools, plugins, kernels, verification, policy, scheduling, resources, secrets, isolated workspaces, configuration, approvals, audit history, and backups.

Application rules:

- `@v31m4/application` imports only the public `@v31m4/domain` API and application-local files.
- External API and adapter payload schemas remain in `@v31m4/contracts`; they are translated at runtime boundaries rather than imported into the application core.
- Every long-running or external call receives an immutable `OperationContext` carrying actor identity, correlation, idempotency, cancellation, and an optional deadline.
- Every authoritative write participates in a `UnitOfWorkTransaction`.
- Mutable records use explicit optimistic-concurrency `WriteCondition` values and return `Versioned<T>`.
- Missions, evidence, candidates, repairs, promotions, audit records, and other immutable records are append-only.
- Models, tools, and kernels expose provider-neutral results and explicit cancellation.
- Secrets are accessed through bounded leases rather than retained as long-lived values.
- Candidate, repair, tool, practice, and verification work occurs through explicit isolated-workspace handles.
- Policy decisions, approval records, and audit records are separate boundaries so authorization cannot be inferred from logging or vice versa.

## Application services authority

Layer 5 implements the deterministic application services that turn domain state and
Layer 4 ports into decisions and plans. Services own orchestration logic; they do not own
side effects.

Application service rules:

- Service source imports only the public `@v31m4/domain` API and application-local files.
- Services are deterministic for identical inputs: no hidden clock, no hidden randomness. Time enters through inputs or `ClockPort`; random seeds enter explicitly.
- Services return immutable decisions and plans. They never persist, never publish events, and never invoke models or tools directly; external effects go through Layer 4 ports.
- Every rejection is a typed application error or an explicit decision result.
- Models may not certify their own work. Model confidence and model size are never treated as evidence or as a proxy for quality.
- Original candidates, artifacts, evidence, checkpoints, and permanent unlocks are never overwritten; practice evidence is isolated from production.

The nine services are: compute governor, context compiler, diversity planner, evidence
linker, champion selector, improvement policy, capability calculator, practice selector,
and avatar unlock engine.

## Application use-case authority

Layer 6 coordinates the 21 canonical production use cases plus two focused approval-lifecycle use
cases through Layer 4 ports and Layer 5 services. Authoritative mutations occur inside units of work and publish their domain
events through the transactional event boundary. Mutable records use current revisions;
immutable records remain append-only. External model, tool, verifier, workspace, and
kernel calls never run inside an authoritative transaction. Job operations use explicit
prepare, invoke, and finalize-or-fail phases. Authoritative collection decisions consume
all pages and fail on repeated cursors. Exact-expiry approvals are expired, and idle
practice persists the opaque workspace identity used for cleanup.

Approval governance remains selective rather than being added indiscriminately to unrelated use
cases. A protected action first creates a durable request through `requestApproval`; an authorized
actor grants or denies it through `decideApproval`; and the existing authorization path validates
current policy, action, resource, requester, context, scope, status, and expiry before consuming it.
Consumption, the protected authoritative effect, and approval/audit records share one transaction.

## Persistence and artifact authority

Layer 7 implements the application persistence boundary with SQLite, ordered migrations,
serialized units of work, optimistic record revisions, append-only records, durable
idempotency outcomes, and a transactional outbox. Content-addressed artifacts are written
atomically and rehashed after promotion. Verified online backups restore through a staged
replacement and reopen with mandatory pragmas. External execution is prohibited while a
SQLite transaction is active.

## Supervised adapter authority

Layer 8 runs adapters as supervised child processes behind bounded newline-delimited JSON-RPC.
Timeouts, cancellation, framing/output limits, restart budgets, process cleanup, leased secrets,
and structured-log redaction are host-enforced. Adapter-facing code cannot own SQLite state or
retain secret-store implementation access.

The optional local execution composition uses this authority directly: three distinct lazy child
processes provide loopback Ollama inference, an allowlisted contained production kernel, and an
independent deterministic verifier. Parent environment inheritance is explicit and allowlisted;
adapter staging is non-authoritative until runtime-owned bridges promote it through the existing
artifact/evidence ports.

## Governed production-gateway authority

Layer 9 implements real-path containment, fail-closed policy evaluation, durable plugin
registration, and supervised provider-neutral model/tool/production-kernel gateways. Provider and
tool specifics remain behind gateway boundaries; application and domain types stay vendor-neutral.

## Authoritative runtime authority

Layer 10 is the authoritative local runtime under `apps/runtime`. It owns validated composition,
local session authentication, typed command/query/event routes, idempotent external-command
execution, durable committed-event replay, resumable event streaming, startup recovery, and
checkpoint-safe shutdown. The implemented event transport is SSE over `node:http`; replay and
resume semantics remain transport-agnostic.

The runtime exposes only typed mutation commands. A generic record-write transport is forbidden:
it would bypass application invariants and could manufacture governance state. Generic authenticated
record reads remain a non-mutating observation path; authoritative collection queries are
relationship-scoped and filter before pagination.

Execution composition is explicit. `hermetic_reference` is the default and keeps core startup
independent of optional local services. `supervised_local` binds the existing provider-neutral
ports/gateways to the local supervised children for the retained `stage4.tiny-code` workflow and
the strict project-owned `software.production.v1` build-packet workflow. The latter prepares a
contained isolated working copy, accepts only a bounded change manifest, and derives acceptance
from packet-declared independent Node verification. Failed software candidates may enter a bounded
evidence-driven repair loop: existing issue/repair use cases create immutable lineage, each repair
effect receives its own durable kernel checkpoint, and distinct focused/regression verifier
evidence is required before champion selection. Both profiles enter the same application use
cases and authoritative repositories; the profile does not create a second state authority or
allow an adapter to reach SQLite.

## Verification authority

Models may propose solutions, critiques, claims, and repairs. Models may not certify their own work. Acceptance requires independent deterministic evidence whenever deterministic verification is available.

The implemented system enforces:

- Evidence records are immutable and artifact-backed.
- Verified checkpoints require evidence.
- Mandatory verification failures prevent a passing result.
- Missing mandatory checks produce an inconclusive result.
- Champion delivery requires complete mandatory and requirement coverage.
- Training data begins quarantined and cannot be promoted before verification.
- Avatar unlock records require immutable evidence.
- Mission submissions cover every mandatory criterion with explicit evidence requirements.
- Workflow stages reference known dependencies and form an acyclic graph.
- Plugin required and optional tool sets are disjoint.
- API, event, and RPC messages cannot silently accept unsupported fields or versions.

## Current implemented boundary

The frozen V31M4 core implements Layers 1–10:

- Layers 1–2: immutable domain primitives/entities and invariants.
- Layer 3: strict versioned runtime/contracts and portable JSON Schemas.
- Layers 4–6: application ports, deterministic services, and 21 transactional use cases.
- Layer 7: SQLite persistence, transactional outbox/idempotency, content-addressed artifacts, and backup/restore.
- Layer 8: supervised process/RPC/adapter/scheduling/resource/secret/logging infrastructure.
- Layer 9: governed path/policy/plugin/model/tool/kernel gateways.
- Layer 10: authoritative local runtime with durable replay/recovery and resumable event streaming.

The audited L1–10 product-code baseline is frozen at `78dc2b7`; later work is additive post-core
unless an explicitly approved core correction is required.

Post-core, V31M4 also implements:

- `packages/department-host`: generic removable department lifecycle/isolation/rollback host.
- `plugins/video-production`: removable Video Production department. Its real ffmpeg
  `AssemblyAdapter` and ffmpeg+Ollama `VisionQcAdapter` are target-host validated; its real
  `ShotGenerationAdapter` remains pending.
- `plugins/game-production`: removable 3D/Game Production department with deterministic reference
  adapters and existing `AssetAdapter` / `SceneBuildAdapter` / `SceneValidationAdapter` /
  `PackageAdapter` boundaries.
- `apps/departments-integration`: department-independence integration verification.

The Game department's approved real execution-platform direction is Summer behind the existing
Game adapter boundaries (`Game ports -> Summer adapter -> Summer MCP/CLI -> Summer Engine/Godot`).
No Summer adapter is implemented yet, Summer-hosted services are optional, and direct
Blender/Unreal/custom-Godot agent stacks are out of scope until Summer is installed and validated.
See `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`.

Desktop, CLI, laboratories, additional first-party production plugins/workflows, outbox
retention/pruning, Video's real generation adapter, and Game's real Summer-backed adapters remain
outside the implemented boundary unless separately recorded as complete in current-state evidence.

## Core completion scope — historical decision and preserved invariant

Video Production and 3D/Game Production were intentionally deferred until after L1–10 core
completion. That sequencing decision is **resolved**: both department shells are now implemented as
post-core removable first-party plugins. The historical designs remain under
`docs/deferred/video-production/` and `docs/deferred/game-production/`.

The permanent architectural invariant is unchanged:

- Core startup, tests, packaging, and release acceptance must succeed with both departments absent.
- The core exposes only generic extension seams required by removable departments.
- Video-specific and game-specific business logic, SDKs, executables, provider choices, asset pipelines, and workflow logic stay outside core packages.
- Optional production tools and hosted services are never core startup dependencies.
- Open Generative AI is not a V31M4 core dependency; it may be evaluated only for optional reuse inside Video Production.
- Summer is not a core dependency; Game consumes it only through the Game department's replaceable adapter boundary once validated.
