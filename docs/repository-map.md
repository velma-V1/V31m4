# V31M4 Repository Ownership Map

## Current implemented ownership

| Path | Owner | Responsibility |
|---|---|---|
| `/AGENTS.md` | Repository governance | Mandatory human and AI contribution rules |
| `/repo_map.md` | Repository governance | Exact current implementation state |
| `/docs` | Architecture governance | Source-of-truth architecture, versioning, planning, reviews, and implementation evidence |
| `/schemas` | Contract governance | Portable draft 2020-12 schemas for manifests, workflows, evidence, learning, capabilities, and achievements |
| `/packages/domain/src/value-objects` | Domain core | Canonical validated primitive values |
| `/packages/domain/src/entities` | Domain core | Immutable entities, invariants, decisions, and lifecycle transitions |
| `/packages/domain/src/index.ts` | Domain core | Public domain package API only |
| `/packages/domain/tests` | Domain verification | Layer 1 regression and Layer 2 behavior verification |
| `/packages/contracts/src/common.schemas.ts` | Contract core | Versions, branded primitives, safe JSON, pagination, and API errors |
| `/packages/contracts/src/approvals.schemas.ts` | Contract core | Strict approval record, governed plugin-registration, decision, and approval-list payloads |
| `/packages/contracts/src/software-production.schemas.ts` | Contract core | Strict project-owned general coding build packet: scope, file operations, deterministic checks, and budgets |
| `/packages/contracts/src/adapter-rpc-v1_1.schemas.ts` | Contract core | Additive, separately negotiated adapter protocol `1.1.0`: task/workspace/sandbox/semantic-operation-scoped tool invocation, structured agent invocation (`model.invoke_agent`), 1.1 initialization, exact-version negotiation; never mutates the published `1.0.0` schemas |
| `/packages/contracts/src/agent-turn.schemas.ts` | Contract core | The provider-neutral agent-turn output contract (`tool_call` \| `finish` \| `defer`), its own version, the reasoning policy (`disabled` \| `enabled` \| `auto`), the bounded context budget, and the private-reasoning guard applied at every depth |
| `/packages/contracts/src/*-schemas.ts` | Contract core | Strict bounded API, event, workflow, and adapter payload schemas |
| `/packages/contracts/src/index.ts` | Contract core | Public contracts package API only |
| `/packages/contracts/tests` | Contract verification | Runtime contract, protocol, compatibility, JSON Schema, and parity verification |
| `/packages/application/src/application-json.ts` | Application core | Safe finite acyclic internal JSON values without contract-layer dependency |
| `/packages/application/src/application-errors.ts` | Application core | Typed orchestration and dependency failures with immutable details |
| `/packages/application/src/operation-context.ts` | Application core | Actor, correlation, idempotency, cancellation, and deadline context |
| `/packages/application/src/port-types.ts` | Application core | Pagination, revisions, health, receipts, and subscriptions |
| `/packages/application/src/ports` | Application boundary | Twenty-seven infrastructure-free persistence, execution, governance, and operations ports, plus the semantic execution capability module |
| `/packages/application/src/ports/sandbox.port.ts` | Application boundary | Typed sandbox lifecycle and the fail-closed `SandboxIsolationPolicy` the public `ResourceBudget` cannot express; keeps the internal `unknown` effect status out of the public v1 tool status |
| `/packages/application/src/ports/semantic-execution-capability.ts` | Application boundary | Closure-owned mint/verify/consume authority for `AuthorizedSemanticExecutionPlan`: issuer-bound authenticity, single-use consumption, immutable policy provenance plus canonical risk/evidence/resource bounds, expiry recheck at the sink, and the workspace currency precondition a sandbox re-verifies at dispatch |
| `/packages/application/src/services` | Application services | Ten deterministic, infrastructure-free decision and planning services, including verified-measurement model routing (Layer 5) |
| `/packages/application/src/services/internal` | Application services | Private deterministic helpers; never exported |
| `/packages/application/src/use-cases` | Application use cases | Twenty-one canonical production entrypoints, two approval-lifecycle entrypoints, and private pagination/authorization helpers |
| `/packages/application/src/index.ts` | Application core | Public application package API only (ports, services, use cases) |
| `/packages/application/tests` | Application verification | Ports, services, use cases, dependency boundaries, failure paths, and source-size checks |
| `/packages/infrastructure/src/database` | Persistence infrastructure | Layer 7 SQLite authority, migrations, revisions, records, durable idempotency, and unit-of-work implementation |
| `/packages/infrastructure/src/events` | Event infrastructure | Transactional outbox plus durable committed-event replay used by Layer 10 |
| `/packages/infrastructure/src/artifacts` | Artifact infrastructure | Atomic SHA-256 content-addressed artifact storage |
| `/packages/infrastructure/src/backup` | Recovery infrastructure | Verified SQLite backup manifests and staged restore |
| `/packages/infrastructure/src/processes` | Process infrastructure | Layer 8 supervised child-process lifecycle, process-group shutdown, explicit environment inheritance, cancellation, timeout, bounded stderr plus opt-in combined stdout+stderr output bounding, and the termination reason callers need to reconcile external side effects |
| `/packages/infrastructure/src/rpc` | Adapter RPC infrastructure | Layer 8 bounded JSON-RPC framing/correlation and protocol handling |
| `/packages/infrastructure/src/adapters` | Adapter infrastructure | Layer 8 adapter registration under an explicitly injected closed protocol-version set, restart-budget protection, and the lazy restartable supervised JSON-RPC process invoker |
| `/packages/infrastructure/src/scheduling` | Scheduling infrastructure | Layer 8 bounded scheduling implementation |
| `/packages/infrastructure/src/resources` | Resource infrastructure | Layer 8 resource monitoring implementation |
| `/packages/infrastructure/src/secrets` | Secret infrastructure | Layer 8 bounded secret-lease implementation |
| `/packages/infrastructure/src/logging` | Logging infrastructure | Layer 8 structured/redacted logging support |
| `/packages/infrastructure/src/paths` | Path governance | Layer 9 real-path containment policy |
| `/packages/infrastructure/src/policy` | Policy infrastructure | Layer 9 fail-closed rule-based policy engine |
| `/packages/infrastructure/src/plugins` | Plugin infrastructure | Layer 9 durable plugin registry implementation |
| `/packages/infrastructure/src/gateways` | Governed execution infrastructure | Layer 9 provider-neutral supervised model/tool/production-kernel gateways |
| `/packages/infrastructure/src/sandbox` | Sandbox infrastructure | V31M4-owned `SandboxPort` lifecycle: an issued single-use capability with final-edge expiry verification, canonical workspace root and authoritative `WorkspaceManagerPort` re-read under an execution-lease interlock, mutually exclusive execution/lifecycle claims, ready-only dispatch, hardened path containment, compare-and-apply as the only workspace write, the hermetic reference backend, and the direct-Docker challenger — strict settings, catalog/backend resource ceilings, collision-resistant names, label-verified cleanup by container ID, supervised live Docker inspection, and retained degraded state whenever execution or cleanup remains indeterminate; backend selection stays open until a target-host bake-off |
| `/packages/infrastructure/src/pagination-cursor.ts` | Infrastructure boundary support | Exact canonical safe-integer parsing shared by infrastructure list adapters and runtime external pagination |
| `/packages/infrastructure/tests` | Infrastructure verification | Layers 7–10 persistence/process/gateway/replay integration and failure-path tests |
| `/apps/runtime` | Authoritative runtime | Layer 10 composition, local auth, typed command/query/event HTTP routes, idempotent external commands, durable replay, resumable SSE, recovery, and shutdown |
| `/apps/runtime/src/composition-root.ts` | Runtime composition | The one place concrete adapters, policy rules, and command/query surfaces are assembled; owns the test-only `CompositionOverrides` seam and exposes no generic authoritative write command |
| `/apps/runtime/src/job-command-surface.ts` + `job-start-command.ts` + `job-verification-plan.ts` + `routed-solver.ts` | Runtime job command composition | Direct `job.start`/`job.execute` registration, durable idempotency, execution claim/reconciliation, bounded model escalation, build-packet preparation, repair composition, and champion/delivery finalization |
| `/apps/runtime/src/supervised` | Runtime supervised boundary | Optional local profile composition, authoritative prompt/model/report artifact promotion, contained project-copy/current-context preparation, bounded kernel work-product materialization, evidence-driven repair orchestration/checkpoint reconciliation, and independent verifier evidence translation |
| `/apps/runtime/src/approval-surface.ts` | Runtime governance boundary | Strict `plugin.register`, `approval.decide`, and `approval.list` registration over existing policy/approval/audit/plugin ports |
| `/apps/runtime/src/list-query-surface.ts` | Runtime query boundary | Strict authenticated `model.list`, `mission.list`, `job.list`, `candidate.list`, and `evidence.list` registration, filter-before-pagination, relationship validation, existing-port dispatch, and typed response shaping |
| `/apps/runtime/src/model-catalog.ts` | Runtime model query support | Shared bounded complete-catalog traversal over opaque `ModelGatewayPort` pagination, with malformed totals/cursors, cycles, duplicates, and resource exhaustion refused before query filtering or routing |
| `/apps/runtime/src/record-listing.ts` | Runtime persistence adapter support | Shared relationship-filter-before-pagination implementation so record items, totals, and cursors remain inside the requested authoritative boundary |
| `/apps/runtime/src/autonomy` | Autonomy runtime | The single V31M4-owned semantic operation catalog (19 model-facing operations, deliberately no `git.worktree`) plus the mandatory semantic authorization boundary: it snapshots the request, evaluates the existing `PolicyEnginePort`, binds immutable policy provenance and canonical risk/evidence/resource policy into the capability, derives trusted execution from the catalog, permits caller-supplied commands only for `command.run`, and attaches the workspace currency precondition the sandbox re-verifies at dispatch |
| `/apps/runtime/src/autonomy/agent-turn-loop.ts` | Autonomy runtime | The governed iterative loop: authoritative context rebuilt from the Task Capsule and folded Ledger before every turn, runtime revalidation of every model turn the adapter already validated, catalog/manifest/role checks, canonical authorization, deterministic no-progress detection from recorded intent fingerprints, governed execution, and turn/tool/defer/refusal/context budgets. `finish` ends a run as ready for independent verification and certifies nothing |
| `/apps/runtime/src/use-case-infrastructure.ts` | Runtime adapters | Layer 4 port adapters backing real use-case commands and project/mission/job queries: SQLite repositories, event bus, `ReferenceProductionKernel`, approval/audit stores, `passthroughUnitOfWork` |
| `/apps/runtime/src/job-execution-infrastructure.ts` | Runtime adapters | Candidate/evidence SQLite repositories backing execution and list queries, real isolated workspace filesystem (`LocalWorkspaceManager`), and the `ReferenceModelGateway`/`ReferenceVerifier` reference adapters driving `job.execute` |
| `/apps/runtime/public/index.html` | Operator UI | Minimal real browser UI (session token, health, project/mission/job-start/job-execute panels, SSE-over-fetch live event log); no framework/build step; full workflow, displayed state, authenticated SSE/reconnect, restart recovery, and negative authentication path proven in real Chromium |
| `/apps/runtime/tests` | Runtime verification | Typed command/query/governance, approval anti-forgery, idempotency, negative verification, supervised model/kernel/verifier effects, exactly-once restart recovery, filter-before-pagination, strict cursors/config, SSE, source-size, real Playwright Chromium, and opt-in real-Ollama regressions against real HTTP + SQLite |
| `/adapters/local-supervised` | Optional local execution adapters | SQLite-free bounded JSON-RPC children for dynamic Ollama and loopback-tested OpenAI-compatible inference, manifest kernel lifecycles, atomic contained file effects, and independent Node verification. The model adapter additionally serves protocol-1.1 structured agent turns beside its unchanged legacy path: provider-neutral reasoning policy translated to `think` here and nowhere else, a configurable hard byte ceiling instead of the fixed 64 KiB autonomy limit, an explicit token budget as `num_ctx`, oversize refused rather than truncated, and no reasoning trace ever returned or written |
| `/scripts/prove-autonomy-phase1-real.mjs` | Target-host verification | Explicit opt-in Task 1 boundary proof: real workspaces/catalog/sandbox supervisor plus the hardened direct-Docker backend when a container runtime and digest-pinned image exist; reports missing prerequisites honestly |
| `/docs/reviews/autonomy-task1-phase1-evidence.md` | Architecture governance | Task 1 scoped-ACI/`SandboxPort`/adapter-1.1 evidence, protocol-1.0 preservation proof, and the unproven direct-Docker boundary |
| `/scripts/prove-agent-turn-real.mjs` | Target-host verification | Explicit opt-in Task 4 proof of the whole real path — governed loop, real gateway, real adapter child, real Ollama, real model — covering tool_call/finish/defer, out-of-manifest refusal, repeated-action refusal, reasoning modes, the practical 32K context target, oversize refusal, budgets, and the legacy invocation; reports `BLOCKED_ENVIRONMENT` rather than proving nothing |
| `/docs/reviews/autonomy-task4-agent-turn-evidence.md` | Architecture governance | Task 4 structured-agent-turn evidence: protocol-1.0 preservation, the 1.1 agent addition, the no-model-tool-path and no-persisted-reasoning proofs, and the measured target-host results |
| `/scripts/prove-model-routing-real.mjs` | Target-host verification | Explicit opt-in two-installed-model discovery/routing/inference proof; excluded from the hermetic gate |
| `/docs/reviews/model-routing-proof.md` | Architecture governance | Item 3 discovery, routing, fallback provenance, remote transport, defect, and target-host evidence |
| `/scripts/prove-general-coding-real.mjs` | Target-host verification | Explicit opt-in installed-Ollama general coding-production acceptance command; excluded from the hermetic default gate |
| `/docs/reviews/general-coding-production-proof.md` | Architecture governance | Item 1 real multi-file production, negative, restart, transaction-safety, and architecture evidence |
| `/scripts/prove-autonomous-repair-real.mjs` | Target-host verification | Explicit opt-in installed-Ollama fail-diagnose-repair acceptance command; excluded from the hermetic default gate |
| `/docs/reviews/autonomous-repair-proof.md` | Architecture governance | Item 2 real repair, immutable lineage, exhaustion, scope refusal, replay, and restart-reconciliation evidence |
| `/scripts/prove-stage4-real.mjs` | Target-host verification | Explicit opt-in actual-Ollama Stage 4 acceptance command; excluded from the hermetic default gate |
| `/docs/reviews/stage-4-real-supervised-execution-proof.md` | Architecture governance | Exact local model/process/artifact/kernel/verifier/restart evidence, failure matrix, confirmed defects, and honest remaining capability boundary |
| `/docs/reviews/stage-3-system-integrity-drift-audit.md` | Architecture governance | Stage 3 evidence, confirmed defect ledger, three independent drift passes, reconciliation, critical path, and trajectory verdict |
| `/packages/department-host` | Department host | Post-core generic removable-department lifecycle, isolation connector, rollback, manifest/version/permission/dependency checks |
| `/plugins/video-production` | Video Production | Post-core removable video workflow; reference adapters plus target-host-validated ffmpeg Assembly and ffmpeg+Ollama Vision-QC adapters |
| `/plugins/game-production` | 3D/Game Production | Post-core removable game workflow; existing Asset/SceneBuild/SceneValidation/Package ports with deterministic reference adapters; real adapters target Summer |
| `/apps/departments-integration` | Department integration verification | Post-core independence matrix: zero departments, both together, cross-removal independence, host remains operable |
| `/docs/reviews/target-host-validation.md` | Target-host evidence | Real external-tool capability matrix, honesty rule, and per-adapter validation evidence |
| `/docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md` | Game architecture governance | Approved Summer execution-platform decision behind existing Game adapter ports |

