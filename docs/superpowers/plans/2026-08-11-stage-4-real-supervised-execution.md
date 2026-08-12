# Stage 4 Real Supervised Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one real local system-build path in which an installed Ollama model creates a candidate, a supervised production kernel applies it in an isolated workspace, an independent supervised verifier executes a deterministic command, and interrupted execution reconciles exactly once after restart.

**Architecture:** Keep `hermetic_reference` as the default profile and add an explicit optional `supervised_local` composition. Three independent child processes communicate only through the existing bounded JSON-RPC/process infrastructure: the model adapter reads a runtime-materialized prompt and calls loopback Ollama, the kernel adapter owns a contained job workspace and idempotent checkpoint/apply state, and the verifier adapter runs an allowlisted Node verification command. Runtime-owned bridges promote bounded adapter outputs through `ArtifactStorePort`; adapters never read SQLite, and external work never runs inside an authoritative transaction.

**Tech Stack:** TypeScript 7 strict mode, Node.js 24, pnpm 11.17, Vitest 4, SQLite, Zod contracts `1.0.0`, newline-delimited JSON-RPC 2.0, supervised Node child processes, Ollama HTTP API, content-addressed artifacts.

**Execution status (2026-08-11): COMPLETE.** The task checklists below preserve the pre-execution
RED/GREEN plan. The executed implementation consolidated the planned boundary/profile tests into
`local-supervised-adapters.test.ts`, `supervised-job-execution.test.ts`, and the existing runtime/
infrastructure architecture suites. It also kept reference and supervised orchestration in the
existing `job-command-surface.ts` instead of creating the planned parallel
`reference-job-execution.ts`/`supervised-job-execution.ts` modules; small validation/hash helpers
were extracted solely to retain the 500-line limit. This is the smaller architecture-correct
result. Exact proof and defect evidence is in
`docs/reviews/stage-4-real-supervised-execution-proof.md`.

## Global Constraints

- Required baseline is `13791abf01e83f68130bc724676aa9636a896ae9` on `main`.
- The default runtime boot remains hermetic and requires no Ollama or Stage 4 child process.
- The real profile uses only already-installed model `devstral-small-2:24b`; never pull or update a model.
- Runtime remains authoritative; adapters access neither SQLite nor runtime-private persistence.
- External execution remains outside authoritative database transactions.
- Model output is untrusted and cannot certify itself; delivery depends only on independent verifier evidence.
- Production writes are workspace-relative, path-contained, size-bounded, timeout-bounded, and allowlisted.
- Reference adapters remain for hermetic tests but cannot enter the `supervised_local` success path.
- Source files remain at or below 500 lines and source contains no explicit `any`.
- No Stage 5, department adapter, CLI, desktop, laboratory, generic CRUD, or dashboard work enters this stage.

---

### Task 1: Freeze the execution-profile and adapter protocol boundaries — COMPLETE

**Files:**
- Modify: `apps/runtime/src/runtime-config.ts`
- Modify: `apps/runtime/tests/runtime-config.test.ts`
- Modify: `packages/infrastructure/src/gateways/supervised-model-gateway.ts`
- Modify: `packages/infrastructure/src/gateways/supervised-kernel-gateway.ts`
- Modify: `packages/infrastructure/tests/gateways.test.ts`

**Interfaces:**
- Consumes: strict adapter RPC `1.0.0`, `RuntimeConfig`, existing model/kernel ports.
- Produces: `ExecutionProfile = "hermetic_reference" | "supervised_local"` and contract-correct adapter calls.

- [ ] Write RED configuration tests proving reference is the default, supervised-local requires a loopback HTTP Ollama endpoint and canonical installed model identity, and malformed/non-loopback values fail closed.
- [ ] Run `pnpm --filter @v31m4/runtime test -- runtime-config.test.ts` and confirm the new assertions fail because profile configuration is absent.
- [ ] Add the smallest immutable execution-profile configuration and environment parsing; do not add arbitrary adapter-command configuration.
- [ ] Run the focused runtime-config test and confirm GREEN.
- [ ] Write RED gateway tests asserting model invocation excludes application-only `metadata`, kernel methods use `kernel.start_job`, `kernel.checkpoint_job`, `kernel.resume_job`, `kernel.stop_job`, and `kernel.job_status`, and each required invocation identifier/stage field is present.
- [ ] Run `pnpm --filter @v31m4/infrastructure test -- gateways.test.ts` and confirm the gateway translation assertions fail for the existing mismatch.
- [ ] Correct only the gateway translations while retaining application-port method signatures and contract version `1.0.0`.
- [ ] Rerun gateway tests and confirm GREEN.

