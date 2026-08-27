# V31M4 Current State

This file is the concise operational handoff for the current V31M4 line. Historical debugging detail remains in Git history and the review/evidence documents referenced below; this file records the state that a new implementation or verification session should act on now.

## Repository state

- Canonical branch: `main`.
- Tasks 1-3 promotion merge: `dfb98e47a973273d56f8f96007fc92fca9c6451c` (PR #12).
- Accepted pre-promotion integration SHA: `0c421dcfae73aca8259d36a01c3110c9792f074f`.
- Promotion governance SHA: `629c1575c4c3d161209308c8848e379a6f815c6e`.
- Post-merge main CI: run `33026864934`, exact merge SHA `dfb98e47a973273d56f8f96007fc92fca9c6451c`, PASS.
- `main` is protected. Changes must use a pull request and the canonical `verify` GitHub Actions check must pass under strict/up-to-date status-check behavior. Force push and branch deletion are disabled; protection applies to administrators; unresolved review conversations block merge.
- Ordinary CI now runs on pull requests and pushes to every branch, including `main`.
- Always verify the live `main` SHA at session start rather than treating any stored SHA as current after later documentation or implementation merges.

## Canonical autonomy sources

Program: `V31M4-AUTONOMY-001 / 1.1.0`.

- Architecture source of truth: `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`.
- Execution-plan source of truth: `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`.
- Repository/agent instructions: `AGENTS.md`.
- Same-date non-v2 autonomy spec/plan files are historical only.
- Task 0 baseline evidence: `docs/reviews/autonomy-baseline-v2.md`.
- Task 1 target-host evidence: `docs/reviews/autonomy-task1-phase1-evidence.md`.
- Task 4 evidence: `docs/reviews/autonomy-task4-agent-turn-evidence.md`.
- Task 5 evidence: `docs/reviews/autonomy-task5-role-harness-evidence.md`.
- Task 6 evidence: `docs/reviews/autonomy-task6-evidence-effects.md`.

## Autonomy program status

```text
TASK_0_BASELINE                  := COMPLETE
TASK_1_SEMANTIC_ACI_SANDBOX     := COMPLETE
TASK_2_TASK_CAPSULE_DAG          := COMPLETE
TASK_3_EXECUTION_LEDGER          := COMPLETE
TASK123_FINAL_INTEGRATION        := COMPLETE
TASK123_PROMOTION_TO_MAIN        := COMPLETE
MAIN_POST_MERGE_CI               := PASS

TASK_4_STRUCTURED_AGENT_TURNS    := COMPLETE
TASK_5_MANAGER_EXECUTOR_AUDITOR  := COMPLETE
TASK_6_EVIDENCE_EFFECTS          := REPAIRED_AWAITING_INDEPENDENT_GATE
TASK_7_PROJECT_INTELLIGENCE      := NOT_STARTED
TASK_8_SKILLS_MCP                := NOT_STARTED
TASK_9_MEMORY                    := NOT_STARTED
TASK_10_QUALITY_FLOOR            := NOT_STARTED
TASK_11_EVAL_LAB                 := NOT_STARTED
TASK_12_SELF_IMPROVEMENT_LAB     := NOT_STARTED
```

Tasks 1-3 are no longer staging work. They were independently reviewed, integrated on a clean line, re-proven on the target host, promoted through protected PR #12, and passed CI again on the resulting `main` merge commit.

The previously accepted deferred item assigned to Task 5 — the conservative pending-roles assignment recorded during Task 1 — was resolved in Task 5 and is no longer outstanding. See `docs/reviews/autonomy-task5-role-harness-evidence.md`.

The accepted deferred-refinements issue still holds items owned by later phases: the matching Exit Gate belongs to Task 10, and layered context compilation with a derived readable projection belongs to Tasks 7 and 9. Do not pull either forward.

## Tasks 1-3 accepted state

### Task 1 — semantic ACI + SandboxPort + adapter 1.1 foundation

Status: **COMPLETE**.

- Final accepted Task 1 line before integration: `c059a33e792971b409f7b7ada49f1633ecaad29f`.
- The mandatory target-host Docker proof passed on Task 1 and was rerun successfully on the final Tasks 1-3 integration candidate.
- Adapter protocol 1.1 remains additive beside strict protocol 1.0.
- `ADAPTER_PROTOCOL_VERSION` remains `"1.0.0"`.
- Runtime API 1.0 remains intact.

### Task 2 — Task Capsule / DAG

Status: **COMPLETE**.

- Accepted repaired Task 2/3 staging result before final integration: `34a74d9efd1907b8d810ee7d816c035de02ddcd1`.
- Task Capsule state is durable, revisioned, fingerprinted, and uses immutable logical revisions plus an atomic mutable head.
- Creation and transition behavior use the canonical transition policy.
- Evidence references are validated against the prospective task state rather than accepted as free-form identifiers.
- The Task Capsule implementation was split along responsibility boundaries so first-party production source remains within the frozen source-size architecture rule.

### Task 3 — Execution Ledger / reconciliation

Status: **COMPLETE**.

- Execution history is durable and append-only.
- Retry blocking, reconciliation state transitions, dependency traversal, pagination, restart/replay behavior, and task-scoped durable reads were covered by focused and integrated regressions.
- Live execution and historical reconciliation remain distinct responsibilities.

### Final Tasks 1-3 integration

Status: **COMPLETE**.

- Clean integration Task A SHA: `0ee21fc3034b1930f010c83d3e92445e9fe0a917`.
- Pre-integration/architecture Task B SHA: `abe580053bddf37ffa26fb4449a8a9bd99903577`.
- Independently accepted final integration SHA: `0c421dcfae73aca8259d36a01c3110c9792f074f`.
- Promotion branch SHA: `629c1575c4c3d161209308c8848e379a6f815c6e`.
- Main promotion merge SHA: `dfb98e47a973273d56f8f96007fc92fca9c6451c`.
- PR #12 used a normal merge commit; accepted integration history and the separate governance commit were preserved.
- Post-merge `main` CI run `33026864934` completed successfully on the exact merge SHA.

## Frozen invariants that remain authoritative

- Exactly 19 semantic model-facing operations:
  - `repo.map_task`
  - `repo.search`
  - `repo.symbol`
  - `repo.references`
  - `repo.impact`
  - `repo.history`
  - `code.inspect`
  - `code.patch`
  - `build.check`
  - `test.targeted`
  - `test.regression`
  - `debug.reproduce`
  - `failure.explain`
  - `git.status`
  - `git.diff`
  - `git.history`
  - `command.run`
  - `browser.inspect`
  - `browser.verify`
- `git.worktree` is not model-facing. `WorkspaceManagerPort` owns workspace/worktree lifecycle.
- Runtime API stays 1.0 unless a separately governed version change is explicitly approved.
- Adapter protocol 1.0 is not mutated; 1.1 additions remain additive.
- Task Capsule history uses logical `capsuleRevision` plus canonical fingerprint, immutable revisions, and an atomic mutable head.
- Execution Ledger kinds remain: `observation`, `check_result`, `effect_attempt`, `effect_confirmation`, `effect_nonapplication`, `invalidation`, `failure`, `reconciliation_indeterminate`.
- Unknown effect state blocks blind retry until deterministic reconciliation.
- Reconciliation is settlement/observation only; it does not become an alternate execution path.
- Correctness > completeness > verification > architecture > efficiency.
- One plan phase at a time; each phase must pass its hard gate before promotion.

## Repository architecture / verification state

- Frozen first-party production source-size rule: files above 500 lines fail architecture verification.
- The source-size test now scans applicable first-party production source roots repo-wide instead of only one package.
- At the accepted Tasks 1-3 integration candidate, zero applicable first-party production source files exceeded 500 lines.
- Canonical ordinary CI job: `verify`.
- CI performs frozen-lockfile install, typecheck, test, lint, and build.
- Target-host proofs are separate evidence and are not inferred from ordinary CI.

## Task 4 — accepted

Task 4 is **COMPLETE**. Accepted SHA `914a0e890772d615d00c80deaa7deb525e968f55` on
`autonomy-task4-agent-turns`, independently gated on 2026-08-27. It is not merged to `main`; Task 5
builds on it directly.

Structured agent turns, the additive adapter-protocol-1.1 agent invocation, the provider-neutral
agent model capability, the governed agent-turn loop, and the modernized local adapter are in place.
The exact-SHA CI run passed.

Qwen3.8-27B target-host qualification is **deferred and is not a Task 5 blocker**: the model is not
installed on this host, so the mandated proof reported `BLOCKED_ENVIRONMENT`. The same proof passed
8/8 twice against an installed real Qwen (`qwen3:14b`, Q4_K_M), including a measured 29,881-token
context against a 32,768-token budget. 64K remains unpromoted.

## Task 5 — accepted

Task 5 passed its independent gate at `895789a2bf89dcf6fb31a9f45a44f1d1f6961370` on
`autonomy-task5-role-harness`, after a round-2 FAIL on `728c908` was repaired. It is not merged to
`main`. What it established, and what Task 6 builds on:

- `role-handoff.ts` — one immutable, fingerprinted Manager→role dispatch. A role consumes it whole
  and verifies its fingerprint; it never re-accepts an equivalent-looking policy from its caller.
- `entry-acceptance-snapshot.ts` — the verification contract compiled from authoritative Task
  Capsule state and frozen before Executor work. Workspace identity is part of it and may be
  strengthened, never rebound or unbound.
- `manager-routing.ts` / `select-next-task.ts` — deterministic-first routing and a Manager that
  reads, decides, and writes nothing.
- `audit-task-result.ts` / `task-auditor.ts` — a deterministic verdict a model may advise but never
  overturn, against the frozen contract and the workspace observed at audit time.
- `task-executor.ts` — a fresh Executor that re-reads authoritative state and fails closed if the
  capsule or workspace moved since selection.
- `role-manifest.ts` — role invocation manifests with derived `readOnly`, persisted as ordinary
  Ledger resource facts.

The Task 5-assigned deferred role-assignment item was resolved: `browser.verify` is
auditor-permitted; `browser.inspect` deliberately is not.

## Current phase — Task 6

Task 6 is **implemented and repaired on `autonomy-task6-evidence-effects`, and awaiting its
independent gate**, branched from the accepted Task 5 SHA. It is not promoted and must not be merged
before that review.

The first implementation (`8723528`) returned `TASK6_INDEPENDENT_REVIEW=FAIL`. The gate was real but
its requirements were unreachable: `code.patch` asked for symbol, impact, and test-selection
observations that no bound governed operation produces, so the only way past it was for a test to
append the facts by hand. All five returned defects are repaired:

1. **The acquisition loop is real.** Requirements were moved down to what today's deterministic
   machinery can honestly answer — a current `workspace_file` observation, which the reference
   backend computes from bytes it reads off disk — and `governed-observation.ts` records what a
   governed read established as an `observation` entry, derived from the backend result rather than
   from any caller-supplied probe. The model path is now: refused, with the missing requirement
   named in the recorded refusal, then `code.inspect`, then the same effect authorized.
2. **No manually injected fact is offered as end-to-end proof.** Both end-to-end suites run the
   real governed path; direct fixture seeding survives only where the subject is something else.
3. **Both canonical authorities are live.** `command.run` and a repairing `code.patch` require
   verified passing acceptance-criterion evidence, scoped by the canonical `assessTaskEvidence`
   assessment, alongside current Ledger state.
4. **No circular prerequisite.** `browser.inspect` is ungated and produces what `browser.verify`
   consumes; two structural regressions sweep every operation in every task class for requirements
   with no producer, or whose only producer is the blocked operation itself.
5. **Current scope binding.** A request naming a job the authoritative capsule does not belong to is
   refused, and another job's observations do not satisfy this one.

Consequential effects are now conditioned on evidence and Ledger state:

- `evidence-precondition.ts` (application) — the pure deterministic predicate over existing
  `EvidenceRecord` semantics and valid Ledger observations/check results. Currency is decided by
  Task 3's canonical `isEntryStillValid`; there is no second staleness notion and no parallel
  evidence taxonomy.
- `evidence-precondition-catalog.ts` (runtime) — resolves requirements from operation, task class
  (the Task Capsule's own phase), and risk. `command.run` inherits the union of every *executable*
  operation's requirements, so the raw escape hatch can never be the cheap way round; an operation
  joins that union the day it gains a trusted execution binding.
- `governed-observation.ts` (runtime) — what a completed governed read established, derived from the
  backend's own result and recorded as an `observation`. This is what makes the gate reachable: the
  investigation an agent is sent to perform produces the facts its later effect consumes.
- `evidence-precondition-gate.ts` (runtime) — reads authoritative capsule, Ledger, and Evidence,
  evaluates, and refuses. It writes nothing.
- The gate is a **required** dependency of `createSemanticAuthorizationBoundary` and
  `GovernedExecutionSurface.create`, and runs inside `authorize()` — the single mandatory boundary —
  after policy and before any capability is minted.
- The agent-turn loop gained a required `observeResources` dependency and now supplies both
  `currentFingerprints` and `code.patch`'s `observedTargetFingerprint` from that observation. This
  closes the deferral Task 4 recorded in a comment.

The hard gate holds: missing or stale evidence blocks effects without blocking the investigation
path needed to satisfy them. Every read is ungated, as are the operations that produce evidence, in
every task class — and that is now enforced structurally rather than by inspection.

Task 7's Project Intelligence, Task 8's Skills/MCP, Task 9's memory, and Task 10's Exit Gate and
Quality Floor remain out of scope. `invoke-tool.ts` was reviewed and deliberately left unchanged; it
is the pre-autonomy tool path and no model turn can reach it.

Do not start Task 7 while Task 6 is still under review.

## Later phase order

1. Task 4 — structured agent turns + local adapter modernization.
2. Task 5 — deterministic Manager -> fresh Executor -> independent read-only Auditor.
3. Task 6 — evidence-conditioned effects.
4. Task 7 — Project Intelligence + embeddings, promoted only by measured value.
5. Task 8 — governed Skills + MCP.
6. Task 9 — authoritative memory with derived retrieval structures.
7. Task 10 — measured quality floor and escalation ladder.
8. Task 11 — isolated evaluation lab and sandbox/backend bakeoff.
9. Task 12 — isolated self-improvement lab with rollback and held-out evaluation.

## Session-start checklist

Every implementation/review session should:

1. fetch and verify live `main` and branch SHAs;
2. confirm the worktree is clean before writes;
3. read `AGENTS.md`, the canonical v2 architecture, and the canonical v2 plan;
4. identify exactly one current phase/hard gate;
5. preserve accepted main history and do new work on a branch/worktree;
6. run focused regressions before full gates;
7. require exact-SHA CI before promotion;
8. use the protected PR path for every change to `main`;
9. never start a later phase merely because the current implementation appears locally green.

## Historical evidence

Detailed implementation/review history is intentionally not duplicated here. Use Git history and the existing files under `docs/reviews/` when historical evidence is needed. The pre-promotion version of this file remains available in Git history at merge commit `dfb98e47a973273d56f8f96007fc92fca9c6451c`.
