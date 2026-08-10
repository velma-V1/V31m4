# System-Build Checkpoint — 2026-08-09

**Purpose:** immutable, fact-only handoff snapshot of the verified state of the V31M4
system-build program, captured immediately before beginning the direct-command idempotency
repair. This file is a point-in-time record, not a living status document — see
`docs/current-state.md` and `repo_map.md` for current state (those may be ahead of, or in the
process of being reconciled with, what is recorded here; see "Known drift" below).

## Exact HEAD

```
1cc464d555e98e7b48daf35a69da8379d4020af9
```

## Branch state (verified via git, not inferred)

All three canonical branches are identical at the commit above:

| Branch | SHA |
| --- | --- |
| `main` | `1cc464d555e98e7b48daf35a69da8379d4020af9` |
| `canonical/layers-6-10` | `1cc464d555e98e7b48daf35a69da8379d4020af9` |
| `claude/v31m4-layers-validation-impl-dmlccn` | `1cc464d555e98e7b48daf35a69da8379d4020af9` |

Frozen audited product-code baseline (unchanged throughout this program): `78dc2b7`.

## System-build program: what is complete

Ten commits, `09cc9df` → `1cc464d`, each independently gated (full workspace typecheck/build/
test/lint green) before being pushed:

- `09cc9df` — real `pnpm dev` boot path (`scripts/dev.mjs`, `tsx`, no build step)
- `5ef14bf` — `project.create` wired as the runtime's first real Layer 6 use-case command
- `b84287d` — minimal real operator UI served at `GET /`
- `7c10f13` — documentation reconciliation + a real ComfyUI capability-matrix correction
- `14c8728` — dependency-boundary tests added for 6 packages that lacked one
- `2022187` — `mission.submit` wired
- `10e97c6` — `job.start` wired (`RuntimeService.registerDirect` introduced)
- `186d684` — `job.execute` wired (solver → verify → select-champion → deliver, full chain)
- `024a9ff` — operator UI mission/job/execute panels
- `1cc464d` — automated restart-recovery test for the full mission flow

### Boot and lifecycle

- `pnpm dev` boots the authoritative runtime for real: creates `runtime-data/` (gitignored),
  generates/persists a local dev session token, runs `apps/runtime/src/main.ts` via `tsx`.
- `GET /health` — real, unauthenticated.
- Authenticated command dispatch — real, bearer-token session auth.
- Graceful shutdown on `SIGINT`/`SIGTERM` — real, checkpoint-safe.
- Restart recovery — real: durable log head and prior records survive a process restart against
  the same SQLite file (verified both manually via `pnpm dev` + `curl` and by an automated test).

### Real commands (all four verified with real HTTP requests against a real server + real SQLite)

- `project.create` — real, via the unmodified `createProject` Layer 6 use case.
- `mission.submit` — real, via the unmodified `submitMission` Layer 6 use case.
- `job.start` — real, via the unmodified `startJob` Layer 6 use case.
- `job.execute` — real, drives the unmodified `runSolverForge`, `verifyCandidates`,
  `selectChampionUseCase`, and `deliverResult` Layer 6 use cases in sequence.

### Durable state proven to persist and survive restart

Project, mission, job (with status transitions), solver candidate, verification result, champion
decision, delivery receipt, and the durable committed-event sequence — all confirmed recovered
correctly by `apps/runtime/tests/vertical-slice-restart-recovery.test.ts`, which shuts one real
runtime instance down and boots a **brand-new instance** against the same SQLite file rather than
reusing in-memory state.

### Operator UI (`apps/runtime/public/index.html`, served at `GET /`, no framework/build step)