### Task 2: Add a reusable supervised child-process invoker — COMPLETE

**Files:**
- Create: `packages/infrastructure/src/adapters/supervised-adapter-process.ts`
- Modify: `packages/infrastructure/src/processes/process-supervisor.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Create: `packages/infrastructure/tests/supervised-adapter-process.test.ts`
- Modify: `packages/infrastructure/tests/supervised-processes.test.ts`

**Interfaces:**
- Consumes: `ProcessSupervisor`, `JsonRpcClient`, `AdapterInvoker`.
- Produces: lazy `SupervisedAdapterProcess` with bounded RPC, restart after child exit, cancellation propagation, and graceful stop.

- [ ] Write RED tests using real fixture child processes for lazy start, typed invocation, malformed response, timeout, cancellation, process exit, restart, and idempotent stop.
- [ ] Write a RED environment test proving an unrelated secret-like parent variable is not inherited while explicit and allowlisted process variables are available.
- [ ] Run the focused infrastructure tests and confirm failures are caused by the absent invoker and inherited environment.
- [ ] Implement the lazy invoker over the existing supervisor/client, clearing dead clients on exit and never introducing a second RPC framework.
- [ ] Change process environments to an explicit safe OS allowlist plus adapter-specific values; retain argument-array spawn and process-group teardown.
- [ ] Rerun the focused process/RPC tests and confirm GREEN.

### Task 3: Implement the three bounded adapter processes — COMPLETE

**Files:**
- Create: `adapters/local-supervised/rpc-host.mjs`
- Create: `adapters/local-supervised/model-adapter.mjs`
- Create: `adapters/local-supervised/kernel-adapter.mjs`
- Create: `adapters/local-supervised/verifier-adapter.mjs`
- Create: `apps/runtime/tests/local-supervised-adapters.test.ts`

**Interfaces:**
- Consumes: newline-delimited JSON-RPC `2.0`, adapter request contract `1.0.0`, environment-provided contained execution root, loopback Ollama endpoint/model.
- Produces: real `model.invoke`, kernel lifecycle, and `tool.invoke` verification behavior without persistence access.

- [ ] Write RED hermetic process tests against the executable scripts using a local fake Ollama server and temporary roots; assert exact request/response shapes and real filesystem/process effects.
- [ ] Include negative RED cases for missing/unreachable Ollama, missing requested model, model timeout/cancel, malformed Ollama response, child exit, unsafe identifiers/paths, oversized model output, invalid/stale checkpoint, failed kernel resume, verifier failure/timeout/process exit, and malformed verifier result.
- [ ] Run the focused adapter test and confirm failures because the scripts do not exist.
- [ ] Implement `rpc-host.mjs` as a bounded line parser/response writer with closed method dispatch and no logging of request bodies or credentials.
- [ ] Implement `model-adapter.mjs`: read only `<input-root>/<promptArtifactId>.txt`, call only a configured loopback Ollama endpoint with the configured exact model, bound response bytes/time, disable model thinking for structured output, and atomically stage validated candidate text.
- [ ] Implement `kernel-adapter.mjs`: allow only the Stage 4 tiny-code workflow, create an isolated fixture, persist meaningful job/checkpoint state, hash the staged candidate, atomically apply it once, report durable status, and reject traversal/symlink/checkpoint mismatches.
- [ ] Implement `verifier-adapter.mjs`: allow only `verify_candidate`, run `node verify.mjs` with argument arrays in the kernel workspace, disable inherited network configuration, bound output/time, and derive status strictly from exit code.
- [ ] Rerun the adapter process tests and confirm GREEN.

### Task 4: Materialize authoritative model and verifier artifacts — COMPLETE

**Files:**
- Create: `apps/runtime/src/supervised/model-artifact-gateway.ts`
- Create: `apps/runtime/src/supervised/kernel-work-product-bridge.ts`
- Create: `apps/runtime/src/supervised/supervised-verifier.ts`
- Create: `apps/runtime/tests/supervised-execution-boundaries.test.ts`

**Interfaces:**
- Consumes: `ArtifactStorePort`, `UnitOfWorkPort`, `SupervisedModelGateway`, `SupervisedToolGateway`, `PathPolicy`, `VerifierPort`.
- Produces: authoritative artifact promotion and independent evidence translation.

- [ ] Write RED tests proving prompt bytes are materialized before adapter invocation, staged model output is bounded/validated and persisted through the existing artifact store, and a previously persisted deterministic invocation result avoids a second external call.
- [ ] Write RED tests proving the kernel bridge writes only the one allowlisted candidate inbox path, rejects absolute/traversal/symlink escapes, preserves identical retries, and rejects conflicting retries.
- [ ] Write RED tests proving verifier pass/fail derives from the supervised tool exit result, report artifacts are authoritative, evidence identifies verifier/check/exit status/candidate, and malformed/missing reports fail closed.
- [ ] Run the focused runtime boundary tests and confirm the classes are absent.
- [ ] Implement the three small runtime-owned bridges using existing ports and `PathPolicy`; keep all adapter staging non-authoritative until promoted through `ArtifactStorePort`.
- [ ] Rerun focused boundary tests and confirm GREEN.

### Task 5: Compose the explicit real profile without weakening default boot — COMPLETE

**Files:**
- Create: `apps/runtime/src/supervised/local-execution-composition.ts`
- Modify: `apps/runtime/src/composition-root.ts`
- Modify: `apps/runtime/src/bootstrap.ts`
- Modify: `apps/runtime/src/shutdown.ts`
- Modify: `apps/runtime/tests/architecture.test.ts`
- Create: `apps/runtime/tests/execution-profile.test.ts`

**Interfaces:**
- Consumes: three `SupervisedAdapterProcess` instances, supervised gateways, runtime artifact/workspace roots.
- Produces: reference or supervised-local execution dependencies selected only by validated config.

- [ ] Write RED composition tests proving default construction starts no child and uses all reference components, while supervised-local construction wires no reference model/verifier/kernel and lazily owns three distinct processes.
- [ ] Write RED shutdown tests proving children are stopped before SQLite closes.
- [ ] Run the focused composition tests and confirm the execution selection is absent.
- [ ] Implement `local-execution-composition.ts` as the sole adapter-binding owner and add async external-process shutdown to runtime teardown.
- [ ] Keep production boot optional: no adapter process or Ollama health requirement in the reference profile.
- [ ] Rerun composition, shutdown, dependency, file-size, and explicit-`any` checks and confirm GREEN.

### Task 6: Execute the real model → kernel → verifier → evidence workflow — COMPLETE

**Files:**
- Create: `apps/runtime/src/reference-job-execution.ts`
- Create: `apps/runtime/src/supervised-job-execution.ts`
- Modify: `apps/runtime/src/job-command-surface.ts`
- Modify: `apps/runtime/src/job-execution-infrastructure.ts`
- Create: `apps/runtime/tests/supervised-job-execution.test.ts`

**Interfaces:**
- Consumes: existing `runSolverForge`, `checkpointJob`, `verifyCandidates`, `selectChampionUseCase`, `deliverResult`, repositories, kernel, model, verifier, artifacts, and workspaces.
- Produces: profile-selected job execution with deterministic identities and no reference component in the supervised path.

- [ ] Write RED real-HTTP/real-SQLite tests with hermetic supervised fixture processes proving a model-produced candidate is persisted, the kernel applies it, the verifier executes, pass evidence gates champion/delivery, and failed verification blocks both.
- [ ] Assert no external call occurs while `SqliteRuntimeDatabase.inTransaction` is true and all produced state is readable through authoritative record/query surfaces.
- [ ] Run the focused job tests and confirm failure because job execution always constructs `ReferenceModelGateway` and reference verification.
- [ ] Extract the unchanged reference workflow without behavior changes so `job-command-surface.ts` remains focused and below 500 lines.
- [ ] Implement supervised execution with deterministic prompt/invocation/candidate/plan/evidence/checkpoint identities, an unverified integrity checkpoint before kernel apply, verifier-derived immutable evidence, and existing champion/delivery use cases.
- [ ] Finalize job state and direct-command idempotency in one transaction; keep external work before that transaction.
- [ ] Rerun focused positive/negative job execution and existing reference regressions and confirm GREEN.

### Task 7: Reconcile interrupted supervised execution after restart — COMPLETE

**Files:**
- Modify: `apps/runtime/src/supervised-job-execution.ts`
- Modify: `apps/runtime/src/job-command-surface.ts`
- Create: `apps/runtime/tests/supervised-restart-reconciliation.test.ts`

**Interfaces:**
- Consumes: durable job stage/checkpoint/candidate/evidence/decision/receipt state plus kernel `status`/`resume`.
- Produces: same-command restart reconciliation with exactly-once observable effects.

- [ ] Write a RED test that interrupts after the real kernel effect, shuts down the runtime, starts a brand-new composition against the same SQLite/workspace roots, retries the same idempotent `job.execute`, and expects verified delivery.
- [ ] Assert model inference count, kernel apply count, candidate, evidence, decision, and delivery are each exactly one; assert the checkpoint identity is unchanged.
- [ ] Add RED variants for interruption after model staging, stale checkpoint, invalid checkpoint, failed resume, concurrent execute, repeated idempotency key, and already-completed retry.
- [ ] Run the focused restart suite and confirm the current `executing` claim remains fail-closed without reconciliation.
- [ ] Implement runtime-instance ownership in persisted job stages: same-instance concurrency fails, a fresh runtime may CAS-claim interrupted work, and deterministic durable records are reused instead of duplicated.
- [ ] Reconcile from kernel status and the latest checkpoint; never clear a claim or infer external completion without durable kernel state.
- [ ] Rerun the restart/concurrency/idempotency suites and confirm GREEN.

### Task 8: Run the actual installed Ollama acceptance proof — COMPLETE

**Files:**
- Create: `apps/runtime/tests/stage-4-real-local.test.ts`
- Create: `scripts/prove-stage4-real.mjs`

**Interfaces:**
- Consumes: explicit `supervised_local` runtime profile, installed Ollama `0.32.7`, installed model `devstral-small-2:24b`.
- Produces: opt-in real HTTP/runtime/SQLite/artifact/workspace/process proof with truthful skip/block behavior outside the target host.

- [ ] Implement an opt-in test gated by `V31M4_STAGE4_REAL=1`; without the flag it reports a skip and never probes Ollama.
- [ ] Use a temporary isolated mission fixture whose deterministic verifier initially fails before candidate application; never modify V31M4 source as the work product.
- [ ] Run the explicit proof with the installed Ollama and at most three bounded model attempts; record exact model, Ollama version, adapter identities, artifact/evidence/checkpoint IDs, and counts.
- [ ] Include a real interruption after kernel apply followed by a fresh runtime composition and same-command reconciliation.
- [ ] Declare Stage 4 blocked—not passed—if actual inference, effect, independent verification, evidence-gated delivery, or restart reconciliation is absent.

### Task 9: Document and publish only verified truth — COMPLETE

**Files:**
- Create: `docs/reviews/stage-4-real-supervised-execution-proof.md`
- Modify: `docs/current-state.md`
- Modify: `docs/architecture.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`
- Modify: `packages/infrastructure/README.md`
- Modify: `apps/runtime/README.md` if runtime-owned execution instructions require a new nearest-module README.

**Interfaces:**
- Consumes: fresh hermetic and real target-host outputs.
- Produces: durable Stage 4 evidence and accurate ownership/current-state maps.

- [ ] Record baseline, exact model/Ollama version, execution profile, process architecture, materialization boundaries, kernel effect, verifier independence, positive/negative proof, checkpoint/restart proof, failure matrix, exact real command/result, hermetic result, defects, limitations, and next capability.
- [ ] Update architecture and both maps for every new owner/path; do not relabel reference adapters as real or claim all workflows are real.
- [ ] Run focused Stage 4 tests, owning runtime/infrastructure suites, cross-layer execution/recovery tests, and the explicit real proof.
- [ ] Run `pnpm check`, `git diff --check`, dependency tests, source-size scan, and explicit-`any` scan.
- [ ] Review the entire diff from `13791abf01e83f68130bc724676aa9636a896ae9` for reference fallback, self-verification, database/process/path boundary violations, optional-dependency leakage, and Stage 5 scope.
- [ ] If and only if the real proof passes, create coherent Stage 4/reconciliation commits, push `main` non-force, and verify local/tracking/live GitHub equality, 0 ahead/behind, and a clean worktree.
- [ ] Stop before Stage 5.
