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

## Autonomy program status

```text
TASK_0_BASELINE                  := COMPLETE
TASK_1_SEMANTIC_ACI_SANDBOX     := COMPLETE
TASK_2_TASK_CAPSULE_DAG          := COMPLETE
TASK_3_EXECUTION_LEDGER          := COMPLETE
TASK123_FINAL_INTEGRATION        := COMPLETE
TASK123_PROMOTION_TO_MAIN        := COMPLETE
MAIN_POST_MERGE_CI               := PASS

TASK_4_STRUCTURED_AGENT_TURNS    := IMPLEMENTED_AWAITING_INDEPENDENT_GATE
TASK_5_MANAGER_EXECUTOR_AUDITOR  := NOT_STARTED
TASK_6_EVIDENCE_EFFECTS          := NOT_STARTED
TASK_7_PROJECT_INTELLIGENCE      := NOT_STARTED
TASK_8_SKILLS_MCP                := NOT_STARTED
TASK_9_MEMORY                    := NOT_STARTED
TASK_10_QUALITY_FLOOR            := NOT_STARTED
TASK_11_EVAL_LAB                 := NOT_STARTED
TASK_12_SELF_IMPROVEMENT_LAB     := NOT_STARTED
```

Tasks 1-3 are no longer staging work. They were independently reviewed, integrated on a clean line, re-proven on the target host, promoted through protected PR #12, and passed CI again on the resulting `main` merge commit.

One previously accepted deferred item remains assigned to its planned later phase. It is known and accepted; do not pull it forward unless the governing architecture/plan requires it for the phase being implemented.

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

## Current phase — Task 4

Task 4 is **implemented on `autonomy-task4-agent-turns` and awaiting its independent gate**. It is
not promoted and must not be merged before that review.

Implemented:

- `packages/contracts/src/agent-turn.schemas.ts` — the provider-neutral agent-turn output contract
  `tool_call | finish | defer`, versioned separately from the adapter protocol, with no
  chain-of-thought field.
- `packages/domain/src/value-objects/private-reasoning.ts` — the one frozen list of
  private-reasoning property names, enforced at every boundary that accepts model output.
- Adapter protocol 1.1 gained an additive `model.invoke_agent` method carrying the reasoning policy,
  the output-contract version, the allowed operation IDs, and a bounded context budget. Protocol
  1.0 is byte-identical and still rejects every 1.1 construct.
- `ModelGatewayPort` gained the `AgentModelGatewayPort` capability beside its unchanged legacy
  `invoke`; `SupervisedModelGateway` implements it and strictly validates the adapter's answer.
- `apps/runtime/src/autonomy/agent-turn-loop.ts` — the governed loop. Context is rebuilt from the
  authoritative Task Capsule and folded Ledger before every turn, the runtime revalidates every
  turn, and turn/tool/defer/refusal/context budgets bound the run. `finish` returns
  `ready_for_verification` and certifies nothing.
- `adapters/local-supervised/model-adapter.mjs` serves the structured agent path beside its
  preserved legacy path: reasoning policy translated to `think` only inside the adapter, a
  configurable hard byte ceiling replacing the fixed 64 KiB autonomy limit, an explicit token
  budget as `num_ctx`, oversize refused rather than truncated, and no reasoning trace persisted.
- `scripts/prove-agent-turn-real.mjs` (`pnpm prove:agent-turn`) proves the whole real path on the
  target host and reports `BLOCKED_ENVIRONMENT` honestly when a prerequisite is missing.

Target-host status:

- The plan's Qwen3.8-27B Q4_K_M is **not installed** on this host, so the mandated proof is
  `BLOCKED_ENVIRONMENT`. Pulling it was not authorized. No Qwen3.8-27B measurement is claimed.
- The same proof passed 8/8 twice against an installed real Qwen (`qwen3:14b`, Q4_K_M) as non-target
  evidence, including a measured 29,881-token context against a 32,768-token budget.
- 64K remains unpromoted and requires its own measured target-host evidence.

Do not start Task 5 while Task 4 is still under review.

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
