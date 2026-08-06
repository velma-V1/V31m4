# Application Ports Layer 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the complete infrastructure-free application boundary required by every later V31M4 use case and adapter implementation.

**Architecture:** `@v31m4/application` depends only on the domain package. Ports accept a shared immutable operation context carrying cancellation, deadline, idempotency, correlation, and actor identity. Repository writes use explicit optimistic-concurrency conditions, immutable stores are append-only, and all external systems remain provider-neutral.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm workspaces, Turborepo, and Biome.

## Global Constraints

- No persistence, network, process, provider, adapter, plugin, runtime-server, or UI implementation.
- Every long-running or external operation accepts `OperationContext`.
- Every mutable repository write accepts `WriteCondition`.
- Every transactional write can receive `UnitOfWorkTransaction`.
- Evidence, missions, candidates, repairs, promotions, audit records, and checkpoints remain append-only where their domain model is immutable.
- Ports import only `@v31m4/domain` and application-local files.
- No placeholder methods, optional untyped bags, or provider SDK types.

---

### Task 1: Shared application primitives

- [x] Implement typed application errors with immutable safe details.
- [x] Implement operation context with actor, cancellation, deadline, idempotency, and correlation.
- [x] Implement pagination, revision, health, receipt, and subscription types.
- [x] Test invalid contexts, cancellation, deadlines, and error normalization.

### Task 2: Persistence boundaries

- [x] Implement unit-of-work, project, mission, job, evidence, candidate, capability, workflow, and training ports.
- [x] Implement explicit optimistic concurrency through `WriteCondition` and `Versioned<T>`.
- [x] Preserve append-only semantics for immutable records.

### Task 3: External execution boundaries

- [x] Implement artifact, event, model, tool, plugin, kernel, and verifier ports.
- [x] Require provider-neutral inputs and typed cancellation methods.
- [x] Require integrity verification for artifacts and health reporting for external dependencies.

### Task 4: Governance and operations boundaries

- [x] Implement policy, approval, audit, scheduler, resources, secrets, clock, workspace, configuration, and backup ports.
- [x] Use secret leases instead of unrestricted long-lived secret strings.
- [x] Make isolated working copies and append-only audit records explicit architecture boundaries.

### Task 5: Public API and verification

- [x] Export the complete 26-port surface.
- [x] Add dependency and file-size architecture tests.
- [x] Update architecture, dependency, ownership, README, and repository-state documents.
- [x] Run Layer 1 through Layer 4 regression, declaration, dependency, placeholder, and source-size checks.
