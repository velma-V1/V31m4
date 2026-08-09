# Canonical Layers 6–10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the hardened Layer 5 SHA through one canonical, tested, documented, and reviewable Layers 6–10 implementation line.

**Architecture:** Reconcile Layer 6 selectively against hardened ports and services, then add SQLite infrastructure, supervised adapters, production gateways, and an authoritative Fastify runtime. Durable state, idempotency, optimistic concurrency, transactional events, isolation, and recovery remain explicit boundaries.

**Tech Stack:** TypeScript 7 strict mode, Node.js 24, pnpm 11.17, Vitest 4, SQLite/Drizzle, Fastify, WebSocket, Zod, Pino, Biome, and Turborepo.

## Global Constraints

- Immutable root is `5746e5f2571a08dea3cce0493adeac92ae025135`.
- The old Layer 6 SHA is read-only reference and is never cherry-picked wholesale.
- Dependencies point inward exactly as documented in `docs/dependency-rules.md`.
- Every authoritative mutation is transactional and every mutable write is revision-conditional.
- External execution never occurs while an authoritative database transaction is open.
- Source files remain below 500 lines; no explicit `any` enters source.
- Each layer ends with focused tests, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm check`, architecture checks, documentation updates, and one commit.

---

### Task 1: Canonical Layer 6 reconciliation

**Files:**
- Create: `packages/application/src/use-cases/*.ts`
- Create: `packages/application/tests/use-cases/*.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify only when required by proven parity: practice domain/contract/port files
- Update: architecture, dependency rules, repository maps, Layer 6 evidence ledger

**Interfaces:**
- Consumes: hardened domain public API, `OperationContext`, `WriteCondition`, `UnitOfWorkPort`, 26 application ports, and nine Layer 5 services.
- Produces: the 21 exported use-case functions named in the repository specification and one bounded practice repository port if not already expressible.

- [x] Add failing public-API tests for all 21 use cases.
- [x] Add failing behavior tests for transaction rollback, phased external execution, kernel/model/tool/verifier failure, cancellation/deadline, pagination repetition, approval exact expiry, stale revisions, and practice workspace cleanup.
- [x] Port the 16 correction-classified use cases against hardened interfaces without copying superseded dependencies.
- [x] Implement the five bounded redesigns using current Layer 5 service contracts.
- [x] Run focused application tests and prove every new regression test fails without its corresponding behavior.
- [x] Run all native gates and dependency/source-size/explicit-any checks.
- [x] Update architecture, ownership maps, acceptance checklist, and Layer 6 evidence; commit `feat: reconcile canonical application use cases layer`.

### Task 2: Layer 7 SQLite persistence and artifacts

**Files:**
- Create: `packages/infrastructure/src/database/*`, `repositories/*`, `events/*`, `artifacts/*`, `backup/*`
- Create: `packages/infrastructure/tests/database/*`, `repositories/*`, `events/*`, `artifacts/*`, `backup/*`
- Create: `packages/infrastructure/package.json`, `tsconfig.json`, `src/index.ts`
- Update: root lockfile, architecture, dependency rules, repository maps, ADRs, evidence ledger

**Interfaces:**
- Consumes: Layer 4 ports and domain public API.
- Produces: `SqliteUnitOfWork`, repository implementations, `SqliteOutbox`, `SqliteIdempotencyStore`, `ContentAddressedArtifactStore`, and `SqliteBackupStore`.

- [x] Write failing real-SQLite tests for empty startup, ordered migrations, rollback, nested transaction rejection, compare-and-swap, project scoping, immutable append conflicts, and atomic outbox commits.
- [x] Implement migrations and unit-of-work transaction ownership.
- [x] Implement mutable and append-only repositories with exact revision behavior.
- [x] Write failing tests for duplicate outbox delivery, restart recovery, artifact deduplication, partial writes, hash mismatch, corruption, backup tampering, and restore rollback.
- [x] Implement transactional outbox, idempotency records, content-addressed artifacts, and backup/restore.
- [x] Run focused and complete gates, update documentation/ADRs/evidence, and commit `feat: add durable persistence and artifact layer`.

### Task 3: Layer 8 supervised adapter infrastructure

**Files:**
- Create: `packages/infrastructure/src/processes/*`, `rpc/*`, `adapters/*`, `scheduling/*`, `resources/*`, `secrets/*`, `logging/*`
- Create corresponding infrastructure tests and hostile fixture processes
- Update architecture, maps, ADRs, and evidence

**Interfaces:**
- Consumes: adapter RPC contracts and Layer 4 operational ports.
- Produces: `ProcessSupervisor`, `JsonRpcClient`, `AdapterRegistry`, `AdapterSupervisor`, scheduler, resource monitor, secret store, and logger implementations.

- [x] Write failing tests for spawn failure, timeout, cancellation, malformed/oversized RPC, protocol mismatch, stdout corruption, stderr flood, crash, restart storm, and process-tree cleanup.
- [x] Implement bounded process supervision and strict JSON-RPC framing.
- [x] Implement registration, health, restart policy, scheduling, resource readings, bounded secret leases, and redacted structured logs.
- [x] Verify adapters cannot import SQLite or retain secrets; run focused and complete gates.
- [x] Update documentation/ADRs/evidence and commit `feat: add supervised adapter infrastructure layer`.

### Task 4: Layer 9 governed production gateways

**Files:**
- Create: `packages/infrastructure/src/gateways/*`, `plugins/*`, `policy/*`, `paths/*`
- Create matching tests including real filesystem fixtures
- Update architecture, maps, ADRs, and evidence

**Interfaces:**
- Consumes: Layer 4 gateway/policy/workspace ports and Layer 8 supervisors.
- Produces: model, tool, kernel gateway implementations; plugin registry; policy engine; and `PathPolicy`.

- [ ] Write failing tests for provider fallback, unavailable optional integrations, policy denial, approval replay/scope escalation, plugin collisions, external failure classification, and kernel isolation.
- [ ] Implement provider-neutral gateways and promotion/rollback behavior.
- [ ] Write failing filesystem tests for traversal, absolute/drive/UNC/device paths, mixed separators, Unicode/case ambiguity, symlinks, junctions/reparse points, and approved-root escapes.
- [ ] Implement canonical real-path containment and fail-closed platform handling.
- [ ] Run focused and complete gates, update documentation/ADRs/evidence, and commit `feat: add governed production gateway layer`.

### Task 5: Layer 10 authoritative runtime and external guarantees

**Files:**
- Create: `apps/runtime/src/{main,bootstrap,composition-root,runtime-config,shutdown}.ts`
- Create: `apps/runtime/src/api/{server,auth,error-mapper,event-stream}.ts`
- Create typed route modules and runtime integration tests
- Extend contracts with command-envelope and replay schemas
- Extend persistence with replay and command-record queries
- Update architecture, maps, ADRs, acceptance criteria, and evidence

**Interfaces:**
- Consumes: contracts, Layer 6 use cases, Layers 7–9 implementations.
- Produces: authenticated local HTTP runtime, typed commands/queries, and resumable WebSocket subscriptions.

- [x] Write failing contract tests for `idempotencyKey`, `expectedRevision`, replay cursor, replay batches, `refresh_required`, and slow-client disconnect metadata.
- [x] Implement strict versioned schemas without a second idempotency mechanism. (The runtime reuses the single SQLite idempotency authority; no second mechanism was introduced.)
- [x] Write failing real-runtime tests proving same-key/same-payload replay, payload conflict, stale revision, concurrent-writer determinism, and timeout/retry deduplication.
- [x] Implement durable command records and transactional external-command dispatch.
- [x] Write failing event tests for ordered replay after N, replay/live race, internal gap detection, expired retention cursor, authoritative-refresh fallback, bounded slow-client queues, and committed-events-only delivery.
- [x] Implement durable replay queries, subscription handoff, retention semantics, and explicit refresh/disconnect frames.
- [x] Implement composition, configuration, local authentication, typed routes, error mapping, startup recovery, and checkpoint-safe shutdown.
- [x] Run focused runtime and complete native gates; update documentation/ADRs/evidence and commit `feat: add authoritative runtime layer`.

### Task 6: Integrated Layers 1–10 hardening

**Files:**
- Add permanent regressions beside owning tests
- Update: integrated hardening ledger, architecture rules, ADRs, maps, and operational evidence

**Interfaces:**
- Consumes: complete Layers 1–10 system.
- Produces: verified defect ledger and permanent regression protections.

- [ ] Run invariant/state-machine attacks over lifecycle transitions, ordering, evidence, revisions, pagination, and recovery.
- [ ] Run hostile-input attacks over JSON, schemas, paths, process/RPC input, secrets, approvals, and command payloads.
- [ ] Run deterministic crash/concurrency/recovery attacks over transactions, outbox, commands, replay, artifacts, adapters, gateways, shutdown, and restart.
- [ ] Perform a clean-room architecture and operations review from source-of-truth documents.
- [ ] For every confirmed defect, demonstrate red-green regression evidence, fix the root cause, rerun affected and earlier passes, then rerun all native gates.
- [ ] Remove temporary scaffolding after permanent tests/rules exist; commit `test: harden integrated layers one through ten`.

### Task 7: Clean-checkout verification

**Files:**
- Update only final evidence records if results differ from recorded results.

**Interfaces:**
- Consumes: final canonical commit.
- Produces: reproducible readiness evidence.

- [ ] Create a clean detached verification worktree at the final SHA and install with `pnpm install --frozen-lockfile`.
- [ ] Run typecheck, focused tests, full tests, build, lint, check, dependency checks, source-size scan, explicit-any scan, and documentation consistency checks.
- [ ] Record exact branch, SHA, test files, test count, failures, skips, largest source, and unresolved risks.
- [ ] Use only the readiness verdict allowed by current evidence; do not push, merge, or mark ready automatically.
