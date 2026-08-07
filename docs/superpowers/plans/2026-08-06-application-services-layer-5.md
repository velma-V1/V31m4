# Application Services Layer 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement nine deterministic application decision services without adding persistence, runtime, adapter, plugin, or UI behavior.

**Architecture:** Services remain inside `@v31m4/application`, import only the public domain API and application-local modules, and return immutable decisions. External effects remain behind Layer 4 ports and are not invoked by Layer 5 decision logic.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm workspaces, Turborepo, and Biome.

## Global Constraints

- No service imports contracts, infrastructure, adapters, plugins, UI, Node APIs, provider SDKs, or databases.
- Every result is deterministic and immutable.
- Model confidence and model size never substitute for verification.
- Candidate, artifact, evidence, checkpoint, capability, and avatar history remain immutable.
- No placeholder or deferred behavior is permitted.

---

### Task 1: Compute and context decisions

- [x] Implement direct, checked, competitive, and adversarial compute selection.
- [x] Clamp budgets to approved resources and deadlines.
- [x] Reject high-risk work without independent verification.
- [x] Implement deterministic smallest-sufficient context compilation.
- [x] Preserve mandatory context and report optional omissions.

### Task 2: Candidate diversity and evidence traceability

- [x] Generate materially distinct seeded solver configurations.
- [x] Reject impossible or wording-only diversity.
- [x] Link acceptance criteria to evidence and calculate mandatory coverage.
- [x] Preserve failed, inconclusive, conflicting, and orphan evidence.

### Task 3: Champion and improvement decisions

- [x] Select a verified champion, Pareto set, or no verified solution.
- [x] Exclude mandatory failures and unresolved critical issues.
- [x] Continue repair only for material, novel, independently verifiable changes.
- [x] Stop cosmetic, exhausted, repeated, or unverifiable refinement.

### Task 4: Capability, practice, and avatar decisions

- [x] Calculate bounded evidence-backed capability updates.
- [x] Enforce sample size, difficulty, recency, leakage, and practice weighting.
- [x] Select safe idle practice with cooldown and rotation.
- [x] Evaluate permanent avatar unlocks from capability-bound independent evidence.

### Task 5: Public API, documentation, and verification

- [x] Export all nine services and public service types.
- [x] Add focused behavior and failure-path tests.
- [x] Run Layer 1-5 type, declaration, dependency, placeholder, size, and regression checks.
- [x] Update architecture, dependency rules, repository ownership, README, current-state map, and improvement ledger.
