# Items 1–9 Autonomous Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the sealed Stage 4 supervised path into bounded general software production, repair, routing, tools, learning, laboratory, practice, desktop, and CLI capabilities without creating another runtime or state authority.

**Architecture:** Preserve the existing project/mission/job HTTP contract and use a strict project-owned `.v31m4/build-packet.json` as the production input. Runtime-owned bridges validate and materialize contained working copies and authoritative artifacts; the existing model/tool/kernel/verifier ports remain the only external execution boundaries. Learning and practice reuse the current Layer 6 use cases and SQLite record substrate, while desktop and CLI consume a shared typed HTTP/SSE SDK.

**Tech Stack:** TypeScript 7 strict mode, Node.js 24, pnpm 11.17, Vitest 4, SQLite, Zod contracts `1.0.0`, supervised JSON-RPC child processes, Ollama, Git, Playwright, Python 3 with standard-library tests, optional Tauri 2 when Rust is present.

## Global Constraints

- Required starting `main` is `597ca2a0eaba64ce0d44efcd0defe2fa2e50b9a6`.
- Runtime remains the sole authority; interfaces, adapters, laboratories, and project workspaces never access runtime SQLite.
- External effects never execute inside a SQLite transaction and never bypass the existing model/tool/kernel ports.
- Model output is untrusted; independent verifier evidence alone gates champion, delivery, learning, and promotion.
- All project writes are contained in isolated working copies and honor packet-declared path/operation scope.
- `hermetic_reference` remains the dependency-free default; real profiles never silently fall back to it.
- Source files remain at most 500 lines, preferably below 400, with no explicit `any`.
- No Video/ComfyUI, Game/Summer, FS25, paid API, large model download, system installation, or unrelated department work.

## Program Status

| Item | Status | Commit | Pushed head |
|---|---|---|---|
| 1 General Real Coding Production | VERIFIED_COMPLETE | `feat: generalize supervised coding production` | `108c5571217ce2656bfdcd04ef651d232bb8b01d` |
| 2 Autonomous Verified Repair | VERIFIED_COMPLETE | `feat: add verified autonomous repair rounds` | `60202d40b064254b5d802c1e065cd89f993bd20d` |
| 3 Measured Model Routing | VERIFIED_COMPLETE | `feat: add measured model routing` | pending publication |
| 4 General Tool Execution Plane | NOT_STARTED | — | — |
| 5 Controlled Self-Improvement | NOT_STARTED | — | — |
| 6 Model Expansion Laboratory | NOT_STARTED | — | — |
| 7 Idle Practice Autonomy | NOT_STARTED | — | — |
| 8 Desktop Application | NOT_STARTED | — | — |
| 9 Headless CLI | NOT_STARTED | — | — |

---

### Task 1: General Real Coding Production

**Requirements:** Strict build packet; contained multi-file working copy; bounded model change manifest; real apply and deterministic commands; immutable evidence/delivery; negative paths and restart reuse.

**Existing owners:** `MissionContract`, `Project`, `startJob`, `runSolverForge`, `checkpointJob`, `verifyCandidates`, `ProductionKernelPort`, `ArtifactStorePort`, `PathPolicy`, `job-command-surface.ts`, and the three local supervised adapters.

**Files:**
- Create: `packages/contracts/src/software-production.schemas.ts`
- Create: `apps/runtime/src/supervised/software-production-workspace.ts`
- Modify: `apps/runtime/src/job-command-surface.ts`
- Modify: `apps/runtime/src/supervised/{local-execution-composition,model-artifact-gateway,kernel-work-product-bridge,supervised-verifier}.ts`
- Modify: `adapters/local-supervised/{model,kernel,verifier}-adapter.mjs`
- Test: `packages/contracts/tests/software-production.schemas.test.ts`
- Test: `apps/runtime/tests/general-coding-production.test.ts`

**Interfaces:** Consume the existing project/mission/job commands and port types. Produce a strict `SoftwareBuildPacket` and a runtime-owned `prepareSoftwareWorkspace(project, mission, jobId)` bridge; no new persistence or execution port.