## Historical/deferred design ownership

| Path | Owner | Responsibility |
|---|---|---|
| `/docs/deferred/video-production` | Video Production historical design | Preserved pre-implementation Video design and still-relevant future production direction |
| `/docs/deferred/game-production` | 3D/Game Production historical design | Preserved pre-implementation Game design; real-engine integration section superseded by the Summer boundary decision |
| `/docs/superpowers/specs/2026-08-07-defer-video-game-departments-design.md` | Architecture governance | Historical sequencing decision that separated both departments from core completion; department-shell deferral is resolved |
| `/docs/superpowers/plans/2026-08-07-defer-video-game-departments.md` | Architecture governance | Historical documentation-only plan for that separation |

These paths are historical/preserved design records, not evidence that the department shells remain deferred. Both departments are implemented post-core and remain removable. The still-pending work is adapter-specific real external-tool integration: Video `ShotGenerationAdapter` and Game's Summer-backed real adapters.

## Current dependency graph

```text
apps/runtime
    ↓
packages/infrastructure
    ↓
packages/application
    ↓
packages/domain

packages/contracts ─────→ packages/domain

packages/department-host ─────→ packages/application + packages/domain

apps/departments-integration
    ↓
packages/department-host + plugins/video-production + plugins/game-production

plugins/video-production ─────→ packages/department-host + packages/application
plugins/game-production  ─────→ packages/department-host + packages/application
```

