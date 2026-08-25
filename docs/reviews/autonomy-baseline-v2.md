# V31M4 Autonomy v2 Baseline (Task 0)

**Date:** 2026-08-25
**Program:** `V31M4-AUTONOMY-001 / 1.1.0`
**Canonical architecture:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`
**Canonical plan:** `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`
**Preflight audit:** `docs/reviews/autonomy-preflight-audit.md`

This file is Task 0 of the canonical v2 plan: freeze the pre-autonomy-implementation baseline with
real, locally-executed evidence before any autonomy product code is written. No product behavior is
changed by this task; it is exact evidence plus a named future acceptance inventory.

## Live state at Task 0 start

- Branch: `autonomy-v1.1.0`
- Starting HEAD: `802f67650546954c3f90e0876f239339b8d85483` ("docs: record final autonomy preflight audit")
- `git status --short`: clean (no tracked or untracked changes)
- `node --version`: `v24.18.0`
- `pnpm --version`: `11.17.0`

## `pnpm check` baseline

### First run (as found)

`pnpm check` (`lint` → `typecheck` → `test`) reported:

- `pnpm lint` (Biome): 351 files checked, **9 warnings, 1 info, 0 errors**. All 9 warnings are
  pre-existing and match the counts already recorded in `docs/current-state.md` (`noNonNullAssertion`
  in two target-host-gated test fixtures under `plugins/video-production/tests/`, and
  `noUndeclaredEnvVars` in `scripts/dev.mjs` for `V31M4_HOST`/`V31M4_PORT`/`V31M4_ACTOR_ID`). No new
  lint defect.
- `pnpm typecheck` (turbo): **9/9 packages pass** (domain, contracts, application, infrastructure,
  runtime, department-host, video-production, game-production, departments-integration).
- `pnpm test` (vitest): **1 test file failed** —
  `apps/runtime/tests/operator-ui.browser.test.ts`. Failure:
  `browserType.launch: Executable doesn't exist at
  /home/xxthatguyxx/.cache/ms-playwright/chromium_headless_shell-1234/...`. This is a missing
  Playwright browser binary in this fresh worktree/container, not a product-code defect — the same
  class of environment gap `docs/current-state.md` already records for prior sessions (missing
  Chromium shared libraries), except this container had never downloaded the Playwright browser at
  all. Result: **489 passing / 14 skipped (504 total) across 106 passing + 1 failed + 4 skipped test
  files (111 total)**.

### Classification of the one failure

- **Category:** local test-tool environment setup gap (missing downloaded browser binary), not a
  product defect, not a flake, not an architecture/contract violation.
- **Reproduction:** `pnpm exec playwright install chromium` had never been run in this container;
  `~/.cache/ms-playwright` lacked the `chromium_headless_shell-1234` executable the installed
  `playwright`/`@playwright/test` version expects.
- **Resolution:** `pnpm exec playwright install chromium` — downloads the Playwright-managed browser
  binary only (Chrome for Testing, ffmpeg, chrome-headless-shell) into `~/.cache/ms-playwright`,
  outside the repository tree. This installs no new npm dependency, changes no `package.json`/lockfile,
  and modifies no product or test source. It is the same reversible, environment-only action prior
  sessions took for the equivalent missing-shared-library gap (see `docs/current-state.md`, Stage 1).
- **Not a genuine blocker:** the fix is a one-time local browser download with no product-code
  change, matching the plan's Task 0 requirement to explain every pre-existing failure before
  proceeding, not to silently skip or weaken the test.

### Second run (after `pnpm exec playwright install chromium`)

- `pnpm lint`: unchanged — 351 files, 9 warnings, 1 info, 0 errors.
- `pnpm typecheck`: unchanged — 9/9 packages pass (all cache hits except runtime, which reran clean).
- `pnpm test`: **all green** — **490 passing / 14 skipped (504 total) across 107 passing + 4 skipped
  test files (111 total)**. This exactly matches the last recorded full-gate evidence in
  `docs/current-state.md` (Item 3 corrected focused gate: "490 passing / 14 skipped (504 total)
  across 107 passing + 4 skipped test files (111 total)").
- `git status --short` after both runs: clean — the Playwright browser download and turbo/vitest
  cache activity touched no tracked file.

## Baseline verdict

**Zero unexplained baseline failure.** The only observed failure was a local browser-binary
environment gap, explained and closed by a reversible, non-product, non-dependency-adding action.
`pnpm check` is green: lint clean (0 errors, 9 pre-existing warnings, 1 pre-existing info), typecheck
9/9, tests 490 passing / 14 skipped across 107 passing + 4 skipped files. This is the frozen
pre-implementation baseline Task 1 onward must not regress.

## Current supervised-local model behavior (frozen, informational)

Recorded here only as a factual snapshot so later autonomy work cannot silently overstate today's
capability. No behavior below is changed by Task 0:

- The current local Ollama adapter (`adapters/local-supervised`) is **one-shot**: it issues exactly
  one bounded inference call per invocation and has no interactive tool-call loop. The model cannot
  call tools directly today; there is no `AgentTurn`-style `tool_call | finish | defer` protocol yet.
- The adapter enforces a fixed **64 KiB prompt ceiling** and hard-codes **`think:false`** on every
  request, regardless of the selected model's reasoning capability.
- Output is a structured, legacy JS/change-manifest shape produced by a single request/response pair,
  not a multi-turn structured agent transcript.
- `ToolGatewayPort`/`invokeTool` already enforce provider-neutral invocation plus policy/audit
  composition, but only for the existing tool surface — there is no task/workspace/sandbox-scoped
  tool capability, no embedding operation, and no adapter-protocol-1.1 capability yet. Adapter RPC
  remains exactly `1.0.0` today; `ADAPTER_PROTOCOL_VERSION` is unchanged.
- `WorkspaceManagerPort` remains the sole workspace/worktree authority; the model has no `.git`
  authority and cannot create worktrees.
- No `SandboxPort`, `SandboxIsolationPolicy`, `EmbeddingGatewayPort`, Task Capsule/Ledger, or
  self-improvement/promotion mechanism exists in the live tree yet. All of these are v2-plan future
  work, not implemented today.

This section makes no capability claim beyond what is verified above; it exists so a later task
cannot assert a "current behavior" that silently drifted from what was actually true at Task 0.

## Future acceptance inventory

`apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts` records nine named `it.todo()`
invariants the autonomy program must eventually prove with a real regression, per the canonical v2
plan's Task 0 Step 2. Each is inventory only — no test body exists yet, and none may be marked done
outside its owning implementation task:

1. No model-direct effect bypass.
2. Task state survives restart without chat history.
3. Ambiguous effect is reconciled before retry.
4. Agent turn cannot invoke disallowed operation.
5. Auditor cannot mutate candidate.
6. Stale workspace index cannot enter context.
7. Stale memory is not injected as current fact.
8. Deterministic failure cannot be overridden by neural verifier.
9. Quality floor abstains outside calibrated envelope.

## Scope of this task

This task changed only:

- `docs/reviews/autonomy-baseline-v2.md` (this file, new).
- `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts` (new, `it.todo()` only).
- `docs/current-state.md` (updated to record this baseline and the Task 0 hard gate).

No runtime API, adapter protocol, domain/application/contract behavior, or existing test assertion
was changed. `ADAPTER_PROTOCOL_VERSION` remains `"1.0.0"`. Task 1 of the canonical v2 plan does not
begin in this task.