- [x] Write contract RED tests for exact version, canonical relative paths, unique allowed paths/commands, forbidden overlap, budgets, and unknown fields; run them and observe missing exports.
- [x] Add the strict schema and public export; rerun contract tests GREEN.
- [x] Write real-workspace RED tests proving source copy, unrelated-file preservation, traversal/symlink/out-of-scope rejection, malformed change rejection, actual build/test failure blocking delivery, and restart/idempotency reuse.
- [x] Extend the runtime bridge and existing adapters minimally: validate `.v31m4/build-packet.json`, copy only contained project files, materialize bounded context, accept a closed multi-file change manifest, apply it atomically in the job working copy, and run only packet-declared argument-array commands.
- [x] Rerun focused runtime/infrastructure/contract suites and the opt-in installed-Ollama multi-file fixture.
- [x] Record `docs/reviews/general-coding-production-proof.md`, update truth maps, run the phase gate, commit `feat: generalize supervised coding production`, push non-force, and record the pushed head.

### Task 2: Autonomous Verified Repair

**Requirements:** Evidence-backed issues, immutable repaired lineage, focused plus full verification, strict repair budget, repeated-failure stop, restart reuse, and no verified solution on exhaustion.

**Existing owners:** `recordIssues`, `repairCandidate`, `ImprovementPolicy`, `CandidateRepositoryPort`, `VerifierPort`, and deterministic Stage 4 identities.

**Files:**
- Create: `apps/runtime/src/supervised/repair-orchestrator.ts`
- Modify: `apps/runtime/src/job-command-surface.ts`
- Modify: `adapters/local-supervised/model-adapter.mjs`
- Test: `apps/runtime/tests/autonomous-repair.test.ts`

**Interfaces:** Produce `runBoundedRepairRounds(...)` over existing use cases; every round creates new candidate/repair/evidence records and consumes `ResourceBudget.maxRepairRounds`.

- [x] Write RED HTTP/SQLite tests for successful second-candidate repair, exhaustion/identical failure, forbidden path, restart between rounds, and completed retry; retain owning process-exit/verifier-failure regressions.
- [x] Implement the smallest evidence-to-repair prompt and deterministic round identities; never mutate prior candidate/artifacts.
- [x] Prove the controlled success fixture and honest bounded failure with a real verifier, then pass a two-inference installed-Ollama repair proof.
- [x] Record `docs/reviews/autonomous-repair-proof.md`, update truth maps, gate, commit `feat: add verified autonomous repair rounds`, push, and record the published head.

### Task 3: Measured Model Routing

**Requirements:** Dynamic Ollama discovery, provider-neutral profiles, evidence/availability/budget routing, bounded escalation, provenance, and loopback-tested OpenAI-compatible transport without paid calls.

**Existing owners:** `ModelGatewayPort`, `ModelProfile`, `SupervisedModelGateway`, `CapabilityRepositoryPort`, secret leases, and model adapter process.

**Files:**
- Create: `packages/application/src/services/model-router.ts`
- Create: `adapters/local-supervised/openai-compatible-model-adapter.mjs`
- Modify: `apps/runtime/src/supervised/local-execution-composition.ts`
- Modify: `adapters/local-supervised/model-adapter.mjs`
- Test: `packages/application/tests/services/model-router.test.ts`
- Test: `apps/runtime/tests/model-routing-real.test.ts`

**Interfaces:** Produce a `ModelGatewayPort` decorator whose selection inputs are task requirements, verified measurements, health, context, and budget; return the exact chosen `modelId` in normal invocation provenance.

- [x] Write RED discovery/routing/escalation/budget/provenance tests with two complete provider-neutral profiles and a loopback remote fixture.
- [x] Implement dynamic `/api/tags` discovery and measured routing without provider types above infrastructure.
- [x] Run real local discovery and real inference with installed `qwen3:8b` plus `qwen2.5-coder:14b`.
- [x] Record `docs/reviews/model-routing-proof.md`, update truth maps, and prepare the phase gate; publication head is recorded after push.

### Task 4: General Tool Execution Plane

**Requirements:** Closed operations for bounded filesystem, Git inspection/diff, allowlisted package commands, Playwright, bounded loopback HTTP, health/discovery, evidence, timeout/cancel/cleanup, and governance.

