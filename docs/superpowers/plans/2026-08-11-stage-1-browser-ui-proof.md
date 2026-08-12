# Stage 1 Browser UI Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the existing operator UI through a real browser for authentication, the complete project-to-results workflow, resumable SSE, displayed runtime state, restart recovery, and one real negative path.

**Architecture:** Keep the proof in `apps/runtime/tests`, the owning Layer 10 package. Launch the existing static UI and authoritative runtime in-process against a temporary real SQLite database, drive Chromium through Playwright, restart the runtime on the same port/database, and assert only user-visible and HTTP-boundary behavior. Change production code only when the browser test reproduces a defect, and protect each fix with the failing browser regression before implementation.

**Tech Stack:** TypeScript, Vitest, Playwright Chromium, node:http runtime, SQLite, SSE.

## Global Constraints

- Follow `AGENTS.md`, `docs/current-state.md`, `docs/architecture.md`, `docs/repository-map.md`, `docs/dependency-rules.md`, and `docs/repository-specification.md`.
- Do not redesign the UI, add commands, or expand the runtime contract.
- Preserve the runtime as authoritative; browser state is display/input state only.
- Fix only defects reproduced by the Stage 1 browser proof.
- Add regression coverage before every production fix.
- Finish with focused verification, `pnpm check`, `git diff --check`, truth-document updates, and one commit; stop before Stage 2.

---

### Task 1: Real browser workflow and recovery proof

**Files:**
- Create: `apps/runtime/tests/operator-ui.browser.test.ts`
- Adopt existing dependency edits: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `startRuntime(config): Promise<RunningRuntime>`, the existing `/`, `/health`, `/commands/:type`, `/records/:type/:id`, and `/events?afterSequence=N` routes.
- Produces: one Vitest browser regression that launches Playwright Chromium and proves the current operator surface end to end.

- [x] **Step 1: Write the failing browser regression**

  Add a Vitest case that launches Chromium, opens the real UI, proves a tokenless `project.create` renders `PERMISSION_DENIED`, saves the real token, waits for the authenticated SSE stream, drives `project.create → mission.submit → job.start → job.execute`, and asserts the displayed project/mission/job IDs, completed job, passing verification, champion decision, delivery receipt, and emitted event types.

- [x] **Step 2: Extend the same case over a real restart**

  Shut down the first runtime while the browser remains open, start a brand-new runtime on the same port and SQLite database, wait for the UI to reconnect using its last SSE cursor, read the completed job through the browser with the authenticated `/records/job/:id` route, create one new project, and assert the event list receives exactly the next durable sequence without duplicating replayed events.

- [x] **Step 3: Run the test and capture RED evidence**

  Run: `pnpm exec vitest run apps/runtime/tests/operator-ui.browser.test.ts`

  Expected: either PASS (the existing UI is proven without a production defect) or FAIL at a specific user-visible/browser boundary that identifies a demonstrated defect.

- [x] **Step 4: If RED identifies a product defect, apply strict TDD**

  State the root-cause hypothesis from browser/network evidence, keep the failing regression unchanged, make the smallest owning-file correction, and rerun the same command until it passes. Do not modify production code for test-environment or assertion defects.

- [x] **Step 5: Run focused runtime verification**

  Run: `pnpm exec vitest run apps/runtime/tests/operator-ui.browser.test.ts apps/runtime/tests/operator-ui.test.ts apps/runtime/tests/runtime-server.test.ts apps/runtime/tests/vertical-slice-restart-recovery.test.ts`

  Expected: all selected files pass with zero failures.

### Task 2: Record current truth and close Stage 1

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`

**Interfaces:**
- Consumes: fresh browser-test and repository-gate output.
- Produces: current-state and ownership text that records exactly what the browser proved, any confirmed fixes, and the next incomplete stage without changing architecture.

- [x] **Step 1: Update truth documents**

  Replace the `P1_BROWSER_UI_PROOF` incomplete status with the precise Chromium evidence: authenticated full workflow, displayed state, SSE reconnect/cursor behavior, restart readback, and negative authentication path. Update both repository maps in the same change; preserve unrelated remaining work and name Stage 2 only from the authoritative program truth available in the repository.

- [x] **Step 2: Run required gates fresh**

  Run focused verification again if documentation or a fix changed after the prior run, then run `pnpm check` and `git diff --check`.

  Expected: every command exits zero. Record exact case/file counts and skips from output rather than copying historical numbers.

- [x] **Step 3: Review scope and commit one stage**

  Inspect `git status --short`, `git diff --stat`, and `git diff`; verify no Stage 2 work or unrelated files are included. Commit all coherent Stage 1 files once with message `test: prove operator UI in a real browser` and report the resulting HEAD.
