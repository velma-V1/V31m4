# Task 5 evidence — Manager, fresh Executor, independent read-only Auditor

Program: `V31M4-AUTONOMY-001 / 1.1.0`.
Branch: `autonomy-task5-role-harness`, from the accepted Task 4 SHA
`914a0e890772d615d00c80deaa7deb525e968f55`.

Governing sources: the v2 architecture spec (§11) and the v2 plan (Task 5), plus the two Task
5-owned requirements of the accepted deferred-refinements issue.

## What was added

| Concern | Owner |
|---|---|
| Frozen Entry Acceptance Snapshot | `packages/application/src/services/entry-acceptance-snapshot.ts` |
| Deterministic-first Manager routing | `packages/application/src/services/manager-routing.ts` |
| Manager selection (no writes) | `packages/application/src/use-cases/select-next-task.ts` |
| Deterministic audit verdict | `packages/application/src/use-cases/audit-task-result.ts` |
| Role invocation manifest | `apps/runtime/src/autonomy/role-manifest.ts` |
| Fresh Executor | `apps/runtime/src/autonomy/task-executor.ts` |
| Independent read-only Auditor | `apps/runtime/src/autonomy/task-auditor.ts` |

`readyDagNodeIds` moved to the Manager use case and is re-exported from
`apps/runtime/src/autonomy/task-manager.ts`, so there is one definition rather than two.

## Role separation

**The Manager selects and cannot complete.** `selectNextTask` performs no repository write, no
evidence write, and proposes no transition; the regression drives it against repositories whose
write methods throw and asserts nothing was called. Selection is a pure function of durable state,
so the same state selects the same node every time.

**The Executor works in a fresh bounded context and cannot complete.** It proves the acceptance
contract fingerprint before the model is asked anything, mints its manifest, and offers the model
only the manifest's operations — never the caller's request. It returns at best
`ready_for_verification`, and the capsule's phase and logical revision are unchanged afterwards.

**The Auditor is independent, fresh, and read-only.** Its verdict comes from `auditTaskResult`,
which reads the frozen contract, the authoritative Evidence store, and the Execution Ledger. A
model may run alongside it; what that produces is returned as `advisory` and is never consulted when
the verdict is formed. A regression scripts a model `finish` against an unsatisfied contract and
asserts the verdict is still `rejected`.

**The Auditor cannot receive Executor reasoning.** `AuditorContextRequest` is a closed shape holding
the contract, capsule identity, changed paths, and the deterministic findings. There is no field
through which an Executor turn, summary, or transcript could arrive — freshness is structural, not a
convention the caller is asked to honour.

**Read-only is derived, not declared.** `mintRoleInvocationManifest` computes `readOnly` from the
role, so a caller cannot declare a writable Auditor or a read-only Executor, and a read-only role is
refused every operation whose effect class is not `read` or `network_read`.

## Issue-owned requirement 1 — deterministic-first Manager routing

`routeNextStep` decides, in order:

1. no dependency-ready node → `blocked`;
2. an unreconciled effect attempt → `blocked` (settling it is deterministic work no model may
   pre-empt);
3. a required check with no current result → `deterministic_check` — the branch that wins by
   default;
4. every required check current, one genuinely failed → `model_turn`, the case where adaptive
   reasoning materially helps;
5. every required check current and passing → `audit`;
6. a contract declaring no deterministic requirement → `model_turn`, stated explicitly rather than
   arrived at by omission.

Currency is decided by the canonical `isEntryStillValid` rule, so a stale or invalidated check reads
as *not run* rather than as an answer, and the deterministic branch is taken again.

Routing introduces no authority. A route names which governed path runs next; every path it can
select is still bounded by the same policy, role, and evidence gates, and the returned decision is
frozen and carries no `allowedOperations` or `policyDecision` field. Choosing wrongly could waste a
model turn; it could not widen what the system may do.

## Issue-owned requirement 2 — frozen Entry Acceptance Snapshot (Task 5 portion only)

The contract is compiled from authoritative Task Capsule state and fingerprinted before significant
Executor work. Objective, acceptance criteria, constraints, and forbidden changes are read from the
capsule and never accepted from a caller; the caller supplies only what the capsule cannot express —
required deterministic checks, required evidence kinds, risk policy IDs, and workspace identity.

Neither role may weaken it:

- both the Executor and the Auditor prove the contract fingerprint they were dispatched with before
  reading anything;
- the Auditor recompiles the contract from the capsule *as it stands after the work* and runs
  `detectAcceptanceWeakening`; a criterion, check, evidence kind, constraint, prohibition, or
  objective given up after the implementation was seen is a rejection, not an easier pass;
- a strictly stronger later contract is not weakening — raising the bar afterwards harms nobody.

This is additive over existing authority. Evidence is assessed through the existing
`assessTaskEvidence` / `TaskEvidenceScope` rules, so no parallel evidence taxonomy exists, and Task 2
was not reopened. **The matching Exit Gate and Quality Floor belong to Task 10 and were not
implemented.**

## Deferred item assigned to Task 5

The one previously accepted deferred item assigned to this phase was the conservative role
assignment recorded during Task 1: every non-`read` operation was Executor-only pending the role
work, and widening any of it required Task 5's roles and evidence.

Resolved. `browser.verify` is now permitted to the Auditor as an explicit operation-level
assignment. It is a `network_read`, and the role contract bars a read-only role from write, execute,
and network-**effect** operations; checking a stated expectation against a target is what an audit
is. `browser.inspect` is deliberately **not** widened — open-ended exploration of a network target
is not verification, and the narrower change is the one the evidence supports. The catalog
regression now asserts the exact permitted role set per operation and that every auditor-permitted
operation has an observing effect class, which is a stricter check than the effect-class derivation
it replaces.

Fail-closed behaviour is unchanged in practice: `browser.verify` still has no trusted execution
binding, and the sandbox still denies egress, so the widening removes an inconsistency in the role
model rather than opening a capability.

## Program inventory

The two `it.todo` placeholders that this phase and its predecessor owned are now real regressions in
`apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`:

- `agent turn cannot invoke disallowed operation` — Task 4's Step 6, which was missed at the time
  because the search for its placeholder looked for `TODO` comments rather than `it.todo` entries.
  A syntactically perfect turn still cannot name an operation outside the catalog or outside the
  role, and no manifest can be minted to hold one.
- `auditor cannot mutate candidate` — Task 5's Step 6. Every catalog operation is checked against
  the auditor manifest mint, and the set of auditor-permitted operations with a mutating effect
  class is asserted empty.

## Restart safety

Both handoffs are derived rather than remembered. The regression closes the SQLite database, reopens
it from the same path, and re-runs each side:

- Manager → Executor: the same contract fingerprint, the same selected node, the same route.
- Executor → Auditor: the same verdict and the same contract fingerprint, twice in a row.

## Gates

```text
pnpm typecheck   PASS
pnpm test        PASS   (1088 tests: 1060 passed, 24 skipped, 4 todo)
pnpm lint        PASS   (9 pre-existing warnings, unchanged; 0 errors)
pnpm build       PASS
git diff --check PASS
source-size gate PASS   (largest first-party production file 499 lines)
```

No target-host proof is required by this phase: the role harness adds no new external dependency,
and its model path is the Task 4 agent-turn loop that was already proven on the host.
