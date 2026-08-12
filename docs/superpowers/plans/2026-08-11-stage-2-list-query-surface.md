# Stage 2 List/Query Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose authoritative persisted mission, job, candidate, and evidence listings through an authenticated, strictly validated runtime query API.

**Architecture:** Add the two missing Layer 3 request/response schemas beside the existing mission and candidate resource schemas, while reusing the existing job/evidence list contracts. Layer 10 gains a read-only query registry and `POST /queries/{aggregate}.list`; query handlers validate project/mission/job relationships and call the existing Layer 4 repository ports directly. Repository adapters must paginate after relationship filtering so items, totals, and cursors never disclose records outside the requested boundary.

**Tech Stack:** TypeScript, Zod, `node:http`, Vitest, SQLite.

## Global Constraints

- Preserve the Layer 1–10 dependency direction and import only public package APIs.
- Return repository-backed authoritative state; do not reconstruct collections from events or UI state.
- Reuse `MissionRepositoryPort`, `JobRepositoryPort`, `CandidateRepositoryPort`, and `EvidenceRepositoryPort`.
- Use strict `1.0.0` request/response metadata and existing pagination/error conventions.
- Keep queries out of `ExternalCommandExecutor`; reads do not require idempotency records or write transactions.
- Add no pagination framework, UI, CLI, approval, adapter, or Stage 3 work.
- Finish with focused tests, one fresh `pnpm check`, `git diff --check`, truth-map updates, one commit, and a non-force `main` push.

---

### Task 1: Strict contracts and real HTTP query proof

**Files:**
- Modify: `packages/contracts/src/missions.schemas.ts`
- Modify: `packages/contracts/src/capabilities.schemas.ts`
- Modify: `packages/contracts/tests/runtime-resources.schemas.test.ts`
- Create: `apps/runtime/tests/list-queries.test.ts`

**Interfaces:**
- Produces: `listMissionsRequestSchema`, `listMissionsResponseSchema`, `listCandidatesRequestSchema`, and `listCandidatesResponseSchema`.
- Proves: `POST /queries/mission.list`, `/queries/job.list`, `/queries/candidate.list`, and `/queries/evidence.list` against a real runtime and SQLite database.

- [x] **Step 1: Write contract tests for the missing strict mission/candidate list schemas**

  Assert valid metadata/relationship/pagination bodies parse, unknown or missing relationship fields fail, responses reject duplicate records, and the public barrel exports the schemas.

- [x] **Step 2: Write a failing real-runtime Stage 2 test**

  Create multiple projects and deliberately interleaved missions/jobs, execute jobs to persist candidates/evidence, then prove authenticated filtered results, empty results, malformed payload errors, fail-closed authentication, cross-project relationship rejection, restart persistence, and unchanged get-by-id behavior.

- [x] **Step 3: Run RED checks**

  Run `pnpm exec vitest run packages/contracts/tests/runtime-resources.schemas.test.ts apps/runtime/tests/list-queries.test.ts` and confirm failures are caused by missing schemas/query routes.

### Task 2: Query dispatch, relationship validation, and filtered pagination

**Files:**
- Modify: `apps/runtime/src/composition-root.ts`
- Modify: `apps/runtime/src/api/server.ts`
- Create: `apps/runtime/src/list-query-surface.ts`
- Modify: `apps/runtime/src/use-case-infrastructure.ts`
- Modify: `apps/runtime/src/job-execution-infrastructure.ts`

**Interfaces:**
- Produces: `RuntimeService.registerQuery(queryType, handler)` and `RuntimeService.query(queryType, payload, context)`.
- Produces: `registerListQueries(service, { projects, missions, jobs, candidates, evidence })`.
- Consumes: existing strict list schemas and existing repository-port list methods.

- [x] **Step 1: Implement the missing contract schemas**

  Require `projectId` for mission lists; require both `projectId` and `missionId` for candidate lists; return unique bounded arrays plus the existing pagination result.

- [x] **Step 2: Add the read-only query transport and registry**

  Authenticate `POST /queries/:queryType`, parse the safe JSON body under the existing byte limit, build an operation context without requiring an idempotency header, dispatch a registered query, and map errors through the existing mapper.

- [x] **Step 3: Register the four list handlers**

  Parse with `listMissionsRequestSchema`, `listJobsRequestSchema`, `listCandidatesRequestSchema`, or `listEvidenceRequestSchema`; verify referenced project/mission/job records exist and agree; call only the existing repository ports; map `Versioned<T>` to values; validate each response schema.

- [x] **Step 4: Correct filtered pagination if the HTTP proof exposes leakage**

  Apply relationship predicates before slicing pages and calculate `total`/`nextCursor` from the filtered collection in the owning runtime repository adapters.

- [x] **Step 5: Run focused GREEN and owning-layer checks**

  Run the Stage 2 contract/runtime tests, existing runtime server and command tests, contract package tests, runtime typecheck, and runtime dependency-boundary test.

### Task 3: Record truth, verify, publish, and stop

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`
- Modify: this plan

- [x] **Step 1: Update all truth maps with the exact implemented query names, boundaries, and fresh evidence**

- [x] **Step 2: Run the final gates once**

  Run focused Stage 2 tests, `pnpm check`, and `git diff --check`; record fresh counts only.

- [x] **Step 3: Review the complete diff and commit once**

  Verify no architecture violation, duplicate abstraction, auth/data leak, scope creep, or Stage 3 work; commit as `feat: add persisted list query surface`.

- [x] **Step 4: Push and verify synchronization**

  Non-force push `main` to `origin/main`; verify GitHub `origin/main`, the local tracking ref, and local HEAD are identical, the branch is 0 ahead/0 behind, and the worktree is clean. Stop before Stage 3.
