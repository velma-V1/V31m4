# V31M4 Repository Specification Blueprint

**Specification ID:** `V31M4-SRS-001`  
**Architecture baseline:** `1.0.0`  
**Status:** Frozen repository-structure baseline  
**Scope:** Repository architecture, boundaries, file tree, interfaces, build order, and verification requirements  
**Excluded:** Application implementation, generated assets, model weights, production prompts, and executable business logic

---

# 1. ARCHITECTURAL MANIFESTO & RULES

## 1.1 System classification

V31M4 shall be implemented as a **local-first modular monolith with Clean Architecture boundaries, hexagonal adapters, durable event-driven orchestration, and isolated plugin and tool workers**.

The system has four replaceable surfaces:

```text
Desktop Interface
        ↓
Authoritative Runtime
        ↓
Application and Domain Core
        ↓
Adapters, Plugins, Models, Tools, and Laboratories
```

### Layer responsibilities

| Layer | Strict responsibility |
|---|---|
| Desktop interface | Displays runtime state and submits typed commands only. |
| Runtime API | Validates commands, streams events, and owns lifecycle coordination. |
| Application layer | Coordinates use cases and workflows through ports. |
| Domain layer | Defines entities, invariants, state transitions, and decisions. |
| Infrastructure layer | Implements persistence, artifacts, events, processes, scheduling, and gateways. |
| Adapter layer | Connects replaceable external models, tools, and production kernels. |
| Plugin layer | Adds bounded production capabilities without modifying core modules. |
| Laboratory layer | Runs quarantined model-expansion and training experiments. |

## 1.2 Process architecture

V31M4 shall use three primary process classes:

```text
┌─────────────────────────────────────────────┐
│ Desktop Process                             │
│ Tauri shell + React dashboard               │
│ Non-authoritative interface state only      │
└──────────────────────┬──────────────────────┘
                       │ Typed local HTTP API
                       │ WebSocket event stream
┌──────────────────────▼──────────────────────┐
│ Runtime Process                             │
│ Authoritative projects, jobs, evidence,     │
│ checkpoints, plugins, routing, and policies │
└──────────────────────┬──────────────────────┘
                       │ JSON-RPC 2.0
                       │ stdio or local socket
┌──────────────────────▼──────────────────────┐
│ Adapter and Plugin Workers                  │
│ Models, tools, production applications,     │
│ verifiers, kernels, and experiments         │
└─────────────────────────────────────────────┘
```

### Authority rules

1. The runtime process owns all authoritative project state.
2. The dashboard never owns authoritative project state.
3. Plugins and adapters never access runtime persistence directly.
4. Every state-changing action enters through an application use case.
5. Every accepted state change emits an immutable domain event.
6. Every externally meaningful result produces evidence.
7. Every long-running operation produces recoverable checkpoints.
8. Models may propose claims but may not certify their own claims.

## 1.3 Exact technology stack

### Repository and build system

| Concern | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Build orchestration | Turborepo |
| Primary language | TypeScript |
| Desktop-native language | Rust |
| Tool scripting | Python |
| TypeScript formatting/linting | Biome |
| Python formatting/linting | Ruff |
| Rust formatting | rustfmt |
| Type checking | TypeScript strict mode, mypy, cargo check |
| Git hooks | Lefthook |

### Desktop interface

| Concern | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| UI framework | React |
| Build tool | Vite |
| Server-state synchronization | TanStack Query |
| Ephemeral UI state | Zustand |
| Runtime validation | Zod |
| Routing | React Router |
| Component tests | Vitest + Testing Library |
| End-to-end tests | Playwright |

### Authoritative runtime

| Concern | Technology |
|---|---|
| Runtime platform | Node.js |
| Language | TypeScript |
| Local API | Fastify |
| Event transport | WebSocket |
| Runtime schemas | Zod |
| Structured logging | Pino JSON |
| Durable database | SQLite |
| Database mapping | Drizzle ORM |
| Durable event propagation | Transactional outbox |
| Artifact storage | Content-addressed filesystem |
| Artifact hashing | SHA-256 |
| Adapter protocol | JSON-RPC 2.0 |
| Adapter transport | stdio first, local socket second |
| Telemetry | OpenTelemetry-compatible internal events |

### Python workers

| Concern | Technology |
|---|---|
| Runtime | Python |
| Schema validation | Pydantic |
| Testing | pytest |
| Linting | Ruff |
| Type checking | mypy |
| Process protocol | JSON-RPC 2.0 |

### Verification

| Verification type | Tool |
|---|---|
| TypeScript unit/integration | Vitest |
| Desktop integration | Playwright |
| Python adapter tests | pytest |
| Rust tests | cargo test |
| Dependency boundaries | dependency-cruiser |
| Property testing | fast-check |
| Mutation testing | Stryker |
| Schema compatibility | JSON Schema validation |
| Performance | Dedicated benchmark harness |

## 1.4 Permanent core modules

The core runtime permanently contains:

1. Mission Contract
2. Project Runtime
3. Durable Job Runtime
4. Evidence Graph
5. Universal Production Twin
6. Compute Governor
7. Context Compiler
8. Diverse Solver Forge
9. Candidate Vault
10. Verifier Mesh
11. Issue Graph
12. Targeted Repair Engine
13. Champion Gate
14. Verified Delivery
15. Learning Forge
16. Capability Atlas
17. Idle Practice Sandbox
18. Earned Capability Avatar
19. Model Gateway
20. Tool Gateway
21. Plugin Runtime
22. Production Kernel Gateway
23. Resource Governor
24. Approval and Policy Engine

## 1.5 First-party production plugins

The following remain outside the core runtime and must be removable:

1. Software Production
2. Visual Intelligence
3. 2D and Graphic Production
4. 3D and Game Production
5. Farming Simulator 25 Mod Forge
6. Video Production
7. Audio Production
8. Research Intelligence
9. WorldMonitor

## 1.6 Dependency direction

Allowed direction:

```text
apps
  ↓
runtime-sdk / ui-kit / application / infrastructure
  ↓
application
  ↓
domain

contracts → domain types
infrastructure → application ports + domain + adapter protocol
plugins → plugin SDK + contracts
adapters → adapter protocol + external SDK
labs → promoted training packets + isolated experiment libraries
```

Forbidden direction:

```text
domain          ✕→ application or infrastructure
application     ✕→ apps, plugins, or adapter implementations
plugins         ✕→ infrastructure internals
adapters        ✕→ runtime database
apps/desktop    ✕→ runtime database or domain implementations
```

## 1.7 Absolute NEVER rules

1. **NEVER place business logic in React components.**
2. **NEVER allow the dashboard to become the source of project truth.**
3. **NEVER allow UI code to access SQLite, artifact storage, model SDKs, or tool processes.**
4. **NEVER allow plugins or adapters to access the runtime database directly.**
5. **NEVER bypass application use cases for state-changing actions.**
6. **NEVER import another package's internal files.**
7. **NEVER create circular dependencies.**
8. **NEVER let a model certify its own work as correct.**
9. **NEVER promote training data without independent verification.**
10. **NEVER place evaluation or hidden-test data inside training stores.**
11. **NEVER permit untyped messages across process boundaries.**
12. **NEVER expose provider-specific SDK types to the domain layer.**
13. **NEVER spawn external tools outside the Tool Gateway or Process Supervisor.**
14. **NEVER call model providers outside the Model Gateway.**
15. **NEVER call the production kernel outside the Production Kernel Port.**
16. **NEVER hard-code installed application paths.**
17. **NEVER hard-code model versions inside workflow logic.**
18. **NEVER make an optional production tool a core startup dependency.**
19. **NEVER use GUI automation when a stable native API, Python API, CLI, or file protocol exists.**
20. **NEVER overwrite original candidate responses or artifacts.**
21. **NEVER overwrite a verified checkpoint.**
22. **NEVER mutate accepted evidence records.**
23. **NEVER continue refinement for wording-only changes.**
24. **NEVER treat model confidence, popularity, or parameter count as verification.**
25. **NEVER add GitHub Models as a provider.**
26. **NEVER place WorldMonitor inside the core runtime.**
27. **NEVER allow idle practice to write directly to promoted capability stores.**
28. **NEVER allow model-expansion experiments to execute inside the production runtime.**
29. **NEVER write directly into an original production asset.**
30. **NEVER merge a change that violates the architecture dependency graph.**

## 1.8 State rules

### Authoritative durable state

- Projects
- Missions
- Requirements
- Jobs
- Checkpoints
- Artifacts
- Evidence
- Claims
- Candidate lineage
- Verification results
- Issues
- Repairs
- Champion decisions
- Capability profiles
- Training packets
- Promotion records
- Avatar unlocks
- Plugin registrations
- Tool and model profiles

### Non-authoritative temporary state

- Open panel
- Selected tab
- Window dimensions
- Unsaved text input
- Local filters
- Hover and animation state
- Temporary preview zoom

Zustand may contain only non-authoritative state. TanStack Query may cache authoritative state but may never become its source.

## 1.9 File rules

1. Each source file has one primary responsibility.
2. Source files should remain below 400 lines.
3. Source files above 500 lines fail architecture verification.
4. Package root `index.ts` files export public APIs only.
5. Internal directories do not use barrel files.
6. Cross-package imports use package aliases.
7. Runtime schemas live in `packages/contracts`.
8. Domain invariants live in domain entities and value objects.
9. External side effects occur only in infrastructure or adapters.
10. Generated files must be clearly marked and never edited manually.

## 1.10 AI context maintenance rule

`/AGENTS.md` must contain this exact instruction:

> Before changing, adding, moving, renaming, or deleting any repository file, read `/docs/architecture.md`, `/docs/repository-map.md`, `/docs/dependency-rules.md`, and the nearest module README. Do not infer architecture from implementation alone. If implementation conflicts with the architecture documents, stop and report the conflict before modifying files.

Future models must also:

1. Read the current architecture version.
2. Locate the owning module.
3. Confirm allowed dependencies.
4. Reuse existing interfaces before creating new ones.
5. Update architecture documentation in the same pull request when structure changes.
6. Run architecture tests before declaring completion.
7. Never create a parallel abstraction for an existing capability.

---

# 2. DETERMINISTIC DIRECTORY TREE

Every listed file has exactly one responsibility. Files not listed require an architecture update before creation.