`packages/department-host` declares `@v31m4/infrastructure` only as a dev dependency for tests/support, not as a runtime dependency. Authoritative dependency rules are in `docs/dependency-rules.md`. The frozen core imports no department package. Video and Game do not import each other. Department runtime code must not gain a runtime dependency on `@v31m4/infrastructure`; real external tools remain behind department-local typed adapters.

## Contract ownership

| Contract group | Files | Strict responsibility |
|---|---|---|
| Common boundary | `common.schemas.ts` | Versioning, canonical primitives, safe recursive JSON, request metadata, pagination, and errors |
| Runtime resources | `projects.schemas.ts`, `missions.schemas.ts`, `jobs.schemas.ts`, `evidence.schemas.ts`, `approvals.schemas.ts`, `capabilities.schemas.ts`, `learning.schemas.ts` | Authoritative resource command, query, governance state, evidence, verification, delivery, promotion, training-packet, and capability-profile payloads |
| Capability endpoints | `models.schemas.ts`, `tools.schemas.ts`, `plugins.schemas.ts`, `practice.schemas.ts`, `avatar.schemas.ts` | Provider-neutral capability discovery, invocation, workflow, practice, and avatar payloads |
| Event stream | `runtime-events.schemas.ts` | Closed, versioned, aggregate-consistent client event union |
| Adapter protocol 1.0 | `adapter-rpc.schemas.ts` | Closed, immutable JSON-RPC requests, notifications, results, and errors |
| Adapter protocol 1.1 | `adapter-rpc-v1_1.schemas.ts` | Additive side-by-side scoped tool invocation, structured agent invocation, and 1.1 initialization plus exact-version negotiation; a 1.0 parser rejects every construct in it |
| Agent turn contract 1.0 | `agent-turn.schemas.ts` | Bounded actionable model output only — one allowed operation, readiness for verification, or an inability to proceed — with no chain-of-thought field and a private-reasoning guard at every depth |
| Portable schemas | `/schemas/*.schema.json` | External manifest and portable-record validation independent of TypeScript |

