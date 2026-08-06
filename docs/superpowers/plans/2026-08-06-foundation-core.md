# Foundation/Core Layer 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Establish repository governance, deterministic workspace tooling, and the dependency-free domain primitives required by every later V31M4 layer.

**Architecture:** The layer is a pure TypeScript domain package inside a pnpm/Turborepo monorepo. Domain values validate and canonicalize input at construction boundaries, remain immutable, and import no infrastructure or provider code.

**Tech Stack:** Node.js 22+, pnpm 11.17.0, TypeScript 7.0.2, Vitest 4.1.10, Biome 2.5.6, Turborepo 2.10.7.

## Global Constraints

- No business behavior outside `packages/domain`.
- No dependency from `packages/domain` to another workspace package.
- No placeholder code or deferred behavior.
- Tests are written before each production value object.
- Every accepted value has one canonical representation.
- Every invalid value raises a typed `DomainError`.

---

### Task 1: Repository governance and workspace

**Files:** root governance, workspace configuration, architecture documents, and repository maps.

- [x] Define mandatory contributor and AI rules.
- [x] Define exact workspace, compiler, formatter, build, and test configuration.
- [x] Define current-state and ownership maps.
- [x] Verify all JSON and YAML configuration is syntactically valid.

### Task 2: Typed domain errors

**Files:** `packages/domain/src/domain-errors.ts` and its tests.

- [x] Test typed error codes, immutable details, and assertion behavior.
- [x] Implement `DomainError`, `isDomainError`, and `assertDomain`.

### Task 3: Durable identifiers

**Files:** `packages/domain/src/value-objects/ids.ts` and its tests.

- [x] Test accepted canonical identifiers.
- [x] Test empty, padded, malformed, and oversized identifiers.
- [x] Implement branded ID parsers for all durable entity identifiers.

### Task 4: Content hashes

**Files:** `packages/domain/src/value-objects/content-hash.ts` and its tests.

- [x] Test canonical lowercase SHA-256 values.
- [x] Test invalid length, uppercase, and non-hexadecimal input.
- [x] Implement immutable content-hash parsing and comparison.

### Task 5: Safe project-relative paths

**Files:** `packages/domain/src/value-objects/safe-path.ts` and its tests.

- [x] Test valid nested paths.
- [x] Test absolute, traversal, duplicate-separator, Windows-device, and forbidden-character paths.
- [x] Implement canonical cross-platform project-relative path validation.

### Task 6: Scores and resource budgets

**Files:** score and budget value objects with tests.

- [x] Test score bounds and percentage conversion.
- [x] Test mandatory and optional budget bounds.
- [x] Implement immutable normalized scores and resource budgets.

### Task 7: Immutable domain events and public API

**Files:** domain events, public exports, and tests.

- [x] Test valid event metadata and frozen payloads.
- [x] Implement immutable event creation.
- [x] Export the complete Foundation/Core Layer 1 public API.
- [x] Run type checks and behavior tests.