```text
v31m4/
├── AGENTS.md                                  // Mandatory human and AI operating rules.
├── README.md                                  // Repository purpose, setup commands, and navigation only.
├── package.json                               // Root workspace scripts and development dependencies.
├── pnpm-lock.yaml                             // Locked JavaScript dependency graph.
├── pnpm-workspace.yaml                        // Workspace package declarations.
├── turbo.json                                 // Build, test, lint, and cache pipelines.
├── tsconfig.base.json                         // Strict shared TypeScript settings and aliases.
├── biome.json                                 // TypeScript and JSON formatting/linting rules.
├── vitest.workspace.ts                        // Registers TypeScript test projects.
├── playwright.config.ts                       // Desktop and runtime end-to-end configuration.
├── pyproject.toml                             // Shared Python lint, test, and type configuration.
├── Cargo.toml                                 // Root Rust workspace.
├── rust-toolchain.toml                        // Pinned Rust toolchain.
├── lefthook.yml                               // Pre-commit and pre-push verification.
├── .env.example                               // Supported environment variables without secrets.
├── .editorconfig                              // Editor-neutral whitespace rules.
├── .gitattributes                             // Text normalization and binary handling.
├── .gitignore                                 // Generated output, caches, secrets, and runtime state exclusions.
│
├── .github/
│   ├── CODEOWNERS                             // Required reviewers by repository area.
│   ├── pull_request_template.md               // Architecture, evidence, and migration disclosure template.
│   └── workflows/
│       ├── ci.yml                             // Lint, type check, unit test, and build workflow.
│       ├── architecture.yml                   // Dependency, file-size, schema, and forbidden-import checks.
│       ├── e2e.yml                            // Runtime, desktop, recovery, and critical workflow tests.
│       └── adapters.yml                       // Adapter contract-test workflow.
│
├── docs/
│   ├── repository-specification.md            // Absolute repository source of truth.
│   ├── architecture.md                        // Authoritative architecture and dependency direction.
│   ├── repository-map.md                      // Package, application, adapter, plugin, and lab ownership map.
│   ├── dependency-rules.md                    // Allowed and forbidden imports.
│   ├── glossary.md                            // Canonical V31M4 terminology.
│   ├── state-model.md                         // Authoritative, cached, temporary, and immutable state.
│   ├── data-flow.md                           // Command, event, evidence, artifact, and verification flows.
│   ├── runtime-state-machines.md              // Project, mission, job, candidate, verification, and promotion states.
│   ├── evidence-policy.md                     // Evidence creation, immutability, provenance, and retention.
│   ├── verification-policy.md                 // Deterministic checks and judgment boundaries.
│   ├── adapter-protocol.md                    // JSON-RPC methods, errors, lifecycle, and transport.
│   ├── plugin-system.md                       // Plugin isolation, registration, activation, and capability exposure.
│   ├── model-routing.md                       // Model profiles, routing, escalation, and provider independence.
│   ├── tool-routing.md                        // Tool discovery, selection, execution, and verification.
│   ├── self-improvement.md                    // Training packets, quarantine, promotion, and regression rules.
│   ├── idle-practice.md                       // Idle detection, resource safety, practice selection, and stopping.
│   ├── capability-avatar.md                   // Evidence-backed avatar unlock and anti-gaming rules.
│   ├── security-boundaries.md                 // Permissions, paths, secrets, and process isolation.
│   ├── domains/
│   │   ├── software-production.md             // Repository and application production capabilities.
│   │   ├── visual-intelligence.md             // Scene understanding, continuity, ranking, and visual repair.
│   │   ├── fs25-mod-forge.md                  // FS25 creation, conversion, repair, testing, and packaging.
│   │   ├── video-production.md                // Video creation, acceleration, verification, and recovery.
│   │   ├── audio-production.md                // Audio arrangement, synchronization, and verification.
│   │   └── research-intelligence.md           // Source retrieval, claim tracking, and evidence-backed research.
│   └── adr/
│       ├── 0001-modular-monolith.md           // Records modular-monolith selection.
│       ├── 0002-runtime-authority.md          // Records runtime ownership of authoritative state.
│       ├── 0003-sqlite-artifact-store.md      // Records SQLite plus content-addressed storage.
│       ├── 0004-adapter-isolation.md          // Records out-of-process adapter isolation.
│       ├── 0005-plugin-boundaries.md          // Records production domains as removable plugins.
│       └── 0006-verification-authority.md     // Records verification as final authority.
│
├── schemas/
│   ├── adapter-manifest.schema.json           // Validates model, tool, and kernel adapter manifests.
│   ├── plugin-manifest.schema.json            // Validates plugin identity, permissions, and capabilities.
│   ├── workflow.schema.json                   // Validates declarative workflow definitions.
│   ├── evidence-record.schema.json            // Validates persisted evidence records.
│   ├── training-packet.schema.json            // Validates quarantined and promoted training packets.
│   ├── capability-package.schema.json         // Validates reusable capability packages.
│   └── achievement-rule.schema.json           // Validates avatar achievement rules.
│
├── apps/
│   ├── runtime/
│   │   ├── package.json                       // Runtime-only dependencies and scripts.
│   │   ├── tsconfig.json                      // Runtime TypeScript configuration.
│   │   └── src/
│   │       ├── main.ts                        // Starts the authoritative runtime process.
│   │       ├── bootstrap.ts                   // Ordered initialization and recovery.
│   │       ├── composition-root.ts            // Constructs services, ports, and infrastructure adapters.
│   │       ├── runtime-config.ts              // Loads and validates runtime configuration.
│   │       ├── shutdown.ts                    // Checkpoint-safe graceful shutdown.
│   │       └── api/
│   │           ├── server.ts                  // Configures the local Fastify API only.
│   │           ├── auth.ts                    // Validates local runtime sessions.
│   │           ├── error-mapper.ts            // Maps application errors to typed API errors.
│   │           ├── event-stream.ts            // Streams committed events to clients.
│   │           └── routes/
│   │               ├── health.routes.ts       // Runtime readiness and health.
│   │               ├── projects.routes.ts     // Project commands and queries.
│   │               ├── missions.routes.ts     // Mission submission and state.
│   │               ├── jobs.routes.ts         // Job lifecycle commands and queries.
│   │               ├── evidence.routes.ts     // Immutable evidence queries.
│   │               ├── capabilities.routes.ts // Capability and promotion state.
│   │               ├── models.routes.ts       // Model adapter state and profiles.
│   │               ├── tools.routes.ts        // Tool availability and capabilities.
│   │               ├── plugins.routes.ts      // Plugin lifecycle state.
│   │               ├── practice.routes.ts     // Idle-practice controls and state.
│   │               └── avatar.routes.ts       // Avatar state and unlock history.
│   │
│   ├── desktop/
│   │   ├── package.json                       // Dashboard dependencies and scripts.
│   │   ├── tsconfig.json                      // Dashboard TypeScript configuration.
│   │   ├── vite.config.ts                     // Dashboard build configuration.
│   │   ├── index.html                         // Single dashboard HTML entrypoint.
│   │   ├── src/
│   │   │   ├── main.tsx                       // Mounts the React application.
│   │   │   ├── app/App.tsx                    // Composes routes and providers only.
│   │   │   ├── app/routes.tsx                 // Route-to-screen mappings.
│   │   │   ├── app/providers.tsx              // Query, runtime, error, and theme providers.
│   │   │   ├── screens/DashboardScreen.tsx    // System summary and current work.
│   │   │   ├── screens/ProjectScreen.tsx      // Durable project state.
│   │   │   ├── screens/JobScreen.tsx          // Job progress, evidence, logs, and checkpoints.
│   │   │   ├── screens/CapabilitiesScreen.tsx // Measured capabilities and promotions.
│   │   │   ├── screens/ToolsScreen.tsx        // Tool availability and discovery.
│   │   │   ├── screens/ModelsScreen.tsx       // Model adapters and profiles.
│   │   │   ├── screens/PluginsScreen.tsx      // Plugin state and controls.
│   │   │   ├── screens/PracticeScreen.tsx     // Idle-practice state and controls.
│   │   │   ├── screens/AvatarScreen.tsx       // Earned avatar and evidence.
│   │   │   ├── features/chat/ChatPanel.tsx    // Typed command input and response display.
│   │   │   ├── features/chat/useSubmitMessage.ts // Submits chat commands.
│   │   │   ├── features/voice/VoiceControl.tsx // Voice capture and playback controls.
│   │   │   ├── features/voice/useVoiceSession.ts // Voice adapter coordination.
│   │   │   ├── features/jobs/JobStatusCard.tsx // One job's current status.
│   │   │   ├── features/jobs/JobControls.tsx  // Pause, resume, finish-stop, and emergency-stop controls.
│   │   │   ├── features/evidence/EvidenceList.tsx // Evidence summaries.
│   │   │   ├── features/evidence/EvidenceViewer.tsx // One immutable evidence record.
│   │   │   ├── features/avatar/CapabilityAvatar.tsx // Layered earned avatar renderer.
│   │   │   ├── features/avatar/UnlockHistory.tsx // Evidence-linked unlock history.
│   │   │   ├── lib/runtime-client.ts          // Typed runtime API client.
│   │   │   ├── lib/event-stream.ts            // Runtime WebSocket subscription.
│   │   │   ├── lib/query-keys.ts              // Stable TanStack Query keys.
│   │   │   ├── state/ui-store.ts              // Non-authoritative UI preferences only.
│   │   │   └── styles/global.css              // Global layout and design tokens.
│   │   └── src-tauri/
│   │       ├── Cargo.toml                     // Native desktop dependencies.
│   │       ├── tauri.conf.json                // Windows, permissions, and packaging.
│   │       ├── build.rs                       // Tauri build integration.
│   │       ├── capabilities/default.json      // Minimum native capabilities.
│   │       └── src/
│   │           ├── main.rs                    // Starts the Tauri application.
│   │           ├── lib.rs                     // Native commands and lifecycle hooks.
│   │           ├── runtime_process.rs         // Starts and supervises the runtime process.
│   │           ├── file_dialog.rs             // Constrained file/folder selection.
│   │           └── tray.rs                    // Show, hide, and shutdown controls.
│   │
│   └── cli/
│       ├── package.json                       // Headless CLI dependencies and scripts.
│       ├── tsconfig.json                      // CLI TypeScript configuration.
│       └── src/
│           ├── main.ts                        // Registers and dispatches CLI commands.
│           ├── output.ts                      // Human-readable and JSON output.
│           └── commands/
│               ├── status.command.ts          // Runtime status.
│               ├── projects.command.ts        // Project listing and inspection.
│               ├── jobs.command.ts            // Job lifecycle control.
│               ├── evidence.command.ts        // Evidence queries.
│               ├── models.command.ts          // Model adapter status.
│               ├── tools.command.ts           // Tool adapter status.
│               ├── plugins.command.ts         // Plugin controls.
│               └── practice.command.ts        // Idle-practice state and stop controls.
│
├── packages/
│   ├── domain/
│   │   ├── package.json                       // Dependency-free domain package.
│   │   ├── tsconfig.json                      // Strict domain compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public domain API only.
│   │       ├── domain-errors.ts               // Domain invariant violations.
│   │       ├── domain-events.ts               // Immutable domain events.
│   │       ├── value-objects/ids.ts           // Branded durable identifiers.
│   │       ├── value-objects/content-hash.ts  // Validated SHA-256 hashes.
│   │       ├── value-objects/safe-path.ts     // Normalized project-relative paths.
│   │       ├── value-objects/score.ts         // Bounded normalized scores.
│   │       ├── value-objects/resource-budget.ts // Compute, memory, time, and token budgets.
│   │       ├── entities/project.ts            // Project identity and lifecycle.
│   │       ├── entities/mission-contract.ts   // Immutable mission objectives and constraints.
│   │       ├── entities/requirement.ts        // Traceable requirements.
│   │       ├── entities/job.ts                // Resumable job state and transitions.
│   │       ├── entities/checkpoint.ts         // Immutable execution checkpoints.
│   │       ├── entities/artifact.ts           // Content-addressed production artifacts.
│   │       ├── entities/evidence-record.ts    // Immutable evidence and provenance.
│   │       ├── entities/claim.ts              // Claims and evidence status.
│   │       ├── entities/production-twin.ts    // Requirement-to-output graph.
│   │       ├── entities/model-profile.ts      // Measured model capabilities.
│   │       ├── entities/tool-profile.ts       // Tool capabilities and availability.
│   │       ├── entities/plugin-profile.ts     // Plugin identity, health, and capabilities.
│   │       ├── entities/solver-candidate.ts   // Immutable candidate lineage.
│   │       ├── entities/verification-result.ts // Verification outcomes.
│   │       ├── entities/issue-record.ts       // Evidence-backed defects.
│   │       ├── entities/repair-record.ts      // Targeted repair outcomes.
│   │       ├── entities/champion-decision.ts  // Winner or no-solution decision.
│   │       ├── entities/delivery-receipt.ts   // Final coverage and evidence receipt.
│   │       ├── entities/training-packet.ts    // Quarantined or promoted learning packet.
│   │       ├── entities/capability-profile.ts // Measured capability scores.
│   │       ├── entities/practice-task.ts      // Isolated idle-practice task.
│   │       ├── entities/promotion-record.ts   // Promotion and rollback decision.
│   │       └── entities/avatar-state.ts       // Earned avatar appearance and evidence.
│   │
│   ├── contracts/
│   │   ├── package.json                       // API and process contract dependencies.
│   │   ├── tsconfig.json                      // Contract compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public contract exports.
│   │       ├── common.schemas.ts              // IDs, timestamps, pagination, and errors.
│   │       ├── projects.schemas.ts            // Project payloads.
│   │       ├── missions.schemas.ts            // Mission payloads.
│   │       ├── jobs.schemas.ts                // Job lifecycle payloads.
│   │       ├── evidence.schemas.ts            // Evidence payloads.
│   │       ├── capabilities.schemas.ts        // Capability and promotion payloads.
│   │       ├── models.schemas.ts              // Model registration and profile payloads.
│   │       ├── tools.schemas.ts               // Tool registration and invocation payloads.
│   │       ├── plugins.schemas.ts             // Plugin lifecycle payloads.
│   │       ├── practice.schemas.ts            // Idle-practice payloads.
│   │       ├── avatar.schemas.ts              // Avatar and unlock payloads.
│   │       ├── runtime-events.schemas.ts      // Client-streamable runtime events.
│   │       └── adapter-rpc.schemas.ts         // JSON-RPC requests, results, and errors.
│   │
│   ├── application/
│   │   ├── package.json                       // Application-layer dependencies.
│   │   ├── tsconfig.json                      // Application compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public use cases, services, and ports.
│   │       ├── application-errors.ts          // Orchestration and policy errors.
│   │       ├── ports/unit-of-work.port.ts     // Atomic persistence boundaries.
│   │       ├── ports/project-repository.port.ts // Project persistence contract.
│   │       ├── ports/job-repository.port.ts   // Job/checkpoint persistence contract.
│   │       ├── ports/evidence-repository.port.ts // Immutable evidence contract.
│   │       ├── ports/candidate-repository.port.ts // Candidate lineage contract.
│   │       ├── ports/capability-repository.port.ts // Capability/promotion contract.
│   │       ├── ports/artifact-store.port.ts   // Content-addressed artifact contract.
│   │       ├── ports/event-bus.port.ts        // Committed event publication contract.
│   │       ├── ports/model-gateway.port.ts    // Model discovery/invocation contract.
│   │       ├── ports/tool-gateway.port.ts     // Production-tool invocation contract.
│   │       ├── ports/plugin-registry.port.ts  // Plugin lifecycle contract.
│   │       ├── ports/production-kernel.port.ts // Durable execution-kernel contract.
│   │       ├── ports/verifier.port.ts         // Independent verification contract.
│   │       ├── ports/policy-engine.port.ts    // Permission and promotion policy contract.
│   │       ├── ports/scheduler.port.ts        // Queued and delayed work contract.
│   │       ├── ports/resource-monitor.port.ts // CPU/GPU/RAM/storage/idle contract.
│   │       ├── ports/training-store.port.ts   // Quarantined/promoted data contract.
│   │       ├── ports/secret-store.port.ts     // Protected secret retrieval contract.
│   │       ├── ports/clock.port.ts            // Deterministic time contract.
│   │       ├── services/compute-governor.ts   // Selects execution depth and budget.
│   │       ├── services/context-compiler.ts   // Builds the smallest sufficient context.
│   │       ├── services/diversity-planner.ts  // Produces materially distinct solver plans.
│   │       ├── services/evidence-linker.ts    // Links claims, requirements, artifacts, and evidence.
│   │       ├── services/champion-selector.ts  // Selects a winner or no verified solution.
│   │       ├── services/improvement-policy.ts // Rejects non-material refinements.
│   │       ├── services/capability-calculator.ts // Calculates measured capability updates.
│   │       ├── services/practice-selector.ts  // Selects weak capabilities for practice.
│   │       ├── services/avatar-unlock-engine.ts // Evaluates evidence-backed achievements.
│   │       ├── use-cases/create-project.ts    // Creates a durable project.
│   │       ├── use-cases/submit-mission.ts    // Stores an immutable mission contract.
│   │       ├── use-cases/plan-execution.ts    // Produces a governed execution plan.
│   │       ├── use-cases/start-job.ts         // Creates and starts a durable job.
│   │       ├── use-cases/checkpoint-job.ts    // Creates a recoverable checkpoint.
│   │       ├── use-cases/resume-job.ts        // Resumes from the latest valid checkpoint.
│   │       ├── use-cases/stop-job.ts          // Finish-stop or emergency-stop behavior.
│   │       ├── use-cases/run-solver-forge.ts  // Executes independent solver candidates.
│   │       ├── use-cases/verify-candidates.ts // Runs the verifier mesh.
│   │       ├── use-cases/record-issues.ts     // Stores evidence-backed issues.
│   │       ├── use-cases/repair-candidate.ts  // Applies targeted repair in a working copy.
│   │       ├── use-cases/select-champion.ts   // Creates winner or no-solution decision.
│   │       ├── use-cases/deliver-result.ts    // Creates verified delivery receipt.
│   │       ├── use-cases/compile-training-packet.ts // Creates quarantined training data.
│   │       ├── use-cases/promote-capability.ts // Promotes after held-out/regression checks.
│   │       ├── use-cases/run-idle-practice.ts // Runs safe isolated practice.
│   │       ├── use-cases/stop-idle-practice.ts // Stops practice safely.
│   │       ├── use-cases/evaluate-avatar-unlocks.ts // Applies valid visual unlocks.
│   │       ├── use-cases/register-plugin.ts   // Validates and registers a plugin.
│   │       ├── use-cases/invoke-model.ts      // Invokes a model through the gateway.
│   │       └── use-cases/invoke-tool.ts       // Invokes a tool through the gateway.
│   │
│   ├── infrastructure/
│   │   ├── package.json                       // Infrastructure dependencies.
│   │   ├── tsconfig.json                      // Infrastructure compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Infrastructure constructors only.
│   │       ├── database/client.ts             // SQLite and Drizzle connection.
│   │       ├── database/schema.ts             // Normalized durable database tables.
│   │       ├── database/migrations.ts         // Ordered database migrations.
│   │       ├── database/unit-of-work.ts       // Atomic repository transactions.
│   │       ├── database/repositories/project.repository.ts // Project persistence.
│   │       ├── database/repositories/job.repository.ts // Job/checkpoint persistence.
│   │       ├── database/repositories/evidence.repository.ts // Append-only evidence persistence.
│   │       ├── database/repositories/candidate.repository.ts // Candidate lineage persistence.
│   │       ├── database/repositories/capability.repository.ts // Capability/promotion persistence.
│   │       ├── artifacts/content-addressed-store.ts // Immutable hash-addressed artifacts.
│   │       ├── artifacts/artifact-metadata.ts // Artifact ownership and metadata.
│   │       ├── events/transactional-outbox.ts // Events committed with state changes.
│   │       ├── events/outbox-publisher.ts     // Publishes committed outbox events.
│   │       ├── events/in-process-event-bus.ts // Dispatches events locally.
│   │       ├── adapters/adapter-client.ts     // JSON-RPC adapter communication.
│   │       ├── adapters/adapter-registry.ts   // Discovers and validates adapter manifests.
│   │       ├── adapters/adapter-supervisor.ts // Starts, restarts, and stops adapters.
│   │       ├── gateways/model-gateway.ts      // Provider-neutral model invocation.
│   │       ├── gateways/tool-gateway.ts       // Permission-gated tool invocation.
│   │       ├── gateways/plugin-registry.ts    // Plugin discovery and lifecycle.
│   │       ├── gateways/production-kernel-gateway.ts // Replaceable kernel invocation.
│   │       ├── policy/policy-engine.ts        // Permissions, paths, and promotion gates.
│   │       ├── policy/path-policy.ts          // Project-relative filesystem boundaries.
│   │       ├── process/process-supervisor.ts  // Approved child-process execution.
│   │       ├── process/process-log-capture.ts // stdout, stderr, exit, and timestamp capture.
│   │       ├── scheduling/durable-scheduler.ts // Persistent queued/delayed work.
│   │       ├── scheduling/idle-detector.ts    // Thirty-minute safe-idle detection.
│   │       ├── resources/system-resource-monitor.ts // CPU/GPU/RAM/storage/temperature/activity.
│   │       ├── secrets/operating-system-secret-store.ts // Protected provider secrets.
│   │       └── logging/logger.ts              // Structured contextual logger.
│   │
│   ├── adapter-protocol/
│   │   ├── package.json                       // Adapter protocol dependencies.
│   │   ├── tsconfig.json                      // Protocol compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public protocol API.
│   │       ├── adapter-manifest.ts            // Adapter metadata and capabilities.
│   │       ├── adapter-lifecycle.ts           // Initialize, health, cancel, and shutdown.
│   │       ├── model-adapter.ts               // Model invocation methods.
│   │       ├── tool-adapter.ts                // Production-tool methods.
│   │       ├── kernel-adapter.ts              // Production-kernel methods.
│   │       └── rpc-errors.ts                  // Protocol errors and retryability.
│   │
│   ├── plugin-sdk/
│   │   ├── package.json                       // Plugin SDK dependencies.
│   │   ├── tsconfig.json                      // Plugin SDK compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Supported plugin API.
│   │       ├── plugin-manifest.ts             // Plugin identity, permissions, and entrypoint.
│   │       ├── capability-registration.ts     // Capability registration contract.
│   │       ├── workflow-registration.ts       // Workflow registration contract.
│   │       ├── verifier-registration.ts       // Verifier registration contract.
│   │       └── plugin-context.ts              // Restricted services available to plugins.
│   │
│   ├── runtime-sdk/
│   │   ├── package.json                       // Runtime client dependencies.
│   │   ├── tsconfig.json                      // Runtime client compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public runtime client API.
│   │       ├── runtime-client.ts              // Typed commands and queries.
│   │       └── runtime-event-client.ts        // Typed event subscriptions.
│   │
│   ├── ui-kit/
│   │   ├── package.json                       // Presentation-only dependencies.
│   │   ├── tsconfig.json                      // UI-kit compiler configuration.
│   │   └── src/
│   │       ├── index.ts                       // Public presentation components.
│   │       ├── Button.tsx                     // Accessible button without business behavior.
│   │       ├── StatusBadge.tsx                // Typed status renderer.
│   │       ├── ProgressMeter.tsx              // Normalized progress renderer.
│   │       ├── EvidenceBadge.tsx              // Verification-state renderer.
│   │       └── ErrorBoundary.tsx              // Presentation failure containment.
│   │
│   └── testkit/
│       ├── package.json                       // Reusable test infrastructure.
│       ├── tsconfig.json                      // Testkit compiler configuration.
│       └── src/
│           ├── index.ts                       // Public test builders and fakes.
│           ├── builders.ts                    // Valid domain entities for tests.
│           ├── fake-clock.ts                  // Deterministic time.
│           ├── fake-gateways.ts               // Model, tool, plugin, and kernel fakes.
│           ├── in-memory-repositories.ts      // Persistence test doubles.
│           └── assertions.ts                  // Evidence and transition assertions.
│
├── adapters/
│   ├── kernels/oh-my-cli-candidate/
│   │   ├── adapter.manifest.json              // Audited kernel capabilities and permissions.
│   │   ├── src/index.ts                       // Kernel adapter process entrypoint.
│   │   ├── src/oh-my-cli-kernel.adapter.ts    // Maps candidate kernel to protocol.
│   │   └── tests/contract.test.ts             // Kernel protocol and isolation tests.
│   ├── models/
│   │   ├── manifests/ollama.json              // Local Ollama provider.
│   │   ├── manifests/qwen-primary.json        // Primary Qwen intelligence candidate.
│   │   ├── manifests/qwen-image.json          // Qwen image candidate.
│   │   ├── manifests/flux.json                // Local FLUX fallback.
│   │   ├── manifests/airllm.json              // Layer-loaded large-model escalation.
│   │   ├── manifests/cloudflare-workers-ai.json // Optional Cloudflare provider.
│   │   ├── manifests/gemini.json              // Optional Gemini provider.
│   │   ├── manifests/openrouter-free.json     // Optional OpenRouter free provider.
│   │   ├── manifests/hosted-image.json        // Optional hosted image provider.
│   │   ├── src/ollama.adapter.ts              // Ollama discovery and invocation.
│   │   ├── src/qwen-primary.adapter.ts        // Primary Qwen model profile.
│   │   ├── src/qwen-image.adapter.ts          // Qwen image generation.
│   │   ├── src/flux.adapter.ts                // Local FLUX generation.
│   │   ├── src/airllm.adapter.py              // Layer-by-layer model loading.
│   │   ├── src/cloudflare-workers-ai.adapter.ts // Cloudflare invocation.
│   │   ├── src/gemini.adapter.ts              // Gemini invocation.
│   │   ├── src/openrouter-free.adapter.ts     // OpenRouter invocation.
│   │   ├── src/hosted-image.adapter.ts        // Hosted image generation.
│   │   └── tests/all-model-adapters.contract.test.ts // Shared model protocol tests.
│   └── tools/
│       ├── manifests/software/playwright.json // Browser/application testing capabilities.
│       ├── manifests/software/git.json        // Constrained Git operations.
│       ├── manifests/research/searxng.json    // Local search capabilities.
│       ├── manifests/research/crawl4ai.json   // Web extraction capabilities.
│       ├── manifests/research/browser-use.json // Browser automation capabilities.
│       ├── manifests/two-d/penpot.json        // Penpot capabilities.
│       ├── manifests/two-d/krita.json         // Krita capabilities.
│       ├── manifests/two-d/inkscape.json      // Inkscape capabilities.
│       ├── manifests/two-d/gimp.json          // GIMP capabilities.
│       ├── manifests/two-d/excalidraw.json    // Excalidraw capabilities.
│       ├── manifests/two-d/comfyui.json       // ComfyUI workflow capabilities.
│       ├── manifests/three-d/blender.json     // Blender creation/render capabilities.
│       ├── manifests/three-d/godot.json       // Godot project/scene capabilities.
│       ├── manifests/three-d/unreal.json      // Optional Unreal capabilities.
│       ├── manifests/three-d/houdini.json     // Optional Houdini capabilities.
│       ├── manifests/three-d/substance.json   // Optional material-authoring capabilities.
│       ├── manifests/three-d/reality-capture.json // Optional photogrammetry capabilities.
│       ├── manifests/three-d/simplygon.json   // Asset optimization capabilities.
│       ├── manifests/three-d/pix.json         // DirectX profiling capabilities.
│       ├── manifests/three-d/nsight.json      // NVIDIA profiling capabilities.
│       ├── manifests/fs25/giants-editor.json  // GIANTS Editor operations.
│       ├── manifests/fs25/giants-exporter.json // GIANTS Blender Exporter operations.
│       ├── manifests/fs25/fs25-testrunner.json // Official FS25 TestRunner operations.
│       ├── manifests/fs25/fs25-icon-generator.json // FS25 icon generation.
│       ├── manifests/fs25/fs25-game-log.json  // Controlled launch and log capture.
│       ├── manifests/video/blender-vse.json   // Blender VSE operations.
│       ├── manifests/video/kdenlive.json      // Kdenlive editing operations.
│       ├── manifests/video/natron.json        // Natron compositing operations.
│       ├── manifests/video/manim.json         // Programmatic animation operations.
│       ├── manifests/video/cascadeur.json     // Character animation operations.
│       ├── manifests/video/metahuman-animator.json // Performance animation operations.
│       ├── manifests/video/topaz-video.json   // Video enhancement operations.
│       ├── manifests/video/flamenco.json      // Blender render coordination.
│       ├── manifests/video/oidn.json          // Open Image Denoise operations.
│       ├── manifests/video/ffmpeg.json        // Media inspection and transformation.
│       ├── manifests/video/davinci-resolve.json // Optional Resolve operations.
│       ├── manifests/video/fusion.json        // Optional Fusion operations.
│       ├── manifests/video/nuke.json          // Optional Nuke operations.
│       ├── manifests/audio/ardour.json        // Ardour operations.
│       ├── manifests/audio/audacity.json      // Audacity operations.
│       ├── manifests/audio/reaper.json        // Optional REAPER operations.
│       ├── manifests/experimental/muse.json   // Isolated Muse research capabilities.
│       ├── src/software/playwright.adapter.ts // Playwright operations.
│       ├── src/software/git.adapter.ts        // Constrained Git operations.
│       ├── src/research/searxng.adapter.ts    // SearXNG queries.
│       ├── src/research/crawl4ai.adapter.py   // Crawl4AI extraction.
│       ├── src/research/browser-use.adapter.py // Browser Use automation.
│       ├── src/two-d/penpot.adapter.ts        // Penpot control.
│       ├── src/two-d/krita.adapter.py         // Krita control.
│       ├── src/two-d/inkscape.adapter.ts      // Inkscape CLI operations.
│       ├── src/two-d/gimp.adapter.py          // GIMP automation.
│       ├── src/two-d/excalidraw.adapter.ts    // Excalidraw document operations.
│       ├── src/two-d/comfyui.adapter.ts       // ComfyUI execution.
│       ├── src/three-d/blender.adapter.py     // Blender Python operations.
│       ├── src/three-d/godot.adapter.ts       // Godot CLI/project operations.
│       ├── src/three-d/unreal.adapter.py      // Optional Unreal Python operations.
│       ├── src/three-d/houdini.adapter.py     // Optional Houdini operations.
│       ├── src/three-d/substance.adapter.py   // Optional Substance automation.
│       ├── src/three-d/reality-capture.adapter.ts // Photogrammetry automation.
│       ├── src/three-d/simplygon.adapter.py   // Simplygon optimization.
│       ├── src/three-d/pix.adapter.ts         // PIX capture operations.
│       ├── src/three-d/nsight.adapter.ts      // Nsight capture operations.
│       ├── src/fs25/giants-editor.adapter.ts  // GIANTS Editor discovery/launch.
│       ├── src/fs25/giants-exporter.adapter.py // GIANTS Blender export.
│       ├── src/fs25/fs25-testrunner.adapter.ts // TestRunner execution/parsing.
│       ├── src/fs25/fs25-icon-generator.adapter.ts // Icon generation.
│       ├── src/fs25/fs25-game-log.adapter.ts  // Game launch/log monitoring.
│       ├── src/video/blender-vse.adapter.py   // Blender VSE operations.
│       ├── src/video/kdenlive.adapter.ts      // Kdenlive project operations.
│       ├── src/video/natron.adapter.py        // Natron compositing.
│       ├── src/video/manim.adapter.py         // Manim rendering.
│       ├── src/video/cascadeur.adapter.py     // Cascadeur operations.
│       ├── src/video/metahuman-animator.adapter.py // MetaHuman operations.
│       ├── src/video/topaz-video.adapter.ts   // Topaz sample/full-shot processing.
│       ├── src/video/flamenco.adapter.py      // Flamenco coordination.
│       ├── src/video/oidn.adapter.ts          // Denoising operations.
│       ├── src/video/ffmpeg.adapter.ts        // Media inspection/transformation.
│       ├── src/video/davinci-resolve.adapter.py // Resolve timeline/render operations.
│       ├── src/video/fusion.adapter.py        // Fusion compositing.
│       ├── src/video/nuke.adapter.py          // Nuke compositing.
│       ├── src/audio/ardour.adapter.ts        // Ardour sessions.
│       ├── src/audio/audacity.adapter.py      // Audacity automation.
│       ├── src/audio/reaper.adapter.py        // REAPER automation.
│       ├── src/experimental/muse.adapter.py   // Quarantined Muse research.
│       └── tests/all-tool-adapters.contract.test.ts // Shared tool protocol tests.
│
├── plugins/
│   ├── software-production/
│   │   ├── plugin.manifest.json               // Repository/application production capabilities.
│   │   ├── src/index.ts                       // Registers workflows and verifiers.
│   │   ├── src/workflows.ts                   // Build, test, preview, inspect, and repair workflows.
│   │   ├── src/verifiers.ts                   // Repository/application verifiers.
│   │   └── tests/plugin.contract.test.ts      // Registration and boundary tests.
│   ├── visual-intelligence/
│   │   ├── plugin.manifest.json               // Visual direction and verification capabilities.
│   │   ├── src/index.ts                       // Registers the plugin.
│   │   ├── src/visual-context-compiler.ts     // References, scene state, and visual constraints.
│   │   ├── src/candidate-ranker.ts            // Verified visual candidate ranking.
│   │   ├── src/continuity-graph.ts            // Character, asset, typography, scene, and shot continuity.
│   │   ├── src/visual-verifiers.ts            // Deterministic and sampled visual checks.
│   │   └── tests/plugin.contract.test.ts      // Registration and isolation tests.
│   ├── creative-2d/
│   │   ├── plugin.manifest.json               // 2D, UI, vector, raster, and diagram capabilities.
│   │   ├── src/index.ts                       // Registers 2D workflows.
│   │   ├── src/workflows.ts                   // Design, edit, inspect, compare, and export workflows.
│   │   └── tests/plugin.contract.test.ts      // Registration and isolation tests.
│   ├── game-production/
│   │   ├── plugin.manifest.json               // General 3D/game production capabilities.
│   │   ├── src/index.ts                       // Registers game workflows.
│   │   ├── src/scene-workflows.ts             // Scene creation, integration, and verification.
│   │   ├── src/asset-workflows.ts             // Asset creation, optimization, and import.
│   │   └── tests/plugin.contract.test.ts      // Plugin boundary tests.
│   ├── fs25-mod-forge/
│   │   ├── plugin.manifest.json               // FS25 create, convert, repair, test, optimize, and package.
│   │   ├── src/index.ts                       // Registers FS25 workflows and schemas.
│   │   ├── src/domain/fs25-mod-project.ts     // Mod identity, target, type, and state.
│   │   ├── src/domain/console-eligibility.ts  // Crossplay/console eligibility rules.
│   │   ├── src/domain/compatibility-matrix.ts // Version, multiplayer, DLC, dependency, and conflict matrix.
│   │   ├── src/use-cases/create-mod.ts        // Minimal mod-type-specific scaffold.
│   │   ├── src/use-cases/convert-mod.ts       // Evidence-backed conversion.
│   │   ├── src/use-cases/inspect-mod.ts       // Read-only mod inspection.
│   │   ├── src/use-cases/repair-mod.ts        // Targeted verified repair.
│   │   ├── src/use-cases/test-mod.ts          // Static, TestRunner, and in-game verification.
│   │   ├── src/use-cases/optimize-mod.ts      // Asset optimization preserving functional nodes.
│   │   ├── src/use-cases/package-mod.ts       // Clean verified ZIP production.
│   │   ├── src/workflows/fs25-production.workflow.ts // Idea-to-tested-package workflow.
│   │   ├── src/integrations/giants-bridge.ts  // Coordinates official GIANTS adapters.
│   │   ├── src/verifiers/xml.verifier.ts      // XML structure/reference checks.
│   │   ├── src/verifiers/lua.verifier.ts      // Lua syntax/registration/platform checks.
│   │   ├── src/verifiers/i3d.verifier.ts      // I3D hierarchy/node/material checks.
│   │   ├── src/verifiers/asset-integrity.verifier.ts // Textures, collisions, LODs, animations, attachments.
│   │   ├── src/verifiers/localization.verifier.ts // Localization completeness.
│   │   ├── src/verifiers/multiplayer.verifier.ts // Multiplayer-sensitive behavior.
│   │   ├── src/verifiers/console.verifier.ts  // Console eligibility checks.
│   │   ├── src/verifiers/testrunner.verifier.ts // TestRunner output evidence.
│   │   ├── src/testing/disposable-test-farm.ts // Isolated FS25 savegames.
│   │   ├── src/testing/game-log-analyzer.ts   // Maps log errors to source/repairs.
│   │   ├── tests/plugin.contract.test.ts      // Registration/isolation tests.
│   │   ├── tests/console-eligibility.test.ts  // Platform classification tests.
│   │   └── tests/production-workflow.test.ts  // Ordered production workflow tests.
│   ├── video-production/
│   │   ├── plugin.manifest.json               // Video creation, rendering, enhancement, and verification.
│   │   ├── src/index.ts                       // Registers video workflows and verifiers.
│   │   ├── src/domain/video-project.ts        // Projects, shots, timelines, media, caches, and renders.
│   │   ├── src/domain/render-profile.ts       // Preview, balanced, and final profiles.
│   │   ├── src/domain/media-location.ts       // Source, cache, intermediate, and final storage classes.
│   │   ├── src/services/render-cache-director.ts // Proxies, caches, queues, rerenders, and recovery.
│   │   ├── src/services/per-shot-optimizer.ts // Lowest-cost passing render profile.
│   │   ├── src/services/render-dependency-graph.ts // Rerender dependency tracking.
│   │   ├── src/services/storage-planner.ts    // Correct media placement.
│   │   ├── src/workflows/video-production.workflow.ts // Preview-to-verified-final workflow.
│   │   ├── src/verifiers/frame-completeness.verifier.ts // Missing, duplicate, black, frozen frames.
│   │   ├── src/verifiers/audio-sync.verifier.ts // Presence, clipping, timing, synchronization.
│   │   ├── src/verifiers/vmaf.verifier.ts     // Reference-master encode quality.
│   │   ├── src/verifiers/ssim.verifier.ts     // Structural image similarity.
│   │   ├── src/verifiers/psnr.verifier.ts     // Signal difference measurement.
│   │   ├── src/verifiers/sampled-visual.verifier.ts // Representative visual inspection.
│   │   ├── tests/plugin.contract.test.ts      // Registration and isolation tests.
│   │   ├── tests/cache-director.test.ts       // Cache and rerender behavior.
│   │   └── tests/production-workflow.test.ts  // Complete video-production loop.
│   ├── audio-production/
│   │   ├── plugin.manifest.json               // Audio editing, arrangement, processing, and verification.
│   │   ├── src/index.ts                       // Registers audio workflows.
│   │   ├── src/workflows.ts                   // Ingest, edit, sync, process, mix, verify.
│   │   ├── src/verifiers.ts                   // Clipping, silence, sync, channel, and loudness checks.
│   │   └── tests/plugin.contract.test.ts      // Registration and isolation tests.
│   ├── research-intelligence/
│   │   ├── plugin.manifest.json               // Search, crawl, browsing, source, and claim capabilities.
│   │   ├── src/index.ts                       // Registers research workflows and verifiers.
│   │   ├── src/claim-source-graph.ts          // Claims linked to sources and evidence.
│   │   ├── src/research-workflow.ts           // Query, retrieve, extract, compare, synthesize.
│   │   ├── src/source-verifier.ts             // Independence, authority, recency, and relevance.
│   │   └── tests/plugin.contract.test.ts      // Registration and isolation tests.
│   └── worldmonitor/
│       ├── plugin.manifest.json               // WorldMonitor as removable monitoring plugin.
│       ├── src/index.ts                       // Registers WorldMonitor capabilities.
│       └── tests/plugin.contract.test.ts      // Core startup without WorldMonitor.
│
├── labs/model-expansion/
│   ├── README.md                              // Laboratory isolation and experiment rules.
│   ├── experiment.schema.json                 // Model-expansion experiment schema.
│   ├── src/experiment-runner.py               // Reproducible isolated experiment runner.
│   ├── src/baseline-evaluator.py              // Unmodified base-model evaluation.
│   ├── src/depth-expansion.py                 // Controlled block expansion.
│   ├── src/recurrent-depth.py                 // Recurrent reasoning experiments.
│   ├── src/moe-upcycling.py                   // Dense-to-MoE experiments.
│   ├── src/packet-loader.py                   // Promoted training packets only.
│   ├── src/evaluation-guard.py                // Training/evaluation contamination prevention.
│   ├── tests/isolation.test.py                // No production-state access.
│   └── tests/contamination.test.py            // Training/evaluation separation.
│
├── scripts/
│   ├── bootstrap-repo.ts                      // Prerequisite and workspace installation checks.
│   ├── verify-architecture.ts                 // Deterministic architecture checks.
│   ├── validate-manifests.ts                  // Adapter/plugin manifest validation.
│   ├── generate-contract-docs.ts              // Human-readable contract documentation.
│   ├── detect-installed-tools.ts              // Tool detection without hard-coded paths.
│   ├── seed-development-state.ts              // Deterministic local fixtures.
│   └── clean-generated-state.ts               // Removes generated state without touching sources.
│
└── tests/
    ├── architecture/dependency-boundaries.test.ts // Allowed package dependency direction.
    ├── architecture/forbidden-imports.test.ts // UI/plugin/adapter bypass prevention.
    ├── architecture/file-size.test.ts         // Source-file size limits.
    ├── architecture/public-api.test.ts        // Public package API enforcement.
    ├── architecture/optional-tools.test.ts    // Optional tools not required at startup.
    ├── contracts/schema-roundtrip.test.ts     // API/process payload round trips.
    ├── contracts/event-compatibility.test.ts  // Runtime event compatibility.
    ├── contracts/manifest-validation.test.ts  // Every committed manifest.
    ├── integration/runtime-startup.test.ts    // Runtime starts without dashboard.
    ├── integration/dashboard-removal.test.ts  // Core operates with dashboard absent.
    ├── integration/durable-job-recovery.test.ts // Recovery from last valid checkpoint.
    ├── integration/evidence-immutability.test.ts // Accepted evidence cannot change.
    ├── integration/adapter-isolation.test.ts  // Adapters cannot access persistence.
    ├── integration/plugin-removal.test.ts     // Plugin removal does not break core.
    ├── integration/solver-verifier-repair.test.ts // Candidate-to-repair loop.
    ├── integration/no-verified-solution.test.ts // Every candidate may be rejected.
    ├── integration/training-quarantine.test.ts // No promotion before verification.
    ├── integration/avatar-evidence.test.ts    // Unlocks require valid evidence.
    ├── e2e/project-lifecycle.spec.ts          // Project creation through delivery.
    ├── e2e/finish-stop.spec.ts                // Checkpoint-safe Finish and Stop.
    ├── e2e/emergency-stop.spec.ts             // Immediate stop preserving checkpoint.
    ├── e2e/idle-practice.spec.ts              // Safe practice lifecycle.
    ├── e2e/fs25-workflow.spec.ts              // FS25 project through tested package.
    └── e2e/video-workflow.spec.ts             // Preview through verified render recovery.
```

