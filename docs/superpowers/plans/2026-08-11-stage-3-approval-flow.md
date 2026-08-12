# Stage 3 Approval-Flow Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing policy/approval/audit architecture externally reachable through one real protected operation and prove its complete durable lifecycle.

**Architecture:** Keep `project.create` as the unchanged allow path and expose the existing `registerPlugin` use case as `plugin.register`, governed by a `require_approval` rule. Add two focused Layer 6 use cases for pending-request creation and authenticated decisions; the existing `authorizeAction` path remains the sole approval validator/consumer and consumes atomically with plugin registration. Runtime handlers only translate strict contracts and compose existing ports; approval and audit state remain authoritative in SQLite.

**Tech Stack:** TypeScript, Zod, `node:http`, Vitest, SQLite.

## Global Constraints

- Preserve Layer 1–10 dependency direction and use only public package APIs.
- Do not route unrelated Layer 6 commands through `authorizeAction`.
- Do not change any existing strict `1.0.0` request shape; add separately named schemas for new commands/queries.
- Approval action, resource type/id, requester identity, scopes, context, status, and inclusive expiry must all match before consumption.
- Approval consumption, the protected plugin write, and their audit records must share one authoritative transaction.
- External command idempotency must return the completed protected result without consuming twice.
- Add no UI, gateway, verifier, kernel, process adapter, CLI, desktop, laboratory, Stage 4, or unrelated behavior.
- Continue after the local Stage 3 checkpoint with the repository integrity audit and three independent drift passes; publish only after one fresh final gate.
- Prefer a reviewable Stage 3 feature commit followed by an integrity/drift repair-and-evidence commit; never push the intermediate checkpoint.

---

### Task 1: Strict approval contracts and real-runtime RED proof

**Files:**
- Create: `packages/contracts/src/approvals.schemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/public-api.test.ts`
- Create: `packages/contracts/tests/approvals.schemas.test.ts`
- Create: `apps/runtime/tests/approval-flow.test.ts`

**Interfaces:**
- Produces: strict `approvalRequestSchema`, `registerGovernedPluginRequestSchema`, `registerGovernedPluginResponseSchema`, `decideApprovalRequestSchema`, `decideApprovalResponseSchema`, `listApprovalsRequestSchema`, and `listApprovalsResponseSchema`.
- Proves: authenticated `plugin.register`, `approval.decide`, and `approval.list` over real HTTP and SQLite.

- [x] **Step 1: Write strict contract tests first**

  Test a pending approval and the grant/deny/list/plugin envelopes. Reject unknown fields, inconsistent status/decision metadata, duplicate scopes/approvals, malformed identifiers, and unsupported versions.

- [x] **Step 2: Write the real HTTP + SQLite lifecycle test first**

  Drive unchanged `project.create`; create pending plugin approvals; grant and deny through authenticated commands; reject unauthorized/malformed/nonexistent decisions; reject missing, denied, expired, consumed, and wrong-resource approvals; prove status-filtered pagination, restart durability, idempotent replay, and transaction rollback after a colliding plugin write.

- [x] **Step 3: Run RED checks**

  Run `pnpm exec vitest run packages/contracts/tests/approvals.schemas.test.ts apps/runtime/tests/approval-flow.test.ts`; expect missing schema exports and unsupported runtime operations, not fixture errors.

### Task 2: Layer 6 lifecycle, invariant hardening, and runtime composition

**Files:**
- Create: `packages/application/src/use-cases/request-approval.ts`
- Create: `packages/application/src/use-cases/decide-approval.ts`
- Modify: `packages/application/src/use-cases/use-case-support.ts`
- Modify: `packages/application/src/index.ts`
- Create: `packages/application/tests/use-cases/approval-lifecycle.test.ts`
- Create: `apps/runtime/src/approval-surface.ts`
- Modify: `apps/runtime/src/composition-root.ts`
- Modify: `apps/runtime/src/use-case-infrastructure.ts`

