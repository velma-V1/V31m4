# Task 6 — Gate consequential actions on Evidence + Ledger state

Branch `autonomy-task6-evidence-effects`, from the accepted Task 5 SHA
`895789a2bf89dcf6fb31a9f45a44f1d1f6961370`.

## What this phase is for

Before this phase, a model turn that named a consequential operation reached the sandbox as long as
the operation existed, the role held it, policy allowed it, and (for `code.patch`) its target had
not moved. Nothing asked whether the facts that would *justify* the effect existed. An agent could
patch a symbol it had never located, in a file whose dependents it had never examined, with no idea
which tests spoke to the change.

The gate closes that. A consequential effect is authorized only when the facts justifying it exist
**and are still current** — and the path an agent walks to produce those facts is never itself
gated, because a gate that could deadlock the agent would be worse than no gate at all.

## Sources of truth

Both are ones V31M4 already treats as authoritative, and neither is new:

- immutable `EvidenceRecord` facts, with their existing kind / subject / status semantics;
- `observation` and `check_result` Ledger entries, whose currency is decided by the canonical
  `isEntryStillValid` rule from Task 3 — not by a second staleness notion.

There is deliberately no parallel free-form evidence taxonomy. A requirement can only name what
those two systems already express, and the gate writes nothing of its own: a regression asserts the
Ledger is byte-for-byte unchanged across a denial.

## The predicate

`packages/application/src/services/evidence-precondition.ts` is the pure engine. A requirement is
one of the two shapes the plan specifies, and a verdict is either satisfied — naming the entries and
records that satisfied it — or unsatisfied, naming **every** unmet requirement rather than the first.

`apps/runtime/src/autonomy/evidence-precondition-catalog.ts` resolves which requirements apply, from
three inputs, exactly as the architecture asks:

| Input | Source | Effect |
| --- | --- | --- |
| operation | the closed `SEMANTIC_OPERATION_CATALOG`, via each definition's existing `evidencePreconditionPolicyId` | the base requirement set |
| risk | the same catalog | recorded in the resolved policy id, so a denial is attributable |
| task class | the authoritative Task Capsule's own `phase` | adds a current `failure_report` before any effect that *changes* something during `repair` |

Base policies:

| Policy id | Operations | Requires |
| --- | --- | --- |
| `evidence.none.v1` | every read, plus `build.check`, `test.targeted`, `test.regression`, `debug.reproduce` | nothing |
| `evidence.patch_requires_current_target.v1` | `code.patch` | current `symbol_definition`, `impact_analysis`, `test_selection` |
| `evidence.browse_requires_current_target.v1` | `browser.inspect`, `browser.verify` | current `verification_target` |
| `evidence.command_run_escape_hatch.v1` | `command.run` | current `failure_report`, **plus the union of every other operation's requirements** |

The last row is Step 2. The escape hatch is not gated by a hand-written list that could fall behind:
it inherits the union, so any operation gated later strengthens `command.run` automatically rather
than leaving a cheaper route beside it. A regression asserts `command.run` carries at least every
requirement any other operation carries, and strictly more than the strongest of them.

## Where it runs

In `authorize()` — the single mandatory boundary between a requested operation and any sandbox
execution — after policy has spoken and before any capability is minted. Every path reaches it,
because every path reaches that boundary; there is no second route to an effect.

`preconditions` is a **required** option on both `createSemanticAuthorizationBoundary` and
`GovernedExecutionSurface.create`. An optional gate is a bypass: a caller that omitted it would
authorize consequential effects against no evidence and nothing downstream could tell.

## Currency, and what "observed" means

A recorded fact is current only against something observed now. The request carries
`currentFingerprints`, and the agent-turn loop obtains them from a required `observeResources`
dependency — the sibling of `probe`, which proves what an effect *did*. Both are the caller's
observation of reality, never a model's claim.

This also closes a deferral Task 4 left explicit in a comment: the loop now derives
`observedTargetFingerprint` for `code.patch` from that same observation, keyed by the turn's own
`targetPath`. A model that could state its target's current fingerprint could state any fingerprint,
and the staleness check would then be comparing the model's memory against itself.