---

# 3. TRACEABLE DATA FLOW & INTERFACES

## 3.1 Primary mission flow

```text
1. User submits a request through chat, voice, CLI, or API.
2. Interface creates a typed SubmitMissionRequest.
3. Runtime API validates the request schema.
4. SubmitMission creates an immutable MissionContract.
5. Mission state and events commit atomically.
6. ComputeGovernor selects Direct, Checked, Competitive, or Adversarial mode.
7. ContextCompiler creates the smallest sufficient context package.
8. DiversityPlanner creates materially different solver configurations.
9. Solver Forge invokes models through ModelGateway.
10. Candidate Vault stores every original candidate and lineage record.
11. Verifier Mesh runs deterministic and independent checks.
12. Results become immutable EvidenceRecords.
13. Issue Graph stores evidence-backed defects.
14. Targeted Repair modifies a working copy only.
15. Focused checks and full regressions rerun.
16. ChampionSelector chooses a champion or NoVerifiedSolution.
17. Verified Delivery creates a DeliveryReceipt.
18. Learning Forge creates a quarantined TrainingPacket.
19. Capability Atlas updates measured capability evidence.
20. Avatar Unlock Engine evaluates earned appearance rules.
21. Committed events stream to desktop and CLI clients.
```

## 3.2 Tool invocation flow

