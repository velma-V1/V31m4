# Domain Entity Layer 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the complete dependency-free V31M4 domain entity model and preserve all Foundation/Core Layer 1 behavior.

**Architecture:** Every entity is created through a validating factory and represented as immutable TypeScript data. Lifecycle behavior is implemented through explicit pure transitions that return new frozen state. Job transitions additionally produce immutable domain events. No entity imports infrastructure, application, adapter, plugin, UI, filesystem, process, network, or database code.

**Tech Stack:** TypeScript strict mode, Vitest behavior tests, pnpm workspace, Turborepo, and Biome.

## Global Constraints

- Domain source imports only domain source.
- Every external input is validated at the factory boundary.
- Every collection is copied before it is frozen.
- Every state transition rejects illegal source states.
- Evidence-backed states require evidence identifiers.
- Original candidate artifacts and lineage are immutable.
- No placeholder, deferred implementation, or empty method is permitted.
- All Layer 1 regression tests must remain passing.

---

### Task 1: Extend durable identifiers and typed errors

- [x] Add durable identifiers for every Layer 2 entity and supporting record.
- [x] Add typed domain error codes for every entity family.
- [x] Preserve all Layer 1 parser and error behavior.

### Task 2: Project and mission definition

- [x] Implement projects and project lifecycle.
- [x] Implement traceable requirements.
- [x] Implement immutable mission contracts with mandatory evidence coverage.
- [x] Add project and mission behavior tests.

### Task 3: Durable execution

- [x] Implement the job state machine and immutable transition events.
- [x] Implement checkpoint validation and verified-checkpoint evidence rules.
- [x] Add normal, paused/resumed, checkpoint, emergency-stop, terminal, and invalid-transition tests.

### Task 4: Artifact and evidence traceability

- [x] Implement content-addressed artifact metadata and parent lineage.
- [x] Implement immutable artifact-backed evidence records.
- [x] Implement evidence-evaluated claims.
- [x] Implement Production Twin nodes and evidence-backed edges.

### Task 5: Capability and availability profiles

- [x] Implement measured capability scores and chronological profile history.
- [x] Implement model profiles.
- [x] Implement tool profiles.
- [x] Implement plugin profiles and lifecycle rules.

### Task 6: Competitive solving and repair

- [x] Implement independent and reconstructed solver candidates.
- [x] Implement verification plans and deterministic result calculation.
- [x] Implement evidence-backed issues and issue lifecycle.
- [x] Implement focused and regression-evidenced repair records.

### Task 7: Decision and delivery

- [x] Implement champion and no-verified-solution decisions.
- [x] Implement delivery receipts with complete-coverage gates.
- [x] Test both successful delivery and rejected incomplete delivery.

### Task 8: Controlled improvement and avatar state

- [x] Implement quarantined training packets and promotion order.
- [x] Implement evidence-measured capability history.
- [x] Implement isolated practice lifecycle and quarantine.
- [x] Implement promotion records requiring held-out and regression evidence.
- [x] Implement evidence-linked permanent avatar unlocks and equipment rules.

### Task 9: Public API, maps, and verification

- [x] Export every Layer 2 entity and durable identifier through `src/index.ts`.
- [x] Update architecture, dependency, ownership, README, and current-state maps.
- [x] Run strict TypeScript checks.
- [x] Run the full Layer 1 regression and Layer 2 behavior suite.
- [x] Run placeholder, source-size, and forbidden-import scans.