**Existing owners:** `ToolGatewayPort`, `invokeTool`, `PolicyEnginePort`, `SupervisedToolGateway`, `ProcessSupervisor`, `PathPolicy`, and artifact/evidence stores.

**Files:**
- Create: `adapters/local-supervised/tool-adapter.mjs`
- Create: `apps/runtime/src/supervised/tool-artifact-gateway.ts`
- Modify: `apps/runtime/src/supervised/local-execution-composition.ts`
- Test: `apps/runtime/tests/general-tool-plane.test.ts`

**Interfaces:** Extend the existing supervised tool profile with a closed operation set; every invocation uses executable/argument arrays and workspace-relative paths and returns authoritative log/output artifacts.

- [ ] Write RED real-process tests for each allowed operation and for shell strings, traversal, symlinks, network, destructive Git, timeout, cancellation, missing executable, malformed output, and restart.
- [ ] Implement the closed adapter and artifact/evidence bridge; route risky actions through existing policy/approval.
- [ ] Prove a general coding mission uses actual Git/filesystem/package commands.
- [ ] Record `docs/reviews/general-tool-plane-proof.md`, gate, commit `feat: add governed real tool execution`, push, and update status/head.

### Task 5: Controlled Self-Improvement

**Requirements:** Verified-delivery packet compilation, secret/hidden-test exclusion, production/practice/experimental measurement separation, independent verification, immutable promotion, and restart durability.

**Existing owners:** `compileTrainingPacket`, `promoteCapability`, `TrainingPacket`, `CapabilityProfile`, `CapabilityCalculator`, training/capability ports, and SQLite record substrate.

**Files:**
- Create: `apps/runtime/src/learning-infrastructure.ts`
- Create: `apps/runtime/src/learning-surface.ts`
- Modify: `apps/runtime/src/composition-root.ts`
- Test: `apps/runtime/tests/controlled-self-improvement.test.ts`

**Interfaces:** Implement existing repository ports over the generic SQLite store and expose typed authenticated learning/capability queries/commands that call existing use cases.

- [ ] Write RED HTTP/SQLite/restart tests for quarantined packet creation, verified eligibility, bounded score update, immutable promotion, and all contamination/self-claim negatives.
- [ ] Implement repositories and thin runtime composition; keep evaluation independent and promotion transactional.
- [ ] Run a real delivered coding fixture through packet/evaluation/promotion.
- [ ] Record `docs/reviews/controlled-self-improvement-proof.md`, gate, commit `feat: connect controlled self improvement`, push, and update status/head.

### Task 6: Model Expansion Laboratory

**Requirements:** No production access; strict experiment schema; promoted snapshot loader; evaluation separation; seeded tiny experiment; baseline/three experiment definitions; reproducible result packet; no auto-promotion.

**Existing owners:** Frozen laboratory boundary and promoted training packet export only.

**Files:**
- Create: `labs/model-expansion/{README.md,pyproject.toml}`
- Create: `labs/model-expansion/src/model_expansion/{schema,packet_loader,evaluation_guard,experiment_runner}.py`
- Create: `labs/model-expansion/experiments/{depth_expansion,recurrent_depth,moe_upcycling}.json`
- Create: `labs/model-expansion/tests/test_lab.py`

**Interfaces:** Consume only exported packet snapshots and lab-local datasets; produce lab-local JSON result/reproducibility artifacts.

- [ ] Write Python unittest RED cases for deterministic runs, baseline preservation, contamination, path escape, production SQLite/artifact denial, and failed non-promotion.
- [ ] Implement with Python standard library and immutable input hashing; run the seeded synthetic experiment.
- [ ] Record `docs/reviews/model-expansion-lab-proof.md`, gate, commit `feat: add isolated model expansion lab`, push, and update status/head.

### Task 7: Idle Practice Autonomy

**Requirements:** Idle/resource/policy/no-active-job gate; isolated execution; real verifier; practice-tagged evidence; stop on activity/job/pressure/timeout/failure/shutdown; no production contamination or direct promotion.