```text
Application Use Case
    ↓
ToolGatewayPort
    ↓
PolicyEngine
    ↓
AdapterRegistry
    ↓
AdapterSupervisor
    ↓
JSON-RPC Tool Adapter
    ↓
External Production Tool
    ↓
Output Artifacts + Logs
    ↓
Artifact Store + Evidence Repository
    ↓
Independent Verifier
```

A model may request a tool operation. A model may not start a tool directly.

## 3.3 Model invocation flow

```text
Solver Configuration
    ↓
ModelGatewayPort
    ↓
Capability and Availability Filter
    ↓
Resource Budget Check
    ↓
Provider-Neutral Invocation
    ↓
Model Adapter
    ↓
Raw Response
    ↓
Immutable Candidate Record
```

## 3.4 Durable job state

```text
Created → Queued → Running → Checkpointing → Running
                              ├→ Paused
                              ├→ FinishStopping
                              ├→ EmergencyStopping
                              ├→ Failed
                              └→ Completed
```

A resumed job always starts from its newest verified checkpoint.

## 3.5 Core interfaces

The interfaces below are normative schemas, not implementation code.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type ProjectId = Brand<string, "ProjectId">;
type MissionId = Brand<string, "MissionId">;
type JobId = Brand<string, "JobId">;
type CheckpointId = Brand<string, "CheckpointId">;
type ArtifactId = Brand<string, "ArtifactId">;
type EvidenceId = Brand<string, "EvidenceId">;
type CandidateId = Brand<string, "CandidateId">;
type IssueId = Brand<string, "IssueId">;
type CapabilityId = Brand<string, "CapabilityId">;
type PluginId = Brand<string, "PluginId">;
type AdapterId = Brand<string, "AdapterId">;
type ModelId = Brand<string, "ModelId">;
type ToolId = Brand<string, "ToolId">;
type ContentHash = Brand<string, "Sha256ContentHash">;
type ISODateTime = Brand<string, "ISODateTime">;
```

### Mission contract

```ts
interface MissionContract {
  readonly id: MissionId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly objective: string;
  readonly requiredOutputs: readonly RequiredOutput[];
  readonly requirements: readonly Requirement[];
  readonly constraints: readonly MissionConstraint[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly forbiddenChanges: readonly ForbiddenChange[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly resourceBudget: ResourceBudget;
  readonly createdAt: ISODateTime;
  readonly revision: 1;
}

interface RequiredOutput {
  readonly id: string;
  readonly kind: string;
  readonly description: string;
  readonly requiredFormat?: string;
}

interface Requirement {
  readonly id: string;
  readonly statement: string;
  readonly priority: "required" | "important" | "optional";
  readonly source: "user" | "system" | "plugin" | "derived";
}

interface MissionConstraint {
  readonly id: string;
  readonly statement: string;
  readonly category: "architecture" | "behavior" | "performance" | "resource" | "compatibility" | "security";
}

interface AcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly verificationMethod: string;
  readonly mandatory: boolean;
}

interface ForbiddenChange {
  readonly id: string;
  readonly statement: string;
}

interface EvidenceRequirement {
  readonly criterionId: string;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
}
```

### Resources, projects, jobs, and checkpoints

```ts
interface ResourceBudget {
  readonly maxWallClockMs: number;
  readonly maxModelInvocations: number;
  readonly maxToolInvocations: number;
  readonly maxRepairRounds: number;
  readonly maxConcurrentWorkers: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxRamBytes?: number;
  readonly maxVramBytes?: number;
}

interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly rootPath: string;
  readonly status: "active" | "paused" | "archived";
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

type JobStatus =
  | "created" | "queued" | "running" | "checkpointing" | "paused"
  | "finish_stopping" | "emergency_stopping" | "completed" | "failed" | "cancelled";

interface Job {
  readonly id: JobId;
  readonly projectId: ProjectId;
  readonly missionId: MissionId;
  readonly workflowId: string;
  readonly status: JobStatus;
  readonly currentStage: string;
  readonly progress: number;
  readonly latestCheckpointId?: CheckpointId;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

interface Checkpoint {
  readonly id: CheckpointId;
  readonly jobId: JobId;
  readonly stage: string;
  readonly stateArtifactId: ArtifactId;
  readonly evidenceIds: readonly EvidenceId[];
  readonly contentHash: ContentHash;
  readonly verified: boolean;
  readonly createdAt: ISODateTime;
}
```

### Artifacts and evidence

```ts
type ArtifactKind =
  | "source" | "document" | "image" | "video" | "audio" | "three_d_scene"
  | "game_project" | "mod_package" | "test_report" | "log" | "dataset"
  | "model_checkpoint" | "other";

interface Artifact {
  readonly id: ArtifactId;
  readonly projectId: ProjectId;
  readonly jobId?: JobId;
  readonly kind: ArtifactKind;
  readonly logicalPath: string;
  readonly contentHash: ContentHash;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly createdAt: ISODateTime;
  readonly parentArtifactIds: readonly ArtifactId[];
}

type EvidenceKind =
  | "unit_test" | "integration_test" | "hidden_test" | "property_test"
  | "mutation_test" | "static_analysis" | "benchmark" | "visual_inspection"
  | "audio_inspection" | "source" | "tool_log" | "runtime_log"
  | "artifact_comparison" | "human_approval";

interface EvidenceRecord {
  readonly id: EvidenceId;
  readonly projectId: ProjectId;
  readonly jobId?: JobId;
  readonly kind: EvidenceKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: "passed" | "failed" | "inconclusive";
  readonly summary: string;
  readonly artifactIds: readonly ArtifactId[];
  readonly verifierId: string;
  readonly verifierVersion: string;
  readonly createdAt: ISODateTime;
  readonly immutable: true;
}
```

### Production Twin

```ts
type TwinNodeKind =
  | "requirement" | "acceptance_criterion" | "source_file" | "component"
  | "web_layout" | "three_d_asset" | "scene" | "shot" | "timeline"
  | "audio_track" | "research_claim" | "artifact" | "test" | "evidence";

interface ProductionTwinNode {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly kind: TwinNodeKind;
  readonly label: string;
  readonly externalReference?: string;
}

type TwinEdgeKind =
  | "implements" | "depends_on" | "verifies" | "derived_from"
  | "renders" | "contains" | "conflicts_with" | "supersedes";

interface ProductionTwinEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: TwinEdgeKind;
  readonly evidenceIds: readonly EvidenceId[];
}
```

### Candidates, verification, issues, and repair

```ts
interface SolverConfiguration {
  readonly modelId: ModelId;
  readonly strategy: "direct" | "minimal_change" | "specification_first" | "failure_first" | "performance_constrained" | "clean_room" | "adversarial";
  readonly contextArtifactIds: readonly ArtifactId[];
  readonly toolIds: readonly ToolId[];
  readonly temperature?: number;
  readonly seed?: number;
  readonly constraints: readonly string[];
}

interface SolverCandidate {
  readonly id: CandidateId;
  readonly missionId: MissionId;
  readonly parentCandidateIds: readonly CandidateId[];
  readonly configuration: SolverConfiguration;
  readonly responseArtifactId: ArtifactId;
  readonly outputArtifactIds: readonly ArtifactId[];
  readonly toolTraceArtifactId?: ArtifactId;
  readonly original: boolean;
  readonly createdAt: ISODateTime;
}

interface VerificationPlan {
  readonly id: string;
  readonly missionId: MissionId;
  readonly candidateId: CandidateId;
  readonly checks: readonly VerificationCheck[];
}

interface VerificationCheck {
  readonly id: string;
  readonly criterionIds: readonly string[];
  readonly verifierId: string;
  readonly kind: EvidenceKind;
  readonly mandatory: boolean;
  readonly hidden: boolean;
  readonly timeoutMs: number;
}

interface VerificationResult {
  readonly planId: string;
  readonly candidateId: CandidateId;
  readonly status: "passed" | "failed" | "inconclusive";
  readonly evidenceIds: readonly EvidenceId[];
  readonly mandatoryChecksPassed: number;
  readonly mandatoryChecksTotal: number;
  readonly optionalChecksPassed: number;
  readonly optionalChecksTotal: number;
}

interface IssueRecord {
  readonly id: IssueId;
  readonly candidateId: CandidateId;
  readonly title: string;
  readonly exactDeficiency: string;
  readonly location?: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly evidenceIds: readonly EvidenceId[];
  readonly expectedConsequence: string;
  readonly proposedCorrection: string;
  readonly verificationMethod: string;
  readonly regressionRisk: string;
  readonly status: "open" | "accepted" | "rejected" | "repaired";
}

interface RepairRecord {
  readonly id: string;
  readonly issueId: IssueId;
  readonly sourceCandidateId: CandidateId;
  readonly repairedCandidateId: CandidateId;
  readonly changedArtifactIds: readonly ArtifactId[];
  readonly focusedEvidenceIds: readonly EvidenceId[];
  readonly regressionEvidenceIds: readonly EvidenceId[];
  readonly status: "passed" | "failed" | "rolled_back";
}
```

### Champion, delivery, capabilities, training, and avatar

```ts
interface ChampionDecision {
  readonly missionId: MissionId;
  readonly decision: "champion" | "no_verified_solution";
  readonly candidateId?: CandidateId;
  readonly paretoCandidateIds: readonly CandidateId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly rationale: readonly DecisionReason[];
  readonly decidedAt: ISODateTime;
}

interface DecisionReason {
  readonly dimension: "correctness" | "coverage" | "security" | "performance" | "complexity" | "evidence";
  readonly statement: string;
  readonly evidenceIds: readonly EvidenceId[];
}

interface DeliveryReceipt {
  readonly missionId: MissionId;
  readonly decision: ChampionDecision["decision"];
  readonly deliveredArtifactIds: readonly ArtifactId[];
  readonly requirementsCovered: number;
  readonly requirementsTotal: number;
  readonly mandatoryChecksPassed: number;
  readonly mandatoryChecksTotal: number;
  readonly unresolvedRiskIds: readonly IssueId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly createdAt: ISODateTime;
}

interface CapabilityScore {
  readonly capabilityId: CapabilityId;
  readonly score: number;
  readonly sampleSize: number;
  readonly difficultyRange: readonly [number, number];
  readonly evidenceIds: readonly EvidenceId[];
  readonly measuredAt: ISODateTime;
}

interface ModelProfile {
  readonly modelId: ModelId;
  readonly adapterId: AdapterId;
  readonly displayName: string;
  readonly status: "available" | "unavailable" | "degraded";
  readonly local: boolean;
  readonly contextLimit?: number;
  readonly measuredCapabilities: readonly CapabilityScore[];
  readonly supportedModalities: readonly string[];
}

interface ToolProfile {
  readonly toolId: ToolId;
  readonly adapterId: AdapterId;
  readonly displayName: string;
  readonly status: "available" | "unavailable" | "degraded";
  readonly operations: readonly string[];
  readonly installedVersion?: string;
  readonly automationMethod: "native_api" | "python" | "cli" | "structured_file" | "gui";
}

interface PluginProfile {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly status: "registered" | "active" | "inactive" | "failed";
  readonly capabilities: readonly CapabilityId[];
  readonly requiredToolIds: readonly ToolId[];
  readonly optionalToolIds: readonly ToolId[];
}

interface TrainingPacket {
  readonly id: string;
  readonly missionId: MissionId;
  readonly status: "quarantined" | "verified" | "promoted" | "rejected";
  readonly taskArtifactId: ArtifactId;
  readonly contextArtifactIds: readonly ArtifactId[];
  readonly originalCandidateIds: readonly CandidateId[];
  readonly preferredCandidateId: CandidateId;
  readonly rejectedCandidateIds: readonly CandidateId[];
  readonly issueIds: readonly IssueId[];
  readonly repairIds: readonly string[];
  readonly verificationEvidenceIds: readonly EvidenceId[];
  readonly trainingViews: readonly TrainingView[];
  readonly provenanceHash: ContentHash;
  readonly evaluationLeakageChecked: boolean;
}

interface TrainingView {
  readonly kind: "sft" | "preference" | "failure_diagnosis" | "repair" | "tool_use" | "verification" | "planning";
  readonly artifactId: ArtifactId;
}

interface AvatarState {
  readonly avatarId: string;
  readonly unlockedItemIds: readonly string[];
  readonly equippedItemIds: readonly string[];
  readonly evolutionStage: number;
  readonly unlockHistory: readonly AvatarUnlock[];
}

interface AvatarUnlock {
  readonly itemId: string;
  readonly achievementRuleId: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly unlockedAt: ISODateTime;
  readonly permanent: true;
}
```

## 3.6 Core API payloads

```ts
interface CreateProjectRequest {
  readonly name: string;
  readonly rootPath: string;
}

interface CreateProjectResponse {
  readonly project: Project;
}

interface SubmitMissionRequest {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly objective: string;
  readonly requiredOutputs: readonly RequiredOutput[];
  readonly requirements: readonly Requirement[];
  readonly constraints: readonly MissionConstraint[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly forbiddenChanges: readonly ForbiddenChange[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly resourceBudget: ResourceBudget;
}

interface SubmitMissionResponse {
  readonly mission: MissionContract;
}

interface StartJobRequest {
  readonly missionId: MissionId;
  readonly workflowId: string;
}

interface StopJobRequest {
  readonly jobId: JobId;
  readonly mode: "finish_and_stop" | "emergency_stop";
}

interface InvokeModelRequest {
  readonly jobId: JobId;
  readonly configuration: SolverConfiguration;
  readonly promptArtifactId: ArtifactId;
}

interface InvokeToolRequest {
  readonly jobId: JobId;
  readonly toolId: ToolId;
  readonly operation: string;
  readonly inputArtifactIds: readonly ArtifactId[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expectedOutputs: readonly string[];
}

interface RuntimeApiError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

---

# 4. COMPONENT & FILE SPECIFICATIONS

## 4.1 Package import rules

| Package | Allowed imports |
|---|---|
| `packages/domain` | TypeScript standard library only |
| `packages/contracts` | Domain types and Zod |
| `packages/application` | Domain only |
| `packages/infrastructure` | Application ports, domain, adapter protocol |
| `packages/adapter-protocol` | Zod and protocol utilities only |
| `packages/plugin-sdk` | Contracts and adapter protocol |
| `packages/runtime-sdk` | Contracts only |
| `packages/ui-kit` | React and presentation libraries only |
| `apps/runtime` | Application, infrastructure, contracts |
| `apps/desktop` | Runtime SDK, contracts, UI kit |
| `apps/cli` | Runtime SDK and contracts |
| `plugins/*` | Plugin SDK and contracts |
| `adapters/*` | Adapter protocol and external SDK only |
| `labs/*` | Experiment libraries and promoted packets only |

## 4.2 Critical file specifications

### `docs/architecture.md`

**Allowed imports:** None.  
**Inputs:** Approved architectural decisions.  
**Outputs:** Authoritative architecture document.  
**Must define:** process boundaries, layer boundaries, dependency direction, state ownership, plugin isolation, adapter isolation, verification authority, self-improvement quarantine, and dashboard removability.

**Verification:**

- Contains the current specification ID.
- Contains every core module.
- Does not contradict an accepted ADR.
- Is referenced by `AGENTS.md`.

### `AGENTS.md`

**Inputs:** Architecture and contributor rules.  
**Outputs:** Mandatory AI and contributor instructions.  
**Required contents:** pre-edit document reads, no-parallel-abstraction rule, architecture-conflict stop rule, verification commands, and documentation-update requirement.

### `apps/runtime/src/composition-root.ts`

**Allowed imports:** application, infrastructure, and contracts public APIs.  
**Forbidden imports:** desktop files, plugin internals, adapter implementations, external model SDKs, and external tool SDKs.  
**Inputs:** validated runtime configuration and constructors.  
**Outputs:** dependency container and shutdown hooks.  
**Internal functions:** `createInfrastructure`, `createRepositories`, `createGateways`, `createApplicationServices`, `createUseCases`, `createRuntimeContainer`.

### `apps/runtime/src/bootstrap.ts`

**Inputs:** runtime configuration and composition root.  
**Outputs:** initialized database, artifacts, registries, scheduler, recovery, and API server.  
**Internal functions:** `validateEnvironment`, `runMigrations`, `initializeArtifactStore`, `discoverAdapters`, `registerPlugins`, `recoverInterruptedJobs`, `startRuntimeServices`.

### `apps/runtime/src/api/server.ts`

**Allowed imports:** contracts, Fastify, and route modules.  
**Inputs:** dependency container and API configuration.  
**Outputs:** authenticated local HTTP server and event endpoint.  
**Internal functions:** `createServer`, `registerAuth`, `registerErrorMapper`, `registerRoutes`, `registerEventStream`.  
**Forbidden behavior:** database queries, model calls, tool calls, and business decisions.

### `apps/desktop/src/state/ui-store.ts`

**Allowed imports:** Zustand only.  
**Inputs:** dashboard preferences.  
**Outputs:** ephemeral interface state.  
**Forbidden state:** projects, jobs, evidence, capabilities, plugins, models, and tools.

### `packages/domain/src/entities/mission-contract.ts`

**Allowed imports:** domain value objects and domain errors.  
**Inputs:** complete mission properties.  
**Outputs:** immutable valid mission contract.  
**Internal functions:** `createMissionContract`, `validateUniqueRequirementIds`, `validateAcceptanceCoverage`, `validateResourceBudget`, `assertImmutableRevision`.  
**Invariants:** objective is non-empty, at least one output exists, mandatory criteria define verification, IDs are unique, revision remains `1`.

### `packages/domain/src/entities/job.ts`

**Allowed imports:** domain IDs, events, and errors.  
**Inputs:** current state and requested transition.  
**Outputs:** new immutable state and events.  
**Internal functions:** `createJob`, `queueJob`, `startJob`, `beginCheckpoint`, `recordCheckpoint`, `pauseJob`, `beginFinishStop`, `beginEmergencyStop`, `completeJob`, `failJob`.  
**Invariants:** completed jobs do not restart, emergency stop preserves the latest valid checkpoint, progress remains 0..1, and resume requires a verified checkpoint.

### `packages/domain/src/entities/evidence-record.ts`

**Inputs:** verifier identity, subject, artifacts, and result.  
**Outputs:** immutable evidence.  
**Internal functions:** `createEvidenceRecord`, `validateVerifierIdentity`, `validateEvidenceArtifacts`, `assertImmutableEvidence`.  
**Invariants:** accepted evidence cannot be edited, must identify a subject and verifier version, and references existing artifacts.

### `packages/domain/src/entities/solver-candidate.ts`

**Inputs:** solver configuration, lineage, response, and output artifacts.  
**Outputs:** immutable candidate.  
**Internal functions:** `createOriginalCandidate`, `createReconstructedCandidate`, `validateCandidateLineage`, `validateIndependentOrigin`.  
**Invariants:** originals have no parents, reconstructed candidates have parents, originals are never replaced, lineage has no cycles.

### `packages/domain/src/entities/verification-result.ts`

**Inputs:** verification plan and evidence.  
**Outputs:** pass, fail, or inconclusive result.  
**Internal functions:** `calculateVerificationResult`, `countMandatoryChecks`, `countOptionalChecks`, `detectMissingChecks`.  
**Invariants:** failed mandatory checks prevent pass; missing mandatory checks are inconclusive; confidence does not affect status.

### `packages/domain/src/entities/training-packet.ts`

**Inputs:** verified candidates, issues, repairs, evidence, and training views.  
**Outputs:** quarantined packet.  
**Internal functions:** `createQuarantinedPacket`, `markPacketVerified`, `promotePacket`, `rejectPacket`, `validateProvenance`, `assertEvaluationSeparation`.  
**Invariants:** new packets are quarantined, promotion requires held-out evidence, leakage blocks promotion, provenance is immutable.

### `packages/application/src/services/compute-governor.ts`

**Inputs:** mission, capability profiles, resources, difficulty, and risk.  
**Outputs:** execution mode, candidate count, repair limit, and budgets.  
**Internal functions:** `classifyTaskDifficulty`, `classifyVerificationStrength`, `selectExecutionMode`, `allocateCandidateBudget`, `allocateRepairBudget`, `enforceResourceCeilings`.

### `packages/application/src/services/context-compiler.ts`

**Inputs:** mission, Production Twin, project state, and strategy.  
**Outputs:** context artifacts, exclusions, and token estimate.  
**Internal functions:** `collectRequiredNodes`, `resolveDependencyClosure`, `removeDuplicatedContext`, `excludeIrrelevantHistory`, `compileContextArtifact`.

### `packages/application/src/services/diversity-planner.ts`

**Inputs:** mission, available models, and budget.  
**Outputs:** distinct solver configurations.  
**Internal functions:** `selectModelFamilies`, `selectStrategies`, `partitionContext`, `calculateConfigurationSimilarity`, `rejectRedundantConfigurations`.  
**Invariant:** role labels alone do not count as diversity.

### `packages/application/src/services/champion-selector.ts`

**Inputs:** mission priorities, verified candidates, issues, and performance.  
**Outputs:** champion, Pareto set, or no verified solution.  
**Internal functions:** `filterUnverifiedCandidates`, `buildParetoFront`, `applyMissionPriorities`, `detectUnresolvedCriticalIssues`, `createChampionDecision`, `createNoSolutionDecision`.

### `packages/application/src/use-cases/run-solver-forge.ts`

**Inputs:** execution plan, mission, and context.  
**Outputs:** candidate IDs, events, and invocation evidence.  
**Internal functions:** `prepareSolverInvocations`, `invokeIndependentSolvers`, `captureRawResponses`, `persistOriginalCandidates`, `recordInvocationEvidence`.

### `packages/application/src/use-cases/verify-candidates.ts`

**Inputs:** candidates, criteria, and verification policies.  
**Outputs:** plans, evidence, and results.  
**Internal functions:** `buildVerificationPlan`, `dispatchChecks`, `collectEvidence`, `calculateResults`, `persistVerification`.

### `packages/application/src/use-cases/repair-candidate.ts`

**Inputs:** accepted issue, source candidate, and mission restrictions.  
**Outputs:** repaired candidate, repair record, focused evidence, and regression evidence.  
**Internal functions:** `validateRepairPermission`, `createWorkingCopy`, `invokeRepairTool`, `storeChangedArtifacts`, `runFocusedVerification`, `runRegressionVerification`, `promoteOrRollbackRepair`.

### `packages/application/src/use-cases/compile-training-packet.ts`

**Inputs:** completed mission, champion decision, and lineage.  
**Outputs:** quarantined training packet.  
**Internal functions:** `collectIndependentPaths`, `collectRejectedPaths`, `collectIssuesAndRepairs`, `buildTrainingViews`, `removeDuplicateNarration`, `validateEvidenceTraceability`, `writeQuarantinedPacket`.

### `packages/application/src/use-cases/run-idle-practice.ts`

**Inputs:** idle duration, resources, capability weaknesses, and policy.  
**Outputs:** isolated practice task and quarantined evidence.  
**Internal functions:** `confirmIdleEligibility`, `confirmResourceSafety`, `selectPracticeCapability`, `createIsolatedWorkspace`, `runPracticeTask`, `verifyPracticeResult`, `quarantinePracticeArtifacts`.

### `packages/application/src/services/avatar-unlock-engine.ts`

**Inputs:** avatar state, achievement rules, verified evidence, and capability profile.  
**Outputs:** permanent unlock records and updated state.  
**Internal functions:** `loadEligibleRules`, `validateEvidenceIndependence`, `validateCapabilityThresholds`, `rejectActivityOnlyRewards`, `createPermanentUnlock`.

### `packages/infrastructure/src/database/schema.ts`

**Required tables:** projects, missions, requirements, acceptance criteria, jobs, checkpoints, artifacts, evidence, claims, twin nodes, twin edges, model profiles, tool profiles, plugin profiles, candidates, candidate parents, verification results, issues, repairs, champion decisions, delivery receipts, training packets, capability profiles, practice tasks, promotions, avatar state, avatar unlocks, and outbox events.

### `packages/infrastructure/src/artifacts/content-addressed-store.ts`

**Inputs:** byte streams, metadata, and approved project path.  
**Outputs:** immutable location, hash, and byte size.  
**Internal functions:** `calculateHash`, `resolveStoragePath`, `writeAtomicArtifact`, `verifyWrittenHash`, `readArtifact`, `artifactExists`.

### `packages/infrastructure/src/gateways/model-gateway.ts`

**Inputs:** provider-neutral invocation.  
**Outputs:** provider-neutral result and evidence.  
**Internal functions:** `resolveAdapter`, `validateModelAvailability`, `enforceResourceBudget`, `invokeAdapter`, `normalizeResponse`, `recordInvocationEvidence`, `cancelInvocation`.

### `packages/infrastructure/src/gateways/tool-gateway.ts`

**Inputs:** typed tool request.  
**Outputs:** artifacts, logs, and evidence.  
**Internal functions:** `resolveTool`, `authorizeOperation`, `createWorkingCopy`, `invokeToolAdapter`, `captureOutputs`, `verifyExpectedOutputs`, `promoteOrRollbackOutputs`.

### `packages/infrastructure/src/gateways/production-kernel-gateway.ts`

**Inputs:** durable execution request.  
**Outputs:** kernel job ID, checkpoints, status, and evidence.  
**Internal functions:** `resolveKernelAdapter`, `validateKernelAuditStatus`, `startKernelJob`, `checkpointKernelJob`, `resumeKernelJob`, `stopKernelJob`, `collectKernelEvidence`.

### `plugins/fs25-mod-forge/src/workflows/fs25-production.workflow.ts`

**Required stages:** specification, reference collection, minimal scaffold, production, static verification, official GIANTS verification, disposable test farm, log analysis, targeted repair, performance/multiplayer checks, console eligibility, and clean package.

### `plugins/fs25-mod-forge/src/domain/console-eligibility.ts`

**Inputs:** mod type, scripts, assets, platform, and dependencies.  
**Outputs:** `pc_only`, `crossplay_candidate`, `dual_release_candidate`, and rejection reasons.  
**Internal functions:** `classifyScriptUsage`, `classifyAssetRestrictions`, `classifyDependencyRestrictions`, `calculateEligibility`.

### `plugins/fs25-mod-forge/src/integrations/giants-bridge.ts`

**Inputs:** FS25 stage and approved artifacts.  
**Outputs:** typed GIANTS adapter requests and evidence references.  
**Internal functions:** `runEditorInspection`, `runExporter`, `runTestRunner`, `runIconGenerator`, `launchTestFarm`, `collectGameLogs`.

### `plugins/video-production/src/services/render-cache-director.ts`

**Inputs:** video project, dependency graph, render tools, and storage state.  
**Outputs:** render queue, cache plan, proxy plan, and resume plan.  
**Internal functions:** `detectChangedInputs`, `identifyReusableFrames`, `generateProxyPlan`, `generateCachePlan`, `scheduleRenderJobs`, `resumeFailedJobs`, `invalidateDependentFrames`.

### `plugins/video-production/src/services/per-shot-optimizer.ts`

**Inputs:** representative frames, candidate profiles, thresholds, and budgets.  
**Outputs:** selected profile and comparison evidence.  
**Internal functions:** `selectRepresentativeFrames`, `renderProfileSamples`, `compareQuality`, `compareRuntime`, `rejectTemporalArtifacts`, `selectLowestPassingProfile`.

### `plugins/video-production/src/workflows/video-production.workflow.ts`

**Required sequence:** Preview → Analyze → Correct → Cache → Final Render → Frame Verification → Audio Verification → Resume Failed Work → Evidence Package.

### `labs/model-expansion/src/experiment-runner.py`

**Forbidden imports:** production database, production artifact writer, runtime plugin registry, and production secrets.  
**Inputs:** validated experiment, frozen base checkpoint, promoted packets, and frozen evaluation set.  
**Outputs:** isolated checkpoint, metrics, logs, and reproducibility manifest.  
**Internal functions:** `validate_experiment`, `load_frozen_baseline`, `load_training_packets`, `verify_evaluation_separation`, `run_experiment`, `evaluate_checkpoint`, `write_reproducibility_manifest`.

---

# 5. BOOTSTRAPPING & VERIFICATION STEP

## 5.1 Global build rule

```text
Specify
→ Create file
→ Type-check file
→ Test its responsibility
→ Verify dependency boundary
→ Commit checkpoint
→ Continue
```

No outer layer may be implemented before the inner layer it depends on is verified.

## 5.2 Phase 0: Governance

**Create:** `AGENTS.md`, architecture docs, repository map, dependency rules, ADRs, root configuration, and CI workflows.

**Verify:**

- [ ] Architecture version is consistent.
- [ ] No documents contradict each other.
- [ ] Workspace paths resolve.
- [ ] TypeScript, Python, and Rust strict checks are enabled.
- [ ] CI references existing commands only.

## 5.3 Phase 1: Domain value objects

**Create:** IDs, content hash, safe path, score, resource budget, domain errors, and events.

**Verify each:**

- [ ] Domain-local imports only.
- [ ] Invalid values rejected.
- [ ] Valid values round-trip.
- [ ] Immutable values.
- [ ] Boundary property tests.

## 5.4 Phase 2: Domain entities

**Create:** entities in tree order, then domain public exports.

**Verify:**

- [ ] Explicit creation rules.
- [ ] Valid and invalid transition tests.
- [ ] Immutable state.
- [ ] No candidate lineage cycles.
- [ ] Evidence immutability.
- [ ] Job recovery invariants.
- [ ] Training quarantine invariants.
- [ ] Avatar anti-gaming invariants.
- [ ] Zero infrastructure dependencies.

## 5.5 Phase 3: Contracts and schemas

**Create:** root schemas, shared Zod schemas, domain API schemas, runtime events, and adapter RPC schemas.

**Verify:**

- [ ] Requests reject invalid payloads.
- [ ] Responses serialize and parse.
- [ ] JSON Schema and Zod remain equivalent.
- [ ] Events include version and timestamp.
- [ ] No provider-specific payload leaks.
- [ ] No GitHub Models provider exists.

## 5.6 Phase 4: Application ports

**Create:** repositories, unit of work, artifact store, events, model/tool/plugin/kernel/verifier/policy/scheduler/resource/training/secret/clock ports.

**Verify each:**

- [ ] Depends only on domain types.
- [ ] No implementation imports.
- [ ] Typed errors.
- [ ] Cancellation for long operations.
- [ ] No external SDK types.
- [ ] Fake implementation is possible.

## 5.7 Phase 5: Application services

**Create:** compute governor, context compiler, diversity planner, evidence linker, improvement policy, champion selector, capability calculator, practice selector, avatar unlock engine.

**Verify:**

- [ ] Simple work can select Direct mode.
- [ ] Competitive mode creates actual diversity.
- [ ] Redundant configurations are rejected.
- [ ] Unrelated history is excluded.
- [ ] Failed mandatory checks cannot win.
- [ ] Cosmetic-only improvements are rejected.
- [ ] Capability scores require evidence.
- [ ] Avatar unlocks require independent evidence.

## 5.8 Phase 6: Application use cases

**Verify:**

- [ ] Every state change uses Unit of Work.
- [ ] Every committed change emits an outbox event.
- [ ] Every side effect uses a port.
- [ ] Failed transactions emit no event.
- [ ] Finish-stop checkpoints before stopping.
- [ ] Emergency stop preserves the last valid checkpoint.
- [ ] Original candidates never change.
- [ ] Repairs use working copies.
- [ ] Training packets begin quarantined.
- [ ] No-solution creates a valid receipt.

## 5.9 Phase 7: Persistence and artifacts

**Verify:**

- [ ] Empty database starts successfully.
- [ ] Migrations apply in order.
- [ ] State and events commit atomically.
- [ ] Evidence is append-only.
- [ ] Artifact writes are atomic.
- [ ] Hash is rechecked after writing.
- [ ] Duplicate content is deduplicated.
- [ ] Interrupted outbox publishing resumes.

## 5.10 Phase 8: Adapter and process infrastructure

**Verify:**

- [ ] Invalid manifests are rejected.
- [ ] Protocol mismatches are rejected.
- [ ] Adapter crashes do not crash runtime.
- [ ] Restart preserves job state.
- [ ] Adapters cannot access SQLite.
- [ ] Process output is captured.
- [ ] Paths remain inside approved boundaries.
- [ ] Idle practice requires 30 safe minutes.
- [ ] Unsafe resources block practice.

## 5.11 Phase 9: Gateways

**Verify:**

- [ ] Providers and tools are replaceable without use-case changes.
- [ ] Optional tools can be absent.
- [ ] Tool operations require policy approval.
- [ ] Outputs become artifacts before promotion.
- [ ] Kernel candidate remains isolated.
- [ ] Unaudited kernel cannot be silently promoted.
- [ ] Failures map to typed retryable or terminal errors.

## 5.12 Phase 10: Runtime API

**Verify:**

- [ ] Runtime starts without desktop.
- [ ] Invalid sessions are rejected.
- [ ] Every route validates input.
- [ ] Routes contain no business logic.
- [ ] Errors map deterministically.
- [ ] Event stream emits committed events only.
- [ ] Shutdown checkpoints active work.
- [ ] Restart recovers interrupted jobs.

## 5.13 Phase 11: SDK, CLI, and desktop

**Verify:**

- [ ] CLI works with dashboard closed.
- [ ] Desktop imports no persistence or domain implementations.
- [ ] UI store contains no authoritative state.
- [ ] Query cache reconnects.
- [ ] Job controls send typed commands.
- [ ] Avatar renders only runtime-provided unlocks.
- [ ] Removing desktop does not break runtime tests.

## 5.14 Phase 12: Plugin SDK and plugins

**Verify:**

- [ ] Every manifest validates.
- [ ] Plugins import Plugin SDK only.
- [ ] Plugins cannot access infrastructure internals.
- [ ] Removing a plugin does not break core startup.
- [ ] WorldMonitor can be removed completely.
- [ ] Required and optional tools are distinguished.

## 5.15 Phase 13: Model adapters

**Verify every adapter:**

- [ ] Manifest validates.
- [ ] Health check is deterministic.
- [ ] Invocation returns provider-neutral result.
- [ ] Cancellation is supported or declared unsupported.
- [ ] Secrets come from Secret Store only.
- [ ] Errors map to protocol errors.
- [ ] Capability metadata exists.
- [ ] No runtime persistence import.
- [ ] No GitHub Models adapter.

## 5.16 Phase 14: Tool adapters

**Priority:** Playwright/Git → research → Blender/Godot → 2D → FS25 → video acceleration → audio → optional advanced tools → Muse.

**Verify every adapter:**

- [ ] Manifest validates.
- [ ] Discovery avoids hard-coded paths.
- [ ] API/CLI is preferred over GUI automation.
- [ ] Writes use working copies.
- [ ] Expected outputs are declared.
- [ ] Logs and exit status are captured.
- [ ] Timeout and cancellation work.
- [ ] Missing software reports unavailable safely.
- [ ] No persistence access.
- [ ] Contract test passes.

## 5.17 Phase 15: FS25 Mod Forge

**Verify:**

- [ ] Scaffold contains only required files.
- [ ] XML references resolve.
- [ ] Lua correctly classifies PC-only behavior.
- [ ] I3D nodes and materials resolve.
- [ ] LOD, collision, animation, and attachment checks run.
- [ ] TestRunner output becomes evidence.
- [ ] Game logs map to source locations.
- [ ] Test saves remain isolated.
- [ ] Console eligibility runs before crossplay classification.
- [ ] Package excludes development files.
- [ ] Package is reproducible.

## 5.18 Phase 16: Video Production and Acceleration

**Verify:**

- [ ] Source, cache, intermediate, and final storage are separate.
- [ ] Unchanged frames are not rerendered.
- [ ] Changed inputs invalidate only dependents.
- [ ] Failed jobs resume completed work.
- [ ] Preview profiles cannot be promoted as final.
- [ ] Per-shot optimizer selects the lowest passing profile.
- [ ] Missing, duplicate, black, and frozen frames are detected.
- [ ] Audio clipping and sync are checked.
- [ ] VMAF is used only with a valid reference.
- [ ] Generative enhancement requires sampled visual verification.
- [ ] Final render receives complete evidence.

## 5.19 Phase 17: Self-improvement, Capability Atlas, and Avatar

**Verify:**

- [ ] Every packet references verified evidence.
- [ ] Original candidate lineage is preserved.
- [ ] Evaluation data cannot enter training storage.
- [ ] Promotion requires held-out testing.
- [ ] Regression failures block promotion.
- [ ] Capability scores include sample size and difficulty.
- [ ] Avatar rewards cannot use tokens or elapsed time.
- [ ] Every unlock links to immutable evidence.

## 5.20 Phase 18: Idle Practice

**Verify:**

- [ ] Practice cannot start before 30 safe idle minutes.
- [ ] User input blocks new practice work.
- [ ] Unsafe temperature/resources block practice.
- [ ] Practice cannot modify production projects.
- [ ] Outputs remain quarantined.
- [ ] Finish-stop creates a checkpoint.
- [ ] Emergency stop preserves the last valid checkpoint.
- [ ] Scores do not change before verification.

## 5.21 Phase 19: Model Expansion Laboratory

**Verify:**

- [ ] Lab cannot access production SQLite.
- [ ] Lab cannot write production artifacts.
- [ ] Only promoted packets load.
- [ ] Evaluation sets are read-only.
- [ ] Every experiment records seeds/configuration.
- [ ] Baseline and modified models use comparable conditions.
- [ ] Failed experiments remain isolated.
- [ ] No checkpoint is promoted automatically.

## 5.22 Final repository freeze gate

The repository structure is ready for application implementation only when:

- [ ] Every file in the deterministic tree exists.
- [ ] Every file has one mapped responsibility.
- [ ] Every package has a public API boundary.
- [ ] Dependency and forbidden-import tests pass.
- [ ] Every manifest validates.
- [ ] Every schema round-trips.
- [ ] Runtime starts without desktop.
- [ ] Runtime starts without optional tools.
- [ ] Runtime starts without WorldMonitor.
- [ ] Adapter and plugin contracts pass.
- [ ] Job recovery passes.
- [ ] Evidence immutability passes.
- [ ] No-solution behavior passes.
- [ ] Training quarantine passes.
- [ ] Avatar evidence rules pass.
- [ ] FS25 workflow structure passes.
- [ ] Video workflow structure passes.
- [ ] Model-expansion isolation passes.
- [ ] Documentation contains no `TBD`, `TODO`, or ambiguous ownership.
- [ ] Repository map matches the filesystem.
- [ ] Architecture version is consistent.

---

# SOURCE-OF-TRUTH ORDER

When files conflict, authority is resolved in this order:

1. `docs/repository-specification.md`
2. `docs/architecture.md`
3. Accepted ADRs
4. `docs/dependency-rules.md`
5. `docs/state-model.md`
6. Domain interfaces and invariants
7. Application ports
8. API and adapter contracts
9. Plugin manifests
10. Implementation
11. Tests

Implementation and tests must be corrected when they conflict with the approved architecture. They may not silently redefine it.