**Interfaces:**
- Produces: `requestApproval(dependencies, command, context)` and `decideApproval(dependencies, command, context)`.
- Strengthens: `authorizeAction` validates action/resource/requester/context/scopes/status/expiry, then consumes and audits in the caller transaction.
- Produces: runtime registration for `plugin.register`, `approval.decide`, and `approval.list` using `SqlitePluginRegistry`, `SqliteApprovalStore`, `SqliteAuditStore`, and `RuleBasedPolicyEngine`.

- [x] **Step 1: Implement the minimum contract schemas and exports**

  Keep every object strict and keep the existing plugin/request schemas unchanged.

- [x] **Step 2: Implement pending request and decision use cases**

  Pending creation evaluates the real policy and stores the exact policy request plus required scopes and audit in one unit of work. Decision evaluates `approval.decide`, permits only an explicit allow, updates only a pending non-expired request under revision matching, and appends grant/deny audit.

- [x] **Step 3: Harden the existing consume path**

  Before `consume`, compare every represented approval invariant against the current policy request. Append `approval.consume` audit in the same transaction so any later protected write failure rolls both back.

- [x] **Step 4: Register the protected operation and lifecycle surface**

  Add an operator `plugin.register` require-approval rule, preserve the existing project allow rule, add an operator approval-decision allow rule, and wire the existing plugin registry/use case. A request without `approvalId` returns the durable pending approval and performs no plugin write; a request with a valid grant invokes the existing `registerPlugin` use case.

- [x] **Step 5: Correct status pagination only if RED proves leakage**

  If an interleaved status test shows filtering after pagination, pass the status predicate into the existing `listPersistedRecords` helper so items, total, and cursor are all status-scoped.

- [x] **Step 6: Run GREEN and owning-layer regressions**

  Run the Stage 3 contract/application/runtime tests, then all contract tests, application use-case tests, runtime tests, infrastructure policy/plugin tests, package typechecks, and dependency-boundary tests.

### Task 3: Integrity audit, three-pass drift review, final verification, and publication

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/architecture.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`
- Modify: `packages/application/README.md`
- Modify: this plan
- Create: `docs/reviews/stage-3-system-integrity-drift-audit.md`

**Interfaces:**
- Records: exact command/query names, transaction and idempotency semantics, confirmed defects, fresh counts, and Stage 4 remaining work.

- [ ] **Step 1: Run the risk-driven integrity audit**

  Reproduce material candidates across state machines, transactions, persistence, idempotency,
  authorization, events, evidence, external boundaries, contracts, and dependency direction. Fix
  only confirmed bounded defects, using RED/GREEN regressions. Complete the audit-pagination
  adversary and sweep sibling filtered-pagination implementations.

- [ ] **Step 2: Run three independent drift passes and reconcile them**

  Trace original requirements forward, current subsystems backward, then independently challenge
  whether the current critical path still converges toward autonomous production capability.
  Resolve disagreements with source and executable evidence.

- [ ] **Step 3: Update current truth, ownership, and durable audit evidence**

  Record the two new Layer 6 use cases, runtime approval surface, real SQLite lifecycle, and any demonstrated fixes without changing future-stage claims.

- [ ] **Step 4: Run final gates once**

  Run focused Stage 3 tests, owning-layer regressions, `pnpm check`, and `git diff --check`; record only the observed fresh counts.

- [ ] **Step 5: Commit the integrity/drift result**

  Review the complete change from the Stage 2 baseline for authorization bypass, replay,
  action/resource/scope/requester/context mismatch, transaction hazards, duplicate abstractions,
  architecture violations, harmful drift, and Stage 4 scope creep. Commit the second coherent
  result as `fix: reconcile system integrity and architecture drift`.

- [ ] **Step 6: Push and verify synchronization**

  Non-force push `main` to `origin/main`; verify local HEAD, tracking `origin/main`, and live GitHub main are identical, 0 ahead/0 behind, and the worktree is clean. Stop before Stage 4.