Absence fails closed in every direction: a locator not present in `currentFingerprints` is not
current, an operation whose task has no capsule is refused outright, and the Auditor's optional
`observeResources` defaults to observing nothing — which denies rather than allows.

## Denials are actionable and non-retryable

A denial is `POLICY_REJECTED`, `retryable: false`, and carries the operation, the resolved policy id,
and one line per missing requirement — `ledger observation impact_analysis: every recorded
impact_analysis is stale or invalidated; observe it again`. Retrying the identical request against
identical state produces the identical answer, and saying so is what stops a retry loop being
mistaken for progress.

## The hard gate: blocked without deadlock

The plan's hard gate is that missing or stale evidence blocks effects **without** blocking the
investigation path needed to satisfy it. Three things hold it:

1. Every read operation resolves to an empty requirement set, in every task class, and the gate
   short-circuits before touching the database for them.
2. `build.check`, `test.targeted`, `test.regression`, and `debug.reproduce` — the operations that
   *produce* a failure report — are ungated in every task class. This is why the `repair` rule is
   scoped to `workspace_write` and `network_effect` rather than to every non-read: requiring a
   failure report before the operations that generate one would be precisely the deadlock.
3. An end-to-end regression walks the whole path: a patch is refused, only ungated reads are used,
   the findings are recorded, and the same patch is then authorized.

## Regressions

`packages/application/tests/autonomy/evidence-precondition.test.ts` (17) — the pure predicate:
currency, invalidation, failed checks, cross-task facts, evidence status/kind/subject, partial
satisfaction, determinism, and the typed non-retryable denial.

`apps/runtime/tests/autonomy/evidence-precondition-catalog.test.ts` (14) — resolution: reads never
gated, evidence-producing operations never gated, every high/critical operation gated, the escape
hatch union, the task-class rule, determinism and immutability.

`apps/runtime/tests/autonomy/evidence-conditioned-effects.test.ts` (17) — end to end over real
SQLite and the real governed surface: refusal and its contents, stale and invalidated prerequisites,
the open investigation path, the escape hatch that cannot undercut, browser paths, the repair task
class reached through a governed transition, a task with no capsule, and the gate writing nothing.

`apps/runtime/tests/autonomy/agent-turn-loop.test.ts` (+3) — the model path: a syntactically perfect
patch turn is refused as `AUTHORIZATION_REFUSED`, the run continues rather than dying, nothing
reaches the backend; the same turn executes once the prerequisites and the target are observed; and
it is refused again once the observed target has moved on.

`apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts` (+1) — the inventory entry's own
check that consequential effects are conditioned on evidence and reads are not.

## Deliberately not changed

`packages/application/src/use-cases/invoke-tool.ts` was reviewed and left alone. It is the
pre-autonomy Layer-6 `ToolGatewayPort` path used by the job execution pipeline; no model turn can
reach it, because the model-facing route is the semantic authorization boundary and the
`no model-direct effect bypass` invariant already holds that line. Gating it would change verified
behaviour unrelated to this phase.

MCP has no path yet — Task 8 owns it. When it arrives it must be expressed as catalog operations, at
which point it is gated by construction and strengthens `command.run` on the way in.

Task 7's Project Intelligence, Task 9's memory, and Task 10's Quality Floor remain out of scope.

## Gates

```text
pnpm typecheck   PASS   (9/9)
pnpm test        PASS   (1175 tests: 1147 passed, 24 skipped, 4 todo; 147 files)
pnpm lint        PASS   (9 pre-existing warnings, unchanged; 0 errors)
pnpm build       PASS   (9/9)
git diff --check PASS
source-size gate PASS   (largest first-party production file 499 lines; largest touched by this
                         phase is semantic-execution-authorization.ts at 469)
```

No target-host proof is required by this phase: it adds no external dependency and no new execution
binding, and its model path is the Task 4 agent-turn loop already proven on the host.