**Existing owners:** `runIdlePractice`, `stopIdlePractice`, `PracticeSelector`, resource/workspace/practice ports, model/tool/verifier composition.

**Files:**
- Create: `apps/runtime/src/practice-infrastructure.ts`
- Create: `apps/runtime/src/practice-surface.ts`
- Modify: `apps/runtime/src/composition-root.ts`
- Test: `apps/runtime/tests/idle-practice-execution.test.ts`

**Interfaces:** Implement the existing practice repository and a bounded runtime coordinator; practice remains normal application state but its workspace/evidence classification cannot enter production promotion.

- [ ] Write RED runtime/SQLite tests for every idle gate, one real bounded practice execution, user/job interruption, cleanup, restart, and production separation.
- [ ] Implement the repository/coordinator and existing-use-case composition without an infinite loop in tests.
- [ ] Record `docs/reviews/idle-practice-proof.md`, gate, commit `feat: add safe idle practice execution`, push, and update status/head.

### Task 8: Non-Authoritative Desktop Client

**Requirements:** Shared typed client, React/Vite UI over HTTP/SSE, no authority imports, required screens/interactions, reconnect/auth/restart browser proof, and optional native Tauri only when Rust exists.

**Existing owners:** Runtime HTTP/SSE contracts and current operator UI behavior.

**Files:**
- Create: `packages/runtime-sdk/`
- Create: `packages/ui-kit/`
- Create: `apps/desktop/`
- Test: `packages/runtime-sdk/tests/client.test.ts`
- Test: `apps/desktop/tests/desktop-browser.test.ts`

**Interfaces:** `RuntimeClient` sends typed commands/queries and reconnects SSE by sequence; React owns preferences only.

- [ ] Write RED SDK tests for auth, typed command/query parsing, SSE replay/reconnect, errors, and restart.
- [ ] Implement the dependency-light SDK, then RED component/browser tests for required screens and interactions.
- [ ] Implement React/Vite with TanStack Query and preference-only Zustand; no runtime/domain/infrastructure implementation imports.
- [ ] Run Playwright against a real runtime. If Cargo is absent, mark native packaging `PARTIALLY_COMPLETE_EXTERNAL_BLOCKER` while keeping the web client verified.
- [ ] Record `docs/reviews/desktop-application-proof.md`, gate, commit truthfully, push, and update status/head.

### Task 9: Headless CLI

**Requirements:** Required command tree; human/JSON output; runtime-only access; safe token handling; nonzero failures; restart persistence; shared SDK.

**Existing owners:** `packages/runtime-sdk` and authoritative runtime commands/queries.

**Files:**
- Create: `apps/cli/{package.json,tsconfig.json,src/main.ts}`
- Create: `apps/cli/tests/cli-e2e.test.ts`

**Interfaces:** The executable translates CLI arguments to `RuntimeClient`; it contains formatting and exit-code logic only.

- [ ] Write RED real-process tests for the full command tree, JSON errors, bad auth/command, and secret non-disclosure.
- [ ] Implement argument parsing and output without duplicating application rules.
- [ ] Run real runtime create→mission→job→execute→evidence and restart E2E.
- [ ] Record `docs/reviews/cli-proof.md`, gate, commit `feat: add headless runtime cli`, push, and update status/head.

### Task 10: Integrated Acceptance and Completion Audit

**Files:**
- Create: `docs/reviews/items-1-9-autonomous-completion-audit.md`
- Modify: `docs/{current-state,architecture,repository-map}.md`
- Modify: `repo_map.md`

**Interfaces:** Consume the final executable proofs; produce only verified current truth.

- [ ] Drive fresh missions through CLI and desktop against one authoritative runtime, including real model/tool execution, a repair, verifier-gated delivery, learning, practice, restart, and shared-state readback.
- [ ] Rerun Stage 4 and all phase real proofs, Python lab gate, desktop/browser gate, CLI E2E, `pnpm check`, build, diff, dependency/source-size/explicit-any scans.
- [ ] Record fresh counts and blockers, review the complete diff from the required start, commit the audit/truth update, push non-force, and verify local/tracking/live equality with a clean worktree.