Session token entry, system health, project creation, mission submission (JSON-textarea form,
pre-filled from the just-created project), job start, job execute, and a live event log via a
hand-rolled SSE-over-fetch reader (chosen because `EventSource` cannot set the `Authorization`
header this runtime's `/events` route requires).

## Execution truth — what is real vs. reference (do not blur this distinction)

| Component | Status |
| --- | --- |
| `job.start`'s production kernel | **REFERENCE** (`ReferenceProductionKernel`) — no real model/tool execution, no supervised child process |
| `job.execute`'s model gateway | **REFERENCE** (`ReferenceModelGateway`) — no real model inference |
| `job.execute`'s verifier | **REFERENCE** (`ReferenceVerifier`) — a real check (does the declared output artifact exist with real bytes) but not real test/build/lint execution |
| Artifact store | **REAL** (`ContentAddressedArtifactStore`, reused as-is from `packages/infrastructure`) |
| SQLite persistence | **REAL** |
| Workspace directories | **REAL** (real, isolated directories under `runtime-data/workspaces/`) |
| Event outbox | **REAL** |
| SSE event stream | **REAL** |
| Restart recovery | **REAL** |

Never describe the reference model gateway, production kernel, or verifier as real production
inference or real production verification. No real model/tool/kernel adapter process is installed
or bound on this machine; Layer 9's `SupervisedModelGateway`/`SupervisedProductionKernel` exist for
when one is.

## External tool state (unrelated to the system-build program above, tracked independently)

| Tool | Installed | Adapter integrated | Target-host validated |
| --- | --- | --- | --- |
| ComfyUI | yes, at `/home/xxthatguyxx/ComfyUI` | no | no |
| Summer | no | no | no |

Video department real adapters (already validated in earlier work, unaffected by this program):
`FfmpegAssemblyAdapter` — validated. `OllamaVisionQcAdapter` — validated.

## Verification (freshly run for this checkpoint, not carried over from an earlier claim)

- `pnpm typecheck`: 9/9 packages
- `pnpm build`: 9/9 packages
- `pnpm test`: 394 passing / 10 skipped across 87 passing + 2 skipped test files (404 total), no
  `V31M4_TARGET_HOST` set
- `pnpm lint`: 0 errors (9 warnings, 1 info)
- `pnpm check`: PASS (aggregates lint + typecheck + test)
- `apps/runtime/tests/vertical-slice-restart-recovery.test.ts`: green — full mission flow
  (project → mission → job start → job execute → delivered champion receipt), real process
  shutdown, real new-instance boot against the same database, every record and the durable event
  sequence confirmed recovered

## Known drift — explicitly not fixed by this checkpoint

Recorded so the next task does not have to rediscover it. None of the following were touched by
this checkpoint commit:

1. `DirectCommandHandler` idempotency semantics (`job.start`, `job.execute`) are weaker than the
   canonical `ExternalCommandExecutor` contract: idempotency is reached by construction
   (deterministic job id + `CONFLICT` recovery for `job.start`; job-status-machine gating for
   `job.execute`) rather than by one atomic enclosing transaction. This is the next task (P0
   direct-command idempotency repair).
2. Frozen-core wording in places still describes the L1–10 source as unchanged without explicitly
   accounting for the approved `apps/runtime` system-assembly extensions added by this program.
3. `docs/current-state.md` has pending, uncommitted edits (present in the working tree, not
   discarded) that bring its "System build" section up to date with everything this checkpoint
   describes — not committed as part of this checkpoint, by design, to keep this snapshot
   separate from ordinary documentation-currency maintenance.
4. `repo_map.md` has pending, uncommitted edits (same working-tree state as above, same reason)
   updating its test counts and additive-test breakdown to the numbers recorded above.
5. `docs/repository-map.md` does not yet map the current runtime composition (`composition-root.ts`,
   `use-case-infrastructure.ts`, `job-execution-infrastructure.ts`), the operator UI, or the new
   real/reference adapters this program added.
6. Some prose elsewhere still describes ComfyUI as not installed; the capability-matrix table in
   `docs/reviews/target-host-validation.md` was corrected in commit `7c10f13`, but not every
   mention was swept.

## Next task

P0: direct-command idempotency repair (item 1 above).
