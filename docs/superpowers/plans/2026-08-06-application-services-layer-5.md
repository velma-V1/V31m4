# Application Services Layer 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete, deterministic, infrastructure-free application services layer on top of the Layer 4 ports, and repair the proven Layer 1–4 defects surfaced by running the real pinned toolchain.

**Architecture:** `@v31m4/application` service source depends only on `@v31m4/domain` and application-local files. Services are pure decision/plan functions: they read no clock, use no hidden randomness, perform no side effects, persist nothing, and return immutable results. Time and seeds enter through inputs; rejections are typed application errors or explicit decision results.

**Tech Stack:** TypeScript 7 strict mode, Vitest 4, pnpm 11 workspaces, Turborepo, Biome 2, Zod 4 (contracts only), Ajv 8 (contract JSON-schema tests only).

## Global Constraints

- Services import only `@v31m4/domain` and application-local files (no contracts, infrastructure, adapters, plugins, UI, or provider SDKs).
- No filesystem, process, network, database, or secret access in service source.
- Deterministic for identical inputs; no hidden clock or randomness; seeds explicit.
- Every result is frozen; every rejection is a typed error or an explicit decision result.
- No source file exceeds 500 lines; no explicit `any`; no placeholders.
- Models never certify their own work; model confidence and model size are never treated as evidence or quality.

---

### Task 0: Baseline and Layer 1–4 validation

- [x] Install the pinned toolchain and record the baseline `lint/typecheck/test/build/check` results.
- [x] Validate Layers 1–4 against the real dependencies and record every proven defect in `docs/reviews/layers-1-5-improvement-ledger.md`.

### Task 1: Proven Layer 1–4 corrections (red→green)

- [x] IMP-01 Fix `ContractRefinementContext` path type for Zod 4.4.3 (contracts typecheck).
- [x] IMP-02 Fix Ajv2020/ajv-formats imports and add `allowUnionTypes` (contracts typecheck + JSON-schema tests).
- [x] IMP-03 Reject `__proto__`/prototype-pollution keys at the adapter RPC boundary (`guardForbiddenKeys`).
- [x] IMP-04 Add the missing `@types/node` dependency to `@v31m4/application` (application typecheck/build).

### Task 2: Deterministic service internals

- [x] Implement `services/internal/deterministic.ts` (stable fingerprint, canonical stringify, seeded RNG, stable sort). Not part of the public API.

### Task 3: Planning and compute services

- [x] `compute-governor.ts` — select direct/checked/competitive/adversarial mode + clamped budget; refuse/defer on insufficient resources, deadline, or missing verification.
- [x] `context-compiler.ts` — smallest sufficient deterministic context; preserve mandatory material; report omissions; fail when mandatory context cannot fit; produce a fingerprint.
- [x] `diversity-planner.ts` — materially distinct seeded solver configurations; reject wording/temperature/model-size-only diversity; respect tools, models, constraints, and budgets.

### Task 4: Evidence and selection services

- [x] `evidence-linker.ts` — link requirements/criteria/claims/candidates/artifacts/evidence; coverage, orphan/wrong-subject/conflict detection; never promote inconclusive to passing.
- [x] `champion-selector.ts` — verified champion, Pareto set, or no verified solution; exclude mandatory failures, missing checks, and unresolved critical risks; deterministic tie-breaking.
- [x] `improvement-policy.ts` — continue only for concrete, verifiable, material improvements; respect rounds and budget; report remaining risk.

### Task 5: Learning and progression services

- [x] `capability-calculator.ts` — bounded evidence-backed updates with difficulty and recency weighting; reject duplicates/leakage; isolate practice from production.
- [x] `practice-selector.ts` — safe isolated tasks for weak capabilities; honour idle policy, cooldowns, rotation, budgets, and production isolation.
- [x] `avatar-unlock-engine.ts` — permanent evidence-backed unlocks; reject model claims, unverified practice, invalid/duplicate evidence; preserve prior unlocks and deterministic order.

### Task 6: Public API, tests, and verification

- [x] Export all nine services and their public input/result types from `packages/application/src/index.ts`; keep internals private.
- [x] Add focused unit tests (happy-path, boundary, invalid-input, failure-path, determinism, immutability) plus a service-composition test.
- [x] Run full Layer 1–5 regression, declaration emission, dependency-boundary, source-size, and public-API checks.
- [x] Update architecture, dependency, ownership, README, repository-state, and improvement-ledger documents.