## Application port ownership

| Port group | Files | Strict responsibility |
|---|---|---|
| Atomic persistence | `unit-of-work`, project, mission, job, evidence, candidate, capability, workflow, training ports | Transactions, optimistic concurrency, append-only records, and durable aggregate access |
| External execution | artifact, event, model, tool, plugin, kernel, verifier ports | Provider-neutral execution, cancellation, health, artifact integrity, and committed event publication |
| Governance | policy, approval, audit ports | Separate authorization decisions, approval lifecycle, and append-only execution history |
| Operations | scheduler, resource, secret, clock, workspace, sandbox, configuration, backup ports | Durable scheduling, system readings, bounded secrets, deterministic time, workspace and sandbox isolation, configuration, and recovery |

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
registration, approval request/decision, and governed model/tool invocation. Exact reconciliation decisions are in
`docs/reviews/layer-6-reconciliation-matrix.md`.

## Post-core department ownership

- `packages/department-host` owns only generic department lifecycle/installation/removal/isolation semantics. Its runtime dependencies are the public `@v31m4/application` and `@v31m4/domain` packages; it does not contain Video or Game business logic.
- `plugins/video-production` owns Video-specific orchestration and its adapter implementations. Real external process invocation remains inside the plugin boundary and does not create a core runtime dependency.
- `plugins/game-production` owns Game-specific orchestration and its existing neutral adapter ports. Summer is the approved primary real execution platform behind those ports; no Summer-specific type belongs in core packages.
- `apps/departments-integration` owns cross-department independence verification only; it is not a production orchestration owner.

## Update rule

Every implementation or architectural change must update this ownership map and the root `repo_map.md` in the same change when ownership/current-state meaning changes. A path may not be added without an owner and one strict responsibility.
