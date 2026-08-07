# Application Use Cases Layer 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement complete transactional orchestration for V31M4 projects, missions, jobs, solving, verification, repair, delivery, controlled learning, practice, avatar progression, plugins, models, and tools.

**Architecture:** Use cases depend only on the domain, Layer 5 services, and Layer 4 ports. Authoritative state changes occur in explicit units of work, external execution occurs only after durable state is committed, failures become durable typed outcomes, and all collection queries consume complete pagination rather than silently truncating evidence or capability state.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm workspaces, immutable domain entities, application ports.

## Global Constraints

- No application source imports contracts, infrastructure, adapters, plugins, UI, or provider SDKs.
- Every authoritative mutation participates in a unit of work.
- Every mutable write uses optimistic concurrency.
- External execution follows a durable prepare, invoke, finalize or fail sequence.
- Practice workspaces retain opaque identity for reliable disposal.
- No placeholders, unsafe casts, hidden time, hidden randomness, or direct I/O.

---

### Task 1: Cross-layer practice identity

- [x] Add opaque workspace identity to the practice domain entity.
- [x] Align the external contract with the domain lifecycle.
- [x] Add domain and contract parity tests.
- [x] Add the practice repository port.

### Task 2: Project, mission, and planning orchestration

- [x] Implement policy-gated project creation and audit.
- [x] Implement immutable mission submission to active projects.
- [x] Compose compute, context, and diversity services into execution planning.

### Task 3: Durable job lifecycle

- [x] Implement start, checkpoint, resume, finish-stop, and emergency-stop.
- [x] Persist prepare state before kernel calls.
- [x] Persist running or failed state after kernel outcomes.
- [x] Return state consistent with the final persisted aggregate.

### Task 4: Solver, verification, issue, and repair orchestration

- [x] Implement isolated solver candidate creation.
- [x] Implement independent verifier execution and evidence persistence.
- [x] Implement evidence-backed issue recording.
- [x] Implement isolated targeted repair with focused and regression verification.

### Task 5: Decision, delivery, and learning

- [x] Persist champion or no-solution decisions.
- [x] Persist verified delivery receipts.
- [x] Compile quarantined training packets.
- [x] Promote verified packets and update capability history atomically.

### Task 6: Practice, avatar, plugin, model, and tool orchestration

- [x] Start and stop safe idle practice with reliable workspace disposal.
- [x] Evaluate avatar unlocks using all paginated capability and evidence records.
- [x] Register plugins through policy, approval, and audit boundaries.
- [x] Invoke models and tools through governed gateways with success and failure audit.

### Task 7: Public API and verification

- [x] Export all 21 use cases and the practice repository port.
- [x] Add async behavior tests and failure-path coverage.
- [x] Run domain, contract, application, declaration, dependency, placeholder, and file-size checks.
- [x] Update architecture and repository maps.
