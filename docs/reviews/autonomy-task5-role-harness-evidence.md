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

## Independent review round 2 — `TASK5_INDEPENDENT_REVIEW=FAIL` on `728c908`, repaired

Three defects were returned. All three are reproduced by tests that fail against `728c908` and pass
against the repair.

### 1. Manager ownership and handoff

**Defect.** The canonical spec makes the Manager responsible for the whole bounded dispatch — the
task *and* the role, context, skill, operation, and model policy. `728c908` had the Manager select
the task and freeze the acceptance contract, and left everything else to the Executor's caller:
`TaskExecutorRequest` took `modelId`, `capsuleFingerprint`, `allowedOperations`, `skillVersions`,
`harnessVersion`, `reasoningPolicy`, and `budget` directly. A caller that can restate the policy is
a caller that can widen it, and nothing recorded what the Manager had actually decided.

**Repair.** `packages/application/src/services/role-handoff.ts` introduces one immutable,
fingerprinted `RoleHandoff`. `issueExecutorHandoff` compiles it from the authoritative capsule and
the frozen contract plus a `RoleExecutionPolicy`; the policy is canonicalised (sorted, de-duplicated,
bounded) so two equivalent dispatches fingerprint identically, and *any* substitution — an extra
operation, a different model, a larger context budget, a different skill set — changes the
fingerprint. `selectNextTask` issues it, and only on a route that calls for execution: an `audit` or
`blocked` route dispatches nothing rather than leaving a valid handoff lying around.

`runTaskExecutor` now takes `handoff` plus a mandatory `expectedHandoffFingerprint` and reads model,
operations, skills, reasoning policy, and turn budget from the handoff alone. The operation ids stay
opaque strings across the layer boundary — the runtime catalog remains their only authority, and
`assertRoleInvocationPermitted` is still the narrowing point.

`deriveAuditorHandoff` produces the Auditor's dispatch after execution from the frozen contract and
the authoritative result state. The Executor's handoff is used for exactly one thing: proving the
audit belongs to that execution. No context, transcript, or turn budget crosses over.

### 2. TOCTOU and frozen-contract binding

**Defect.** Selection read authoritative state at one moment; the Executor acted at another; nothing
re-read state in between. A capsule that advanced, or a workspace that was swapped or rewritten,
would still be executed against a contract describing a world that no longer existed. Worse,
`expectedContractFingerprint` was optional and defaulted to `request.snapshot.contractFingerprint` —
comparing a value with itself, which proves nothing.

**Repair.** The expected dispatch fingerprint is mandatory, and the acceptance contract is checked
against `handoff.acceptanceContractFingerprint` rather than against itself. Before any model
invocation the Executor re-reads the authoritative capsule through `TaskManager.loadCurrent` and
calls `assertHandoffStillCurrent`, which compares task id, capsule revision, capsule fingerprint,
workspace identity, and observed workspace state against the Manager-frozen entry. Any drift throws
a non-retryable `CONFLICT` whose message says the step must be reselected. The manifest is minted
from the capsule fingerprint just proved current, never from one a caller named.

A fingerprint proves authorship, not currency. `refuses a forged capsule fingerprint even when the
whole dispatch verifies` builds a wholly self-consistent handoff, contract, and capsule that simply
are not the authoritative ones — only re-reading durable state catches it.

### 3. Audit identity

**Defect.** `auditTaskResult` recompiled the contract passing `snapshot.workspaceFingerprint` — the
frozen value from the very snapshot being judged. Workspace drift was therefore structurally
invisible to the check meant to catch it, and `detectAcceptanceWeakening` compared no workspace
field at all.

**Repair.** The command carries an observed `workspace` (identity and fingerprint), the recompile
uses the observed fingerprint, and `detectAcceptanceWeakening` now reports a changed `workspaceId`
and a frozen workspace state that was unbound. A workspace whose *contents* changed is not drift —
that is what the Executor was for — but rebinding the promise to a different tree, or dropping the
binding, is. `runTaskAuditor` additionally fails closed via `assertHandoffResultStateCompatible`
when the capsule regressed or the workspace was rebound relative to its own dispatch, so the
identity is enforced both as an integrity refusal and as a rejection reason.

### Negative regressions added

| Scenario | Test |
| --- | --- |
| Stale capsule between Manager and Executor | `fails closed when the capsule advanced between Manager selection and Executor dispatch` |
| Swapped workspace (identity and state) | `fails closed when the workspace was swapped or rewritten under the dispatch` |
| Forged capsule fingerprint | `refuses a forged capsule fingerprint even when the whole dispatch verifies` |
| Swapped acceptance contract | `refuses an acceptance contract swapped for another after the Manager froze one` |
| Caller changing allowed operations after selection | `refuses a handoff whose allowed operations were widened after the Manager selected` |
| Caller changing skills, model, or budget after selection | `refuses a handoff whose skill set or model was changed after selection` |
| Caller policy ignored end to end | `runs the Manager's policy, not the caller's: model, skills, and budget come from the handoff` |
| Restart preserving the exact handoff | `re-derives the identical Manager selection and dispatch from a reopened database`, `runs an Executor against a handoff minted before the restart` |
| Audit workspace identity | `rejects a workspace identity that no longer matches the frozen contract`, `rejects a workspace identity that was rebound after the contract was frozen` |
| Audit workspace unbinding | `rejects an audit that unbinds the frozen workspace state entirely` |
| Strengthening still allowed | `allows a later contract to be stronger, never weaker` |

Scope was unchanged by the repair: Task 10's Exit Gate and Quality Floor and Tasks 7/9 context
layering remain out; `autonomy-task4-agent-turns` is untouched at `914a0e8`; the already-resolved
Task 5 deferred item (`browser.verify` as an auditor-permitted operation) is preserved.

## Restart safety

Both handoffs are derived rather than remembered. The regression closes the SQLite database, reopens
it from the same path, and re-runs each side:

- Manager → Executor: the same contract fingerprint, the same selected node, the same route, and
  the same handoff fingerprint — the whole dispatch, not merely the selection. A handoff minted
  before the restart still runs afterwards.
- Executor → Auditor: the same verdict and the same contract fingerprint, twice in a row.

## Gates

First implementation (`728c908`):

```text
pnpm typecheck   PASS
pnpm test        PASS   (1088 tests: 1060 passed, 24 skipped, 4 todo)
pnpm lint        PASS   (9 pre-existing warnings, unchanged; 0 errors)
pnpm build       PASS
git diff --check PASS
source-size gate PASS   (largest first-party production file 499 lines)
```

After the round-2 repair:

```text
pnpm typecheck   PASS   (9/9)
pnpm test        PASS   (1123 tests: 1095 passed, 24 skipped, 4 todo; 144 files)
pnpm lint        PASS   (9 pre-existing warnings, unchanged; 0 errors)
pnpm build       PASS   (9/9)
git diff --check PASS
source-size gate PASS   (largest first-party production file 499 lines; largest file added
                         by the repair is role-handoff.ts at 359)
```

No target-host proof is required by this phase: the role harness adds no new external dependency,
and its model path is the Task 4 agent-turn loop that was already proven on the host.
