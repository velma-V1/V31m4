# V31M4 Current State

This file is a concise operational handoff for future Claude Code sessions. It records verified repository state and should be updated whenever branch, implementation, verification, blockers, or remaining work materially changes.

## Repository state

- Branch: `autonomy-v1.1.0` (branched from `main`; `main` itself remains at the state described below).
- Handoff baseline commit before this file was added: `2fe85cd708c6dffd4d05872f3a85926648e6a676`
- Live HEAD: verify from git at every session start; do not trust a stored SHA as current after subsequent commits.
- Architecture baseline: `V31M4-SRS-001 / 1.0.0`
- Hardened ancestor: `5746e5f2571a08dea3cce0493adeac92ae025135`
- Canonical continuation is based on the hardened Layer 5 line. Older Layer 6 implementations are reference material only.

## Autonomy program state (`V31M4-AUTONOMY-001 / 1.1.0`)

- Canonical architecture: `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`.
  Canonical plan: `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`. Both supersede the
  same-date non-v2 autonomy spec/plan, which are historical only (see `AGENTS.md`).
- Preflight audit complete: `docs/reviews/autonomy-preflight-audit.md`.
- **Task 0 (freeze the pre-autonomy baseline): DONE and verified green.** Evidence:
  `docs/reviews/autonomy-baseline-v2.md`. Starting HEAD `802f676`, clean worktree, `node v24.18.0`,
  `pnpm 11.17.0`. The only baseline failure was a missing local Playwright browser binary
  (environment gap, not a product defect); after `pnpm exec playwright install chromium` (no
  dependency/lockfile change), `pnpm check` is fully green: lint 0 errors (9 pre-existing warnings, 1
  pre-existing info), typecheck 9/9. Before adding this task's own acceptance-inventory test file,
  tests were 490 passing / 14 skipped (504 total) across 107 passing + 4 skipped files (111 total),
  matching the last recorded full-gate evidence below exactly. Nine named future invariants were then
  recorded as `it.todo()` only in
  `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`; because that file is entirely
  `it.todo()`, Vitest counts it as a skipped file and each `it.todo()` as a "todo" test, so the exact
  final count at the Task 0 commit is **490 passing / 14 skipped / 9 todo (513 total) across 107
  passing + 5 skipped files (112 total)**. No runtime API, adapter protocol, or product behavior was
  changed; `ADAPTER_PROTOCOL_VERSION` remains `"1.0.0"`.
- **Task 1 (scoped semantic ACI, `SandboxPort`, adapter-protocol-1.1 foundation): PASS. The
  mandatory target-host Docker proof is CLOSED at `c059a33`.** The record below preserves the
  earlier FAILED and BLOCKED rounds as history; they are no longer the current status. The
  authoritative proof record is `docs/reviews/autonomy-task1-phase1-evidence.md`, whose final
  section reports the successful real Docker run — real engine, digest-pinned image, live
  container, every required isolation property observed, cleanup independently verified.
  - First implementation: commit `fc84f37`. An independent Codex review then found four defects and
    returned **FAIL**. All four are reproduced, root-caused, and repaired (commit recorded in
    `docs/reviews/autonomy-task1-phase1-evidence.md`), but Task 1 does **not** pass its hard gate
    until a real container actually runs and every required isolation property is observed.
  - **Finding 1 — semantic authorization was not bound to the execution sink.** `SandboxPort.execute`
    took an operation string plus free-form JSON, so `{ operation: "git.status", executable: "touch" }`
    was accepted and the backend ran `touch`; the `code.patch` fingerprint/path checks had no
    mandatory production caller. **Repaired:** a non-forgeable `AuthorizedSemanticExecutionPlan` is
    now the only thing the sink accepts, issued solely by `authorizeSemanticExecution`, which derives
    a trusted runtime-owned command for every operation except the explicit `command.run` escape
    hatch, rejects caller-supplied execution parameters outright, and validates `code.patch`
    fingerprint/path-scope/staleness at that boundary.
  - **Finding 2 — the Docker backend bypassed Layer 8 supervision.** It spawned the client directly,
    a timeout killed only the CLI, an already-aborted signal still spawned, cleanup errors were
    swallowed, and the supervisor deleted authoritative state before destruction succeeded.
    **Repaired:** every docker invocation runs under `ProcessSupervisor`; a pre-aborted operation
    never spawns; timeout and cancellation force-remove the named container and verify its absence;
    cleanup failure is surfaced; a failed destroy leaves the sandbox degraded and reconcilable
    instead of forgotten.
  - **Finding 3 — configuration could defeat the isolation policy.** `{ image: "alpine:latest",
    userSpec: "0:0", containerWorkdir: "/" }` was accepted, mounting the workspace over the container
    root as root from an unpinned image. **Repaired:** settings are validated before anything is
    probed or executed — the image must be `<repository>@sha256:<64 lowercase hex>`, uid and gid may
    not be 0, and the container workspace target is a backend-owned constant a caller cannot replace.
  - **Finding 4 — repository state falsely advanced the gate.** Corrected here and in the evidence
    file, which retains the original failed evidence alongside the findings and remediation.
  - **Round 2 (independent re-review of `29f0b55`, verdict FAIL_IMPLEMENTATION).** Five further
    findings, all reproduced and repaired:
    1. *The public plan factory recreated the bypass.* `AuthorizedSemanticExecutionPlan.issue` was
       public and took a caller-supplied contract, so anyone could mint an authentic `git.status`
       plan carrying `touch`. Minting now lives in a closure: `createSemanticExecutionAuthority`
       returns a mint/verify pair, `createSemanticAuthorizationBoundary` keeps the mint private and
       exposes only `authorize` plus a verifier, the contract is read from the canonical catalog,
       and a sandbox accepts only capabilities its own paired boundary minted.
    2. *Output-limit termination could strand a container.* `ProcessSupervisor` now reports why it
       ended a process, and any unconfirmed client termination — timeout, cancel, output limit,
       supervisor signal — force-removes the container, verifies its absence, and reports an
       indeterminate effect. The sandbox never returns to `ready` on an unconfirmed termination.
    3. *Plans could be replayed, and patch currency was checked too early.* Every capability now
       carries an `executionPlanId` and is spent exactly once, and the sandbox re-reads the
       authoritative workspace immediately before dispatch — a target that moved after
       authorization is `CONFLICT` and never reaches the backend.
    4. *The target-host proof was incomplete.* It now also observes `HOME`/`TMPDIR`, proves `/tmp`
       and the sandbox HOME are tmpfs mapping no host storage, and exercises a real wall-clock
       timeout with independent verification that the named container is gone.
    5. *Unknown config keys were accepted.* Docker settings are strictly allowlisted, so a legacy
       `containerWorkdir` (or any other unexpected security-sensitive key) is rejected.
  - **Round 3 (independent re-review of `8671024`, verdict FAIL_IMPLEMENTATION).** Four further
    findings plus a residual patch/workspace TOCTOU risk, all reproduced and repaired:
    1. *Execution trusted a stale workspace handle.* A workspace sealed after `prepare` still
       reached the backend. Dispatch now takes an execution lease and re-reads
       `WorkspaceManagerPort`: the workspace must exist, be active, keep its identity and
       project/purpose/created-at, and still resolve to the prepared canonical root. A new
       `WorkspaceExecutionInterlock` — a decorator over the one workspace manager, not a second
       authority — makes seal/discard and in-flight dispatch mutually exclusive, so a lifecycle
       change during an effect loses deterministically with `CONFLICT`.
    2. *Abnormal Docker client exits bypassed reconciliation.* Exit 125 (and a null exit) are now
       `docker_client_abnormal_exit`, and any other non-zero exit is reported as an ordinary
       failure only after the container's absence proves its lifecycle finished. Anything else is
       force-removed, verified, and left `unknown` + `degraded`.
    3. *Only stderr was bounded, and `maxOutputBytes` was unvalidated.* `ProcessSupervisor` gained
       opt-in combined stdout+stderr accounting (opt-in so JSON-RPC adapter callers that read
       stdout as a protocol channel are unaffected), and `maxOutputBytes` must be a positive
       integer no greater than 64 MiB.
    4. *The target-host proof lacked runtime attestation.* It now reads `/proc/self/status` inside
       the real container and requires `CapEff`/`CapBnd` fully dropped and `NoNewPrivs == 1`; a
       missing field is a failed observation, not a skipped check.
    5. *Residual patch TOCTOU.* Containment now resolves the deepest existing ancestor, so a
       nonexistent target beneath an escaping symlink parent is rejected. A backend may only write
       through `applyWorkspaceChange`, which re-checks the fingerprint inside the same call under
       the execution lease, and the supervisor refuses a `workspace_write` effect to any backend
       that has not declared write support.
  - **Round 4 (independent re-review of `6b2d4ba`).** Three further findings, all reproduced and
    repaired:
    1. *The interlock was not multiplicity-safe.* Leases were keyed by `sandboxId`, so two
       executions from one sandbox collapsed into a single holder and the first release freed the
       workspace while the second effect was still running; overlapping lifecycle mutations were
       also possible. Each lease now carries its own unique identity, release is idempotent and
       tied to that exact lease, and the stated policy is **exclusive dispatch per workspace** —
       every governed operation reaches a writable workspace mount, so none may be treated as a
       harmless concurrent reader. Lifecycle changes are exclusive against effects and against
       each other.
    2. *Compare-and-apply could be captured by a pre-placed symlink.* The temporary file used a
       predictable `<target>.v31m4-apply` name; a symlink at that path turned the "safe" temp
       write into a host-side write outside the workspace, which a probe demonstrated. The
       replacement is now created in the validated canonical parent with an unguessable name via
       exclusive creation (`wx`, mode 0600), written through its own descriptor, re-verified
       against the expected fingerprint immediately before the rename, and removed on any failure.
    3. *The read-only-root proof was a false positive.* A failed `touch /` proves permissions, not
       a read-only mount — demonstrated on this host, where the write fails while
       `/proc/self/mountinfo` reports `rw,relatime`. The proof now parses the container's mount
       table and requires the root mount to carry `ro`, keeping the failed write as supplemental
       evidence only. The egress probe now proves its own utility exists before treating that
       utility's failure as evidence of a blocked network.
  - **Round 5 (independent re-review of `3bd7b8a`).** One finding, reproduced and repaired: the
    network proof only proved DNS failure. `getent hosts …` exiting non-zero was read as "egress
    blocked", but name resolution can fail on a fully connected host — demonstrated here, where
    `getent hosts example.invalid` exits 2 while the kernel reports `eth0`/`eth1`/`loopback0`, a
    default route via `0100000A`, and a numeric-IP TCP connect to `1.1.1.1:443` succeeds. The proof
    now reads what `--network none` actually establishes: `/sys/class/net` must contain only `lo`,
    and `/proc/net/route` must carry no default route and no route off a non-loopback interface. A
    live numeric-IP connection attempt remains supplemental and is skipped when no such tool
    exists, so correctness never depends on an optional utility. The proof no longer prints an
    egress claim unless those kernel observations pass.
  - **Final implementation review of `bf5ef96`, repair resumed from its preserved interrupted
    worktree.** Five findings were reproduced and repaired without starting Task 2:
    1. Caller-supplied `policyDecision: "allow"` no longer authorizes anything. The canonical
       boundary snapshots the exact request, calls `PolicyEnginePort`, rejects deny and
       approval-required decisions, binds policy ID/expiry plus catalog risk,
       evidence-precondition ID, and resource ceilings into the issuer-bound capability, and
       rechecks expiry at the final synchronous dispatch edge after asynchronous workspace
       validation. Docker execution uses the stricter wall-clock and output
       ceiling; the existing workspace interlock is stricter than every catalog concurrency
       ceiling. This binds the evidence-policy identifier only; it does not implement the later
       EvidenceRecord/Ledger engine.
    2. Docker names now hash the complete `SandboxId`, duplicate authoritative IDs are refused,
       all four sandbox/task/job/workspace ownership labels are inspected, and destructive
       cleanup uses the observed full container ID only after exact ownership and name checks.
       A foreign same-name container is never removed.
    3. Ordinary effects dispatch only from authoritative `ready`; `running`, `degraded`, and
       `stopped` fail closed. Cancel cleanup cannot promote an indeterminate degraded sandbox to
       ready. Execution claims `running` before its first asynchronous pre-dispatch read, while
       cancel/destroy claim `stopped`, so sandbox execution and lifecycle cleanup cannot race or
       erase authoritative state. Task 1 still has no Ledger reconciler.
    4. Route, capability/`NoNewPrivs`, and mountinfo parsers now reject malformed and ambiguous
       observations instead of accepting partial numeric coercions or incomplete records.
    5. The target-host proof retains its in-container kernel checks and now supervises a live
       `docker inspect` of the exact running V31M4 container. It verifies ownership, canonical
       workspace source, the sole host bind at `/workspace`, no volume/extra bind/socket, approved
       `/tmp` and HOME tmpfs, read-only root, non-root user, dropped capabilities,
       no-new-privileges, and network mode `none` before the proof can proceed. Its independent
       named-container absence challenger also uses the existing process supervisor.
  - Current repair verification: focused Task 1 suites **177 passing / 2 skipped / 8 todo (187
    total) across 14 passing + 1 skipped files (15 total)**; supervised processes **9/9**;
    `pnpm check` exit 0 — lint 378 files with 9 pre-existing warnings and 1 pre-existing info,
    typecheck 9/9, **651 passing / 16 skipped / 8 todo (675 total) across 118 passing + 5 skipped
    files (123 total)**; `pnpm build` 9/9. The non-mandatory proof passed its two reference/static
    checks and explicitly reported direct-Docker isolation **NOT PROVEN** because no digest-pinned
    image was supplied. This is implementation readiness evidence only, not a passed Task 1 gate.
  - **CLOSED — the required target-host Docker proof.** It ran for real against `c059a33`; see
    the final section of `docs/reviews/autonomy-task1-phase1-evidence.md` for the engine, the
    pinned image, and the per-property observations. Two defects surfaced and were repaired in the
    course of closing it: the proof derived a non-root identity from the assigned workspace rather
    than hardcoding one, and `assertDockerRuntimeObservation` dropped a fixed three-mount total in
    favour of a stricter rule (exactly one host-visible mount; any additional bind, any volume, and
    any unapproved tmpfs target refused whatever the total). No isolation property was relaxed and
    the host workspace was not adjusted to make the proof pass.

    *History (superseded).* Before that run the proof was blocked here: a Windows Docker CLI shim was on
    this WSL2 distro's `PATH`, but invoking `docker version` reports that Docker is unavailable in
    the distro and asks for Docker Desktop WSL integration; `/var/run/docker.sock` was absent and
    no digest-pinned image had been supplied. A non-empty
    `V31M4_SANDBOX_IMAGE` is **not** a pinned image; the proof validates the digest syntax and the
    backend refuses to construct itself without one. Until the run recorded above, non-root
    execution, read-only root, absent Docker socket, blocked egress, workspace-only write, and
    verified container cleanup were all unobserved. The command that closed it:

    ```bash
    V31M4_SANDBOX_IMAGE=<repository>@sha256:<64 hex> \
    V31M4_AUTONOMY_PHASE1_REQUIRE_DOCKER=1 \
    node scripts/prove-autonomy-phase1-real.mjs
    ```

    That blockage is resolved; the command above is the one that closed the proof.
  - **No sandbox backend is promoted**, and the bake-off may still return `NO_ACCEPTABLE_BACKEND`.
  - Current gate after round 5: `pnpm check` exit 0 — lint 0 errors (9 pre-existing warnings, 1
    pre-existing info), typecheck 9/9, **626 passing / 16 skipped / 8 todo (650 total) across 116
    passing + 5 skipped test files (121 total)**; `pnpm build` 9/9; `git diff --check` clean. This
    is a green regression suite, **not** a passed Task 1 gate.

- **Task 1's hard gate has passed.** Task 2 and Task 3 are therefore no longer forbidden, and the
  clean Task 1+2+3 integration candidate described under "Task 1+2+3 final integration" below is
  the current line of work.

- **Task 2 / Task 3 (staging branch `autonomy-task2-3-staging`): implemented, independently
  reviewed, FAILED, then repaired — NOT accepted.** This work lives only on the staging branch;
  `autonomy-v1.1.0` is untouched at `bf5ef96b059e26d0176fbf6cf81a37d96d169731` and nothing is
  merged. Task 1 remains INCOMPLETE, so neither task may be called passed. An independent review
  of `faa13e3` returned four HIGH findings; each was reproduced against the committed code before
  any repair, then root-caused, repaired, and covered by permanent regressions:
  - **T2-1 — a fabricated evidence ID satisfied a checked transition.** `TaskTransitionPolicy`
    validated only syntax, count, and uniqueness, so `evidence:fake` could enter `complete` or
    `repair`. Transitions now resolve every cited reference through the existing
    `EvidenceRepositoryPort` inside the same transaction and require the record to exist, be
    `passed`, belong to the capsule's project, agree with its job, and be about a subject the
    capsule owns. The policy stays pure but takes a mandatory evidence assessment, so it cannot be
    evaluated on caller assertion at all. Self-review found the same hole at creation
    (`createTaskCapsule` could seed `verifiedEvidenceIds`); that is repaired through the same
    authority. No second evidence store was created.
  - **T3-1 — a same-intent check/append race.** `runGovernedEffect` projected, decided, then
    appended as separate steps, so two concurrent callers could both claim and both dispatch.
    Reading the history, `decideRetry`, and the `effect_attempt` append now happen in one
    authoritative `UnitOfWork` transaction that commits before anything reaches the environment.
  - **T3-2 — request task ID could disagree with plan/sandbox.** The complete scoped identity
    (`request.taskId`/`plan.taskId`/`sandbox.taskId`, `plan.jobId`/`sandbox.jobId`,
    `plan.workspaceId`/`sandbox.workspaceId`, `plan.sandboxId`/`sandbox.id`) is now checked before
    projection, ledger write, or dispatch; a mismatch fails closed with no entry and no dispatch.
  - **T3-3 — first-500 ledger truncation.** Retry projection, reconciliation, and finalized-outcome
    conflict detection each read one 500-entry page and ignored `nextCursor`. All three now use one
    canonical paged walk built on the existing `collectPortPages` mechanism, which follows the
    cursor to exhaustion, rejects a repeated cursor as `INTEGRITY_FAILURE`, and reports its
    defensive page ceiling as a typed non-success rather than pretending history ended.
  - **Round 2 (independent re-review of `314604e`).** Two further HIGH findings, both reproduced
    against the committed code before any repair and both repaired:
    - **T2-2 — evidence was validated against the previous state.** `proposeTaskTransition`
      resolved and judged evidence against `current`, then applied `TaskCapsuleChanges` — which may
      replace `acceptanceCriterionIds` or `changeArtifactIds` in the same move. A record proving a
      subject the committed capsule no longer owned could therefore authorize the transition, and
      already-carried `verifiedEvidenceIds` were exempted from revalidation entirely. Evidence is
      now judged against a typed `TaskEvidenceScope` derived from immutable task/project/job
      identity plus the proposed changes, **every** reference that will exist afterwards is
      revalidated (carried ones included), and a post-condition proves the scope evaluated is the
      scope actually written. The scope carries a nominal marker, so passing a capsule where the
      committed scope is required is a compile error rather than a silent regression.
    - **T3-4 — check validity dependencies were not enforced.** `isEntryStillValid` read only the
      entry's own facts and the invalidated set, so `dependsOnEntryIds` meant nothing: a check
      whose own report had not moved stayed "current" after the observation it rested on was
      invalidated or went stale. Validity now requires every declared dependency to exist, be
      fact-bearing, belong to the same task and job, and itself be valid, chaining transitively and
      failing closed on a missing, foreign, or cyclic dependency. Reference edges are also hardened
      at append time: outcome/failure/check/invalidation references must all resolve inside the
      same task **and** job, and an invalidation may only name a fact-bearing entry — so it can
      never be aimed at an effect attempt.
  - **Round 3 (independent re-review of `74f6e31`, Task 3 only).** Two further HIGH findings, both
    reproduced against the committed code before any repair and both repaired by replacing the
    ad-hoc outcome checks with one canonical attempt-outcome state machine:
    - **T3-5 — a `failure` could create a second resolution.** The fold treated a failure naming an
      attempt as resolving it, but the append-time conflict check considered only the three
      `effect_*`/`reconciliation_*` kinds. So `failure → confirmation`, `confirmation → failure`,
      and `failure → failure` were all accepted, and every later fold of that task threw
      `INTEGRITY_FAILURE` — an accepted append permanently bricked the task's history, since even
      claiming a new intent folds first.
    - **T3-6 — an indeterminate attempt could never be reconciled.** `reconciliation_indeterminate`
      marked the attempt resolved, and append then refused any later confirmation or
      non-application. An effect whose reality became observable after a crash was therefore
      blocked for ever, contradicting the canonical invariant that unknown effects block retry
      *until reconciled*.
    - **The repair.** `unresolved`, `failed`, and `indeterminate` all block a retry but stay
      reconcilable; `confirmed` and `not_applied` are terminal. Transitions are
      `unresolved → {failed, indeterminate, confirmed, not_applied}`,
      `failed → {indeterminate, confirmed, not_applied}`, `indeterminate → {confirmed,
      not_applied}`, and nothing leaves a terminal state. There is no self-transition, so a
      repeated status can never be used to manufacture history. The append path and the fold share
      one table, so every accepted sequence folds and a forbidden stored transition is corruption.
      A new `EffectReconciler.reconcileAttempt` settles an already-attempted effect from a probe's
      observation with **zero** sandbox dispatches, validates the transition inside the
      authoritative transaction so exactly one of two concurrent reconciliations wins, and writes
      nothing when reality is still unprovable and already on record as such.
  - **Round 4 (independent re-review of `0bcad10`, Task 3 only).** One further HIGH finding,
    reproduced against the committed code before any repair, then repaired:
    - **T3-7 — authoritative ledger state did not prove the Task 1 issuer.** `EffectReconciler`
      accepted anything *typed* as an `AuthorizedSemanticExecutionPlan` and never held a
      `SemanticExecutionCapabilityVerifier` of its own. On the effect path the only issuer check
      lived at the sandbox sink, which runs *after* the `effect_attempt` is already durable, so a
      capability minted by a foreign semantic authorization boundary created authoritative history
      before Task 1 ever rejected it — behaviour an existing test explicitly accepted. Worse,
      `reconcileAttempt` dispatches through `SandboxPort` by design, so on that path no issuer
      check happened at all: a foreign plan, a plain `{ ...plan }` copy, or an
      `Object.create(plan)` forgery (which passes `instanceof`) could drive the probe and append a
      terminal `effect_confirmation`. Reproduced: all four attacks produced a full authoritative
      outcome.
    - **The repair.** `SemanticExecutionCapabilityVerifier` is now a mandatory
      `EffectReconcilerDependencies` member — the verify half of the *same* boundary the paired
      `SandboxPort` holds — and both `runGovernedEffect` and `reconcileAttempt` verify the issuer
      as their first statement: before the projection a claim reads, before any append, before
      dispatch, and before the probe. It is `verify`, never `consume`: the single-use spend stays
      at the sink in `SandboxSupervisor`, untouched, and reconciliation performs no effect so it
      must not re-spend execution authority. Investigated rather than assumed: Task 1's `verify`
      tests only the authority's own mint registry and is independent of `consumed`, so a
      capability whose execution already spent it stays authenticity-verifiable and can settle the
      attempt it created — no bearer-token authority was invented and no Task 1 semantics were
      weakened. `observePostState` became private, removing the last public entry point that could
      run a probe on an unverified plan.
  - Gate after round 4: `pnpm check` exit 0 — lint 0 errors (9 pre-existing warnings, 1
    pre-existing info), typecheck 9/9, **863 passing / 16 skipped / 6 todo (885) across 124
    passing + 5 skipped test files (129 total)**; `pnpm build` 9/9; `git diff --check` clean. This
    is a green regression suite, **not** a passed Task 2 or Task 3 gate.

- **Round 5 — independent defensive security audit of Tasks 1/2/3, repaired on
  `autonomy-task2-audit-repair` (branched from `autonomy-task2-3-staging` at `c7ef85e`).** The
  audit returned `SECURITY_GATE := FAIL` on one HIGH. It was re-verified here against the exact
  SHA before any code changed — reproduced red against the **real** SQLite repository and the real
  `TaskManager`, not only against fakes — and confirmed.
  - **T2-3 — creation was a second entry point into the state machine that skipped every
    phase-entry rule.** `createTaskCapsule` never consulted `TaskTransitionPolicy`, and its
    evidence check was guarded by `verifiedEvidenceIds.length > 0`. Citing nothing therefore
    skipped the evidence authority entirely, so a first revision could be born already `complete`
    — which is **terminal**, so the checked API could never afterwards correct the durable record
    — or already in `repair`, or already in `execute` without the attempt its entry costs. T2-1
    had closed the half where a *reference* could be laundered as verified; the half where the
    *phase itself* needs justification stayed open. **Repaired at the authority boundary, not in
    the entity:** `TaskCapsule.create` is a structural constructor that must keep building any
    revision, including rehydration, so the use case enforces the rule. `TaskTransitionPolicy`
    now publishes `requiresEvidence(phase)` alongside the existing `attemptCost(phase)`, and
    `createTaskCapsule` asks the policy rather than restating the set — one place for the rule,
    no second copy to drift. A phase whose entry needs evidence may not be created on assertion
    alone (the existing `assessTaskEvidence`/`resolveTaskEvidence` pair then validates the
    citation exactly as the transition path does), and a phase whose entry spends an attempt may
    not be created with that attempt unpaid. Both are refused, never coerced. Non-gated phases
    stay creatable exactly as before, and no Task Capsule public contract, canonical fingerprint,
    durable revision semantic, evidence-scope check, or Task 3 attempt/reconciliation semantic
    changed. Regressions: 8 in `packages/application/tests/use-cases/task-capsule.test.ts`, 1 in
    `packages/application/tests/services/task-transition-policy.test.ts`, and 5 against the real
    durable repository in `apps/runtime/tests/autonomy/task-state.test.ts`; 6 of them failed
    before the repair and pass after it.
  - **Five MEDIUM findings were verified and deliberately deferred on this branch, none blocking.**
    Three are in Task-1-owned code that this branch must not carry (`SandboxIsolationPolicy`'s
    numeric bounds are bypassable by a hand-built policy literal; the semantic `role` is a caller
    assertion never cross-checked against `context.actor.roles`; `workspaceRoot` is interpolated
    unescaped into the Docker `--mount` CSV). One is Task-3 persistence
    (`SqliteExecutionLedgerRepository.listForTask` rehydrates every ledger row of every task per
    page, so one corrupt row stops governed effects for all tasks — availability, fail-closed, and
    a durable-query change that does not belong in a focused security repair). One is branch
    ancestry (`autonomy-task123-integration-rehearsal` is built on `c059a33^`, not on final Task 1
    `c059a33`, so it ships the superseded `assertDockerRuntimeObservation`; fail-closed, and
    rewriting the preserved rehearsal was out of scope). **All but one are now closed on the
    integration branch** — see "Task 1+2+3 final integration" below.
  - Gate after round 5: `pnpm lint` exit 0 (9 pre-existing warnings, 1 pre-existing info),
    `pnpm typecheck` 9/9, `pnpm test` **877 passing / 16 skipped / 6 todo (899) across 124 passing
    + 5 skipped test files (129 total)**, `pnpm build` 9/9. That was a green regression suite on the
    staging branch, not a merged result; the branch was submitted for independent re-audit rather
    than merged, and it was accepted there. Task 2 and Task 3 are **PASS** as accepted at
    `34a74d9`. Task 4 remains BLOCKED and unstarted.

## Task 1+2+3 final integration (`autonomy-task123-final-integration`)

The first real clean Task 1+2+3 integration candidate. **Not a passed final-integration gate** —
it is built and locally verified here, and its next hard gate is independent review.

- **Branch:** `autonomy-task123-final-integration`, branched from final Task 1 `c059a33` and
  reconciled forward. It is not a fast-forward of anything: the final Task 1 line and the repaired
  Task 2/3 line (`34a74d9`) genuinely diverge, and the reconciliation was semantic. Every Task 1
  file is byte-identical to `c059a33`; the Task 2/3 work was adapted to Task 1's stronger contract,
  never the reverse. The superseded `autonomy-task123-integration-rehearsal` was used as behavioural
  reference only — its final authority design was ported, its rejected intermediate history was not
  replayed, and the branch itself is untouched.
- **Authority design.** A governed execution surface builds the Task 1 semantic boundary, the
  sandbox that boundary governs, and the Execution Ledger reconciler together, so a reconciler
  whose verifier and sink come from different authorities cannot be assembled. Privileged behaviour
  is captured at canonical construction and held in module-private state, so patching a public
  member changes what a caller is told and nothing about what executes. Semantic effects have
  exactly one gateway. Live execution authority and historical reconciliation authority stay
  distinct: settling reads the durable `effect_attempt` row alone — no capability, no sandbox
  handle, no dispatch — so reconciliation is observation and settlement, never a second execution
  path.
- **Security items from the round-5 audit.** The HIGH was already closed by the repaired Task 2/3
  line the integration carries (`34a74d9` gates capsule creation on the phase-entry rules), and the
  branch-ancestry MEDIUM is eliminated by construction, since this branch descends from `c059a33`
  and carries the current `assertDockerRuntimeObservation`. Three MEDIUMs are repaired here with
  permanent regressions: `SandboxIsolationPolicy` is now nominally branded and re-asserted at the
  container argument sink; a workspace root containing `,` or `=` is refused before a sandbox
  exists, because such a path cannot be expressed safely in a `--mount` specification; and the
  Execution Ledger filters and pages in SQL, rehydrating only the returned page, so one unreadable
  row no longer stops governed effects for every task. One MEDIUM remains deliberately deferred —
  binding the semantic `role` to `context.actor.roles` — because the autonomy module is still
  unwired and the binding belongs with the Manager/Executor/Auditor phase that will define it.
- **Architecture.** `packages/domain/src/entities/task-capsule.ts` was 604 lines, over the frozen
  500-line limit. It is split along real responsibility boundaries into the entity itself, its
  bounded field vocabulary (`task-capsule-fields.ts`), and its plan graph (`task-capsule-dag.ts`).
  No functionality was removed, no contract weakened, and the canonical fingerprint is byte-identical
  before and after. The source-size test — which historically covered one package's `src` — is now a
  genuine repository-wide gate over every first-party production source root the repository actually
  has, with regression coverage proving an oversized file is caught and that only build output and
  vendored code are skipped. Zero production source files exceed 500 lines.
- **Frozen invariants held:** runtime API 1.0 unbroken, `ADAPTER_PROTOCOL_VERSION` still `"1.0.0"`,
  adapter 1.1 still additive, exactly 19 semantic model-facing operations, `git.worktree` still
  absent from that set, `WorkspaceManagerPort` still the workspace/worktree lifecycle authority.
- **Preserved branches are untouched:** `autonomy-v1.1.0`, `autonomy-task2-3-staging`,
  `autonomy-task2-audit-repair`, `autonomy-task123-integration-rehearsal`, and `main` are all at
  the SHAs they held before this work.
- **Next hard gate: independent review of the integration candidate.** Main promotion is not
  started — the repository still has a separate promotion-governance gap involving
  main/workflow/ruleset protection — and Task 4 remains BLOCKED.

## Verified implemented state

- Layers 1-5: hardened baseline complete before this canonical continuation.
- Layer 6: 21 application use-case orchestration entrypoints are present under `packages/application/src/use-cases`.
- Layer 7: SQLite persistence, transactional outbox/idempotency, content-addressed artifacts, and verified backup/restore are present under `packages/infrastructure`.
- Layer 8: repository evidence records process supervision, JSON-RPC framing/correlation, adapter registration, restart-budget protection, bounded scheduling, resource monitoring, secret leases, and redacted logging.
- Layer 9: governed production gateways — real-path containment (`PathPolicy`), a fail-closed rule-based policy engine, a durable plugin registry, and supervised provider-neutral model/tool/kernel gateways under `packages/infrastructure/src/{paths,policy,plugins,gateways}`.
- Layer 10: authoritative runtime under `apps/runtime` — a `node:http` surface with local session authentication, typed command/query/event routes, an idempotent external-command executor, the durable committed-event replay store (`packages/infrastructure/src/events/event-replay-store.ts`), a resumable event-stream coordinator (replay-before-live boundary, internal-gap and retention `refresh_required` refusal, bounded slow-consumer disconnect with a resumable cursor), startup recovery over the durable log, and checkpoint-safe shutdown.

## Important repository evidence already inspected

- `repo_map.md` reports Layer 6 use cases and Layer 7 infrastructure with a full Layer 1-8 regression of 286 passing cases across 60 test files.
- `docs/repository-map.md` records ownership for the Layer 6 application-use-case surface and Layer 7 persistence/artifact infrastructure.
- `docs/reviews/layers-1-8-improvement-ledger.md` records Layer 8 process/adapter infrastructure and its failure-path coverage.

Reconciled on 2026-08-08: `repo_map.md` labelled the current layer as Layer 8 and recorded Layer 7 persistence plus Layer 8 process/adapter infrastructure with the regression numbers noted then. Superseded on 2026-08-09: the L1–10 core is complete and `repo_map.md` now labels the current layer as Authoritative Runtime Layer 10; the current verified evidence is in the "Known verification evidence" section below (340 tests / 71 files).

## Known verification evidence

Latest repository-map evidence inspected during handoff setup reports:

Re-run and verified on 2026-08-09 after completing the Layer 10 authoritative runtime:

- Full Layer 1-10 regression: 340 passing cases across 71 test files.
- Layer 10 authoritative-runtime + audit regression: external-command idempotency, durable event replay, event-stream coordinator, config validation, live HTTP surface (SSE replay, cross-restart recovery, SSE-disconnect cleanup), integrated hardening, plus the production-readiness audit fixes (idempotency-store write-failure propagation, empty-secret redaction).
- `pnpm typecheck`: 5/5 packages pass (domain, contracts, application, infrastructure, runtime).
- `pnpm build`: 5/5 packages pass (`tsc --noEmit`).
- `pnpm lint` and `pnpm check`: green (0 errors, 1 info).

Do not treat these results as proof for later changes. Re-run the appropriate focused and full gates after modifying code.

## Resolved architectural direction

- Current canonical contracts/interfaces are authoritative over superseded/reference branches.
- Old Layer 6 may be used for behavioral comparison only.
- Do not rename current APIs or create compatibility shims merely to imitate old names.
- Application use cases orchestrate through existing domain/services/ports and preserve transaction/external-call boundaries.
- World/runtime/API concerns belong to their owning later layers rather than being forced into earlier core layers.

## Production departments (current state)

The departments are implemented and verified as removable first-party departments on the generic
host SDK; they are **not** deferred. What remains is the real production-adapter implementation and
execution for external tools (see `real_external_adapters` below and
`docs/reviews/target-host-validation.md`).

```text
CORE := {
  status: FROZEN_L1_L10,
  baseline: 78dc2b7,
  dependency_on_video: false,
  dependency_on_game_3d: false,
  MUST preserve_extension_points(DEPARTMENT_HOST)
}

DEPARTMENT_HOST := {
  status: IMPLEMENTED,           // packages/department-host
  role: GENERIC_REMOVABLE_DEPARTMENT_PLATFORM
}

VIDEO := {
  status: IMPLEMENTED,           // plugins/video-production, verified + removable
  role: REMOVABLE_FIRST_PARTY_DEPARTMENT,
  core_dependency: false,
  host_dependency: true,
  real_external_adapters: {
    AssemblyAdapter: REAL_FFMPEG_VALIDATED,        // FfmpegAssemblyAdapter, see target-host-validation.md
    VisionQcAdapter: REAL_FFMPEG_OLLAMA_VALIDATED, // OllamaVisionQcAdapter (qwen3.5:9b), see target-host-validation.md
    ShotGenerationAdapter: TARGET_HOST_VALIDATION_PENDING   // ComfyUI installed (confirmed 2026-08-09
                                                             // at /home/xxthatguyxx/ComfyUI, WSL-native)
                                                             // but not yet executed/adapter-integrated;
                                                             // no installed Ollama model does video/image
                                                             // generation
  },
  open_generative_ai_core_dependency: false
}

GAME_3D := {
  status: IMPLEMENTED,           // plugins/game-production, verified + removable
  role: REMOVABLE_FIRST_PARTY_DEPARTMENT,
  core_dependency: false,
  host_dependency: true,
  execution_platform_decision: SUMMER,   // 2026-08-09, architecture only, no code changed —
                                          // see docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md
  real_external_adapters: TARGET_HOST_VALIDATION_PENDING    // SummerAdapter (Godot via Summer's MCP/CLI);
                                                              // direct Blender/Unreal adapters out of scope for now
}
```

Distinction: the departments themselves are implemented and verified using deterministic reference
adapters (orchestration, caching, checkpoint/resume, output verification, and removability all
pass). Two of Video's real production adapters are now implemented and target-host-validated
(ffmpeg `AssemblyAdapter`, ffmpeg+Ollama `VisionQcAdapter`). Still incomplete: Video's
`ShotGenerationAdapter` (needs ComfyUI — installed but not yet executed/adapter-integrated, see
`docs/reviews/target-host-validation.md`) and all of Game/3D's real adapters (Summer, reaching
Godot via its own MCP/CLI, per
`docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md` — Summer itself is
not installed). This remains target-host validation, not department work. Do not
describe the departments as deferred. Open Generative AI is not a core dependency; it may be
evaluated only for optional reusable parts within the Video department.

## Areas already mapped

Unless new evidence, compile/test failures, changed interfaces, or contradictions require reinspection, avoid broad rediscovery of:

- Layer 1-5 hardened architecture and contracts.
- Layer 6 application port surface and use-case ownership.
- Layer 7 persistence/artifact ownership.
- Existing architecture/source-of-truth documents already referenced by `AGENTS.md`.

Use targeted search/read for the exact interface or invariant needed by the current task.

## Resolved blocker (2026-08-08)

At `6c24c9e` the infrastructure package did not build: `packages/infrastructure/src/index.ts`
exported `./artifacts/content-addressed-artifact-store.js`, but that source file had never
been committed (only its test and the barrel export existed), so infrastructure typecheck
failed and 7 of 9 infra test files failed on the broken barrel import. The store was
implemented from the existing `content-addressed-artifacts` test and the `ArtifactStorePort`
contract (streamed SHA-256 hashing, atomic hash-addressed blob write, content dedup,
expected-hash verification before persistence, transactional metadata with rollback blob
cleanup). Infrastructure and the full Layer 1-8 gate are now green (numbers above).

## Current task / next action

1. Layer 9 governed production gateways: DONE and verified green — `PathPolicy` real-path
   containment, fail-closed `RuleBasedPolicyEngine`, `SqlitePluginRegistry`, and supervised
   `SupervisedModel/Tool/ProductionKernel` gateways under
   `packages/infrastructure/src/{paths,policy,plugins,gateways}`.
2. Layer 10 authoritative runtime (Task 5 in
   `docs/superpowers/plans/2026-08-07-layers-6-10-canonical.md`): DONE and verified green
   (2026-08-09) under `apps/runtime`. Composition root, strict validated config,
   authenticated local sessions, typed command/query/event routes, error mapping,
   idempotent external-command executor, durable committed-event replay store + resumable
   event-stream coordinator, startup recovery, and checkpoint-safe shutdown. Full gate:
   typecheck 5/5, 340 tests / 71 files, build 5/5, lint/check clean. Transport decision: the
   event stream is served over SSE (Last-Event-ID ↔ `afterSequence`) on `node:http` rather
   than a hand-rolled WebSocket framing layer — the zero-runtime-dependency, correctness-
   maximizing binding for a loopback local-first runtime; the coordinator is transport-
   agnostic so a WebSocket binding can be added later without touching replay semantics.
3. Task 6 integrated Layers 1–10 hardening: DONE (2026-08-09). Adversarial regressions on the
   new L10 surface (hostile input, concurrent idempotent/conflicting writers, transactional
   rollback) plus a clean-room dependency/architecture review; no defects confirmed. Ledger:
   `docs/reviews/integrated-hardening-ledger.md`.
4. Task 7 clean-checkout verification: DONE (2026-08-09). Detached worktree at the final SHA,
   `pnpm install --frozen-lockfile`, full gate reproduced green (typecheck 5/5, build 5/5,
   lint/check clean, largest source 468 lines, 0 explicit `any`).
   Evidence: `docs/reviews/clean-checkout-verification.md`.
5. Production-readiness audit: DONE (2026-08-09). One HIGH (idempotency-store swallowed
   non-duplicate write failures) and three MEDIUM/LOW fixes (health metric truthfulness/perf,
   SSE mid-backpressure disconnect leak, empty-secret log redaction), each with a regression;
   remaining surfaces audited sound. Report: `docs/reviews/production-readiness-audit.md`.
6. Canonical promotion: COMPLETE (2026-08-09). `canonical/layers-6-10` was fast-forwarded from
   `6c24c9e` to the frozen audited **code** baseline `78dc2b7` (clean fast-forward, 0 divergent
   commits, no force). `78dc2b7` is an **immutable audited baseline snapshot** — that commit itself
   never changes, and remains the fixed reference point for "what the L1–10 audit covered." Since
   then, `canonical/layers-6-10` and the source branch `claude/v31m4-layers-validation-impl-dmlccn`
   must remain aligned, and later commits added documentation/control-state, **additive post-core
   packages**, and (see the correction below) one explicitly approved core correction.
   **Correction (2026-08-10):** the live tree is no longer byte-for-byte unchanged since `78dc2b7`
   — stop asserting that. `packages/application/src/use-cases/select-champion.ts` (commit
   `2786ca9`) fixed a genuine, previously-undiscovered defect: the `no_verified_solution` decision
   path unconditionally threw `INVALID_CHAMPION_DECISION` instead of ever succeeding, because it
   passed `selectChampion`'s deliberately-empty summary-reason evidence straight through to a domain
   entity (`ChampionDecision.create`) that requires non-empty, reason-consistent evidence on every
   decision, including a no-solution one. The fix stamps the no-solution decision with the real
   verification evidence every evaluated candidate already carries; it changes no champion-selection
   algorithm, no domain invariant, and no port/use-case signature, and shipped with a dedicated
   regression test (`packages/application/tests/use-cases/select-champion.test.ts`) plus 5
   integration tests proving the negative-verification path end to end
   (`apps/runtime/tests/job-execution-negative-verification.test.ts`). `docs/architecture.md`
   already anticipates this: "later work is additive post-core unless an explicitly approved core
   correction is required" — this is that case. The freeze's *meaning* holds even though its
   literal "unchanged since `78dc2b7`" wording does not: no uncontrolled redesign occurred, the core
   dependency direction is still enforced, no public API/contract was casually changed, and the
   correction required explicit evidence (a failing reproduction) and regression coverage before
   being made. Also since `78dc2b7`: additive Layer-10 `apps/runtime` system-assembly extensions
   (the system-build program below) and the P0 direct-command idempotency repair (`apps/runtime`
   only — new runtime wiring, not a core-file modification). Do not copy a live HEAD SHA from this
   document — always verify the current HEAD from git at session start.
7. Post-core program (2026-08-09) — see `docs/reviews/post-core-program-status.md`:
   - **Main promotion: COMPLETE.** `main` fast-forwarded `fbbebdd → 9801338` (clean FF, 38 commits,
     no force); `main` == `canonical/layers-6-10` == source branch. True of this `78dc2b7` →
     `9801338` promotion window: the frozen L1–10 core source was unchanged; later commits in that
     window added documentation/control-state plus the additive post-core packages
     (`packages/department-host`, `plugins/video-production`, `plugins/game-production`,
     `apps/departments-integration`) and the corresponding `pnpm-lock.yaml` update. **This is no
     longer true of the current tree** — see item 6's 2026-08-10 correction above: one explicitly
     approved core correction (`select-champion.ts`, commit `2786ca9`) landed after this promotion.
     Invariant, corrected: FROZEN_CORE_TREE = unchanged **except by explicitly approved, evidence-
     backed, regression-tested correction**; POST_CORE_CODE = additive.
   - **Stable core tag: local only, remote push BLOCKED.** Annotated `v31m4-core-l1-10-stable` created
     locally at `9801338`; `git push` of the tag ref returns HTTP 403 (egress/org policy allows
     branch pushes, denies tag-ref pushes), and no GitHub MCP tag/release/ref tool exists. Needs an
     admin to allow tag pushes or a human to create the tag/release at `9801338`.
   - **Core freeze: IN EFFECT.** L1–L10 frozen; the post-core work added new packages only and
     changed no core source (verified: core imports nothing from the host/departments).
   - **Department host SDK: COMPLETE.** `packages/department-host` — generic removable-department
     lifecycle (install→enable→start→invoke/health→stop→disable→remove) on the existing
     `PluginRegistryPort` + unit of work, with swappable isolation connector, workspace rollback, and
     fail-closed manifest/version/permission/dependency checks. 12 tests.
   - **Video Production department: COMPLETE.** `plugins/video-production` — removable; per-shot
     generate→vision-QC→bounded-correction→assemble with output verification, checkpoint/resume, and
     project/cache storage separation; production tools (ffmpeg/Blender/ComfyUI/generation-vision
     models) behind replaceable adapters with deterministic reference adapters. 7 tests.
   - **3D/Game Production department: COMPLETE.** `plugins/game-production` — removable, independent of
     Video; per-scene acquire→build→validate→bounded-repair→package with verification and
     checkpoint/resume; engines (Godot/Unreal/Blender) behind replaceable adapters. 8 tests.
   - **Independence matrix: VERIFIED.** `apps/departments-integration` — core-only, both departments
     together, cross-removal independence, and host operable after both removed. Dependency direction
     verified (no core→department imports; no video↔game import; departments' src import only
     application + department-host). Full gate (re-run 2026-08-09): typecheck 9/9, 375 tests / 10
     skipped across 83 test files, build 9/9, lint/check clean.
   - **Dependency-boundary tests added (2026-08-09).** `domain`, `contracts`, `department-host`,
     `plugins/video-production`, `plugins/game-production`, and `apps/runtime` each gained a static
     import-boundary test (matching the pre-existing pattern in `application`/`infrastructure`),
     machine-verifying the allowed-import sets in `docs/dependency-rules.md` instead of relying on
     documentation/code-review alone. `packages/domain` gained `@types/node` as a **test-only**
     devDependency (matching `packages/contracts`' existing precedent) purely so its test file can
     use `node:fs`/`node:path`; domain's own new test asserts its `src` still imports nothing
     non-relative, so this does not weaken domain's runtime isolation.
   - **Outbox retention: intentionally deferred** pending workload evidence.
   - **Target-host validation: IN PROGRESS** on the actual local target machine (WSL2 on Windows 11,
     RTX 4070 SUPER 12GB). Capability matrix, honesty rule, and per-adapter evidence:
     `docs/reviews/target-host-validation.md`.
     - **DONE (2026-08-09):** Video `AssemblyAdapter` real implementation —
       `FfmpegAssemblyAdapter` (`plugins/video-production/src/ffmpeg-assembly-adapter.ts`), backed by
       the real Windows `ffmpeg.exe` invoked from WSL (no shell string construction, argument-array
       spawn, no `@v31m4/infrastructure` runtime dependency added — department dependency direction
       preserved). Real-tool tests gated behind `V31M4_TARGET_HOST=1`
       (`plugins/video-production/tests/ffmpeg-assembly-adapter.target-host.test.ts`, 5 tests: real
       concat + checksum/hash verification, missing-file/corrupt-file/bad-executable failure paths,
       pre-aborted cancellation), skip cleanly without the flag. `ReferenceAssemblyAdapter` unchanged.
       Video package gate: typecheck clean, lint clean (0 errors), 12/12 tests pass with
       `V31M4_TARGET_HOST=1`, 7/12 (5 skipped) without it.
     - **DONE (2026-08-09):** Video `VisionQcAdapter` real implementation —
       `OllamaVisionQcAdapter` (`plugins/video-production/src/ollama-vision-qc-adapter.ts`), backed
       by real ffmpeg frame extraction plus a real inference call to the installed vision-capable
       Ollama model `qwen3.5:9b` (GPU-loaded, RTX 4070 SUPER 12GB; no download performed — model was
       already installed). Fails closed on missing/undecodable shot media, unreachable Ollama
       server, and malformed/unparseable model response (never a silent pass). Root-cause fix
       applied and evidenced: `qwen3.5:9b` is a reasoning model, and Ollama's `format:"json"`
       constrains its hidden reasoning tokens too, so it returned an empty response until `think:
       false` was added. Real-tool tests gated behind `V31M4_TARGET_HOST=1`
       (`plugins/video-production/tests/ollama-vision-qc-adapter.target-host.test.ts`, 5 tests:
       exactly one real model-inference call plus 4 fast failure/cancellation paths), skip cleanly
       without the flag or when the model/server aren't available. Shared process-supervision logic
       extracted to `plugins/video-production/src/internal/run-external-process.ts` and reused by
       both real adapters (no duplicate cancellation/timeout/stderr-capture logic).
       Video package gate: typecheck clean, lint clean (0 errors), 17/17 tests pass with
       `V31M4_TARGET_HOST=1`; without the flag, the 10 real-tool tests (across both real adapters)
       skip cleanly and 7 reference-adapter tests still pass.
     - **PENDING:** Blender, Godot, Unreal, and Summer are not installed on this machine (checked
       Program Files, Start Menu, winget, registry App Paths — none found); installing them is a
       material user choice (large downloads/licensing) and was not done automatically.
       **Correction:** ComfyUI *is* installed — the scan above only checked the Windows side;
       ComfyUI was later found at `/home/xxthatguyxx/ComfyUI` (WSL-native), see the "Not yet done"
       list below and `docs/reviews/target-host-validation.md`. No real `ShotGenerationAdapter`
       exists yet regardless — no installed Ollama model does video/image generation (they are
       text/vision LLMs), and ComfyUI has not been executed or adapter-integrated for V31M4.
     - **Game department execution-platform decision (2026-08-09):** Summer is the primary
       execution platform for the Game department's real adapters, reaching Godot through Summer's
       own MCP/CLI, behind the *existing* `AssetAdapter`/`SceneBuildAdapter`/
       `SceneValidationAdapter`/`PackageAdapter` ports — no new port surface, no code changed. A
       direct Blender/Unreal adapter and any custom Godot agent bridge are explicitly out of scope
       until the Summer path is real and validated. Architecture only; no `SummerAdapter` is
       implemented. See
       `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`.
   - **System-assembly program (started 2026-08-09, current through Stage 4 Real Supervised Execution):**
     turned the verified backend into a runnable, operable system: a genuine end-to-end mission
     flow, a real idempotency-defect repair, a real champion-decision-defect repair,
     negative-verification-path proof, evidence-durable-readback proof, a real-browser operator
     workflow, authoritative persisted collection queries, and real durable approval governance.
     Stage 4 proves the first real supervised model/kernel/verifier execution path and restart
     reconciliation; the next verified incomplete task is the bounded generalization described
     below. See
     "System build" below for exactly what's done and what remains — do not re-derive this from the
     git log; the section below is the authoritative summary.

## System build (2026-08-09 → 2026-08-11) — through real supervised execution

Turned the verified L1–10 core + post-core departments into a runnable, operable system, reached a
genuine end-to-end mission flow, then hardened it: a real idempotency defect and a real
champion-decision defect were found and fixed, both with regression evidence. The first twelve
commits were independently full-gate-verified and pushed, `09cc9df` → `86c3d1a`; Stages 1–3
continue that coherent system-build line:

1. **`pnpm dev` is a real, verified boot path.** `scripts/dev.mjs` creates `runtime-data/`
   (gitignored), generates/persists a local dev session token, runs `apps/runtime/src/main.ts` via
   `tsx` (no build step). `tsx` needed esbuild's native postinstall, allowlisted in
   `pnpm-workspace.yaml` (`allowBuilds.esbuild: true`, dev-only).
2. **`project.create`** — the runtime's first real Layer 6 use-case command. Until this,
   `RuntimeService` had exactly one handler, `record.put` (generic KV, proof of mechanism only) —
   none of the 21 use cases were reachable over HTTP. Required realizing `packages/infrastructure`
   has no concrete adapters for the Layer 4 domain ports (only generic `SqliteRecordStore`, etc.)
   — composing those is `apps/runtime`'s job, done in `use-case-infrastructure.ts`. Required
   `passthroughUnitOfWork`: Layer 6 use cases open their own transaction, but
   `ExternalCommandExecutor` already opens one per command (atomic with the idempotency record) and
   `SqliteRuntimeDatabase` forbids nesting — the passthrough runs the use case against the *same*
   transaction instead of opening a new one. `apps/runtime` gained `@v31m4/contracts` + `zod` as
   real dependencies for payload validation/translation at the runtime boundary.
3. **Minimal real operator UI** — `apps/runtime/public/index.html`, served at `GET /`
   (unauthenticated, like `/health`), no framework/build step/second process. Live events use a
   hand-rolled SSE-over-fetch reader (`EventSource` cannot set `Authorization`).
4. **`mission.submit`** — `SqliteMissionRepository` added; preserved that the real use case does
   *not* call `authorizeAction` (unlike `createProject`) rather than inventing a policy check.
5. **`job.start`** — genuinely different shape: `startJob` opens create+queue, then calls the
   production kernel *outside* any transaction (Layer 7 forbids external execution during one),
   then a second running-or-failed transaction. Cannot run inside `ExternalCommandExecutor`'s
   single enclosing transaction at all, with any `UnitOfWorkPort`. Added
   `RuntimeService.registerDirect` (new, additive, doesn't touch existing `register`/`dispatch`)
   for commands that manage their own transactions. Idempotency: `jobId` deterministically derived
   from `(actorId, idempotencyKey)`; `Job.create`'s own `mustNotExist()` rejects a retried create
   with `CONFLICT` *before* the kernel is ever called again, caught and turned into the existing
   job's state. `ReferenceProductionKernel` added (deterministic, no real model/tool execution, no
   supervised child process — no real kernel adapter is installed on this machine).
6. **`job.execute`** — the payoff: drives `run-solver-forge` → `verify-candidates` →
   `select-champion` → `deliver-result` through the real, unmodified Layer 6 use cases, reaching a
   real champion decision + delivery receipt (or an honest no-verified-solution outcome). New
   adapters in `job-execution-infrastructure.ts`: `SqliteCandidateRepository`,
   `SqliteEvidenceRepository`, `LocalWorkspaceManager` (real isolated directories),
   `ReferenceModelGateway` (deterministic, but writes a *real* content-addressed artifact through
   the existing, real `ContentAddressedArtifactStore` — reused, not reimplemented),
   `ReferenceVerifier` (deterministic, but a real check: does the candidate's declared output
   artifact actually exist with real bytes). Two real bugs found via direct reproduction and fixed:
   `SafePath` rejects absolute paths (workspace manager was passing one — fixed to store the
   relative id, real directory created separately); `ArtifactStorePort.write` requires an active
   transaction but `ModelGatewayPort.invoke` has none by contract — `ReferenceModelGateway` now
   opens its own short transaction per write, the same multi-transaction pattern `startJob`
   established. At this point `job.execute` was idempotency-guarded only by the job's own status
   machine (requires `"running"`) — see item 10 below (P0) for why that was insufficient and how it
   was fixed; do not describe this as the current idempotency contract.
7. **Operator UI mission/job/execute panels** — added only once each backend command was real;
   mission submission uses a JSON textarea (a mission has 7 required nested arrays — the smallest
   maintainable real form for that shape) pre-filled from the just-created project; job start/
   execute auto-chain from the IDs the previous step returned.
8. **Restart-recovery test** (`1cc464d`) — `apps/runtime/tests/vertical-slice-restart-recovery.test.ts`
   runs the entire chain (create project → submit mission → start job → execute job to a delivered
   champion receipt), shuts the runtime down, boots a **brand-new runtime instance** against the
   same SQLite file, and confirms every record and the durable event sequence recovered correctly.
9. **Immutable system-build checkpoint** (`97abe98`) —
   `docs/checkpoints/2026-08-09-system-build-checkpoint.md`, a fact-only point-in-time snapshot,
   committed alone, deliberately separate from ordinary documentation maintenance. Do not edit it;
   it records what was true at that commit, not what is true now.
10. **P0: direct-command idempotency repair** (`51d10b4`) — the audit behind the checkpoint found a
    real bug: `job.start`'s deterministic `jobId = hash(actorId, idempotencyKey)` ignores payload
    content, so a retry with the same key but a different `missionId`/`workflowId` silently returned
    the *wrong* job instead of failing. Fixed by having both `job.start` and `job.execute` (both
    `DirectCommandHandler`s, exempt from `ExternalCommandExecutor`'s automatic wrapping) use
    `SqliteIdempotencyStore` explicitly — the same actor+key+commandType+payloadHash contract
    `ExternalCommandExecutor` already enforces for canonical commands. `job.execute` also gained an
    atomic pre-work "claim" transaction (`Job.updateProgress` under `WriteConditions.matchRevision`,
    gated on `currentStage !== "executing"`), closing a genuine concurrency race where two
    concurrent executions of the same job could each run the full solver → verify → champion →
    deliver chain before either failed at the final write. 8 new tests prove same-key/different-
    payload conflict, same-key/different-command-type conflict, concurrent-duplicate collapse,
    restart replay, canonical post-completion replay, and fail-closed behavior on a job left claimed
    by a simulated interrupted execution.
11. **P1: negative-verification path** (`2786ca9`) — proved the path the vertical slice's happy-path
    tests never could: forced verification failure → candidate excluded from champion selection →
    `no_verified_solution` → `deliverResult` not invoked → no delivery receipt → job reaches its
    terminal `"failed"` state → durable, survives restart. Exercised via a test-only composition
    seam (`CompositionOverrides.verifierFactory`, never populated from `RuntimeConfig`/env/HTTP
    input) injecting a deterministic always-fail verifier — `ReferenceVerifier` itself was not made
    random or environment-dependent. Building this test surfaced a real defect (see the "Core
    freeze" correction above): fixed in `select-champion.ts`, not in champion-selection policy.
12. **P1: evidence durable readback by id** (`86c3d1a`) — the restart-recovery test proved project/
    mission/job/candidate/decision/receipt survive a restart, but evidence itself had only ever
    been inferred from a command response, never independently read back by its own id. Extended
    the existing restart-recovery test (no new endpoint — `EvidenceRepositoryPort.getById` and the
    generic `GET /records/:type/:id` route already existed) to read a concrete `evidenceId` back
    before and after restart, confirm every critical field is unchanged, resolve its referenced
    artifact both times via `GET /records/artifact/:id`, and confirm a nonexistent evidence id
    returns 404 both before and after restart rather than fabricating a record.
13. **Stage 1: Browser UI Proof (2026-08-11)** —
    `apps/runtime/tests/operator-ui.browser.test.ts` launches real Playwright Chromium against the
    real `node:http` runtime and a temporary real SQLite database. It proves the public UI loads
    without a credential while the first command fails closed and visibly renders
    `PERMISSION_DENIED`; then a valid bearer token establishes the authenticated SSE stream and the
    browser drives `project.create → mission.submit → job.start → job.execute`. The test asserts the
    displayed project/mission/job identifiers, running/completed state, passing verification,
    champion decision, delivery receipt, and every expected durable event type. It keeps the page
    open while shutting down the runtime, starts a brand-new composition on the same port/database,
    proves the UI reconnects from the last displayed SSE sequence, reads the completed job through
    the browser after restart, and receives exactly the next event without duplicate replay.
    Browser execution exposed one real SSE defect: with an empty log, `writeHead(200)` did not send
    bytes, so browser `fetch()` remained at `connecting…` until the first event. A focused server
    regression first reproduced the timeout; `response.flushHeaders()` in
    `apps/runtime/src/api/server.ts` is the minimal fix and now establishes an authenticated idle
    stream immediately. No other production defect was demonstrated.
14. **Stage 2: List/Query Surface (2026-08-11)** — the runtime now exposes authenticated,
    read-only `POST /queries/mission.list`, `job.list`, `candidate.list`, and `evidence.list`
    operations. Requests use strict `1.0.0` metadata and existing pagination/error conventions;
    mission lists require a project, candidate lists require an agreeing project+mission, job
    lists support their existing project/mission/status filters, and evidence lists use their
    existing required project plus optional job/kind/status/subject filters. Runtime handlers
    validate referenced project/mission/job relationships before calling the existing Layer 4
    repositories, then validate typed response contracts. The real HTTP + real SQLite regression
    proves authenticated results, valid empty collections, invalid input, fail-closed missing
    authentication, cross-project non-disclosure, cursor and offset pagination, restart-stable
    persisted results, and unchanged generic get-by-id reads. The test exposed two real adapter
    defects. First, mission/job/candidate/evidence repositories applied their relationship predicates
    after SQL `LIMIT/OFFSET`, so an unrelated earlier record could create an empty page and the
    unfiltered total leaked the global record count. The shared runtime `listPersistedRecords`
    helper now filters before slicing and derives totals/cursors from only the matching collection.
    Second, the prior `Number.parseInt` cursor parser silently accepted a partially numeric value
    such as `1junk`; cursor parsing now requires an exact non-negative decimal safe integer.
15. **Stage 3: Approval-Flow Proof (2026-08-11)** — strict `1.0.0` approval contracts, the new
    Layer 6 `requestApproval` and `decideApproval` use cases, and the runtime's
    `plugin.register`/`approval.decide`/`approval.list` surface make the existing policy, approval,
    audit, plugin, transaction, and idempotency architecture externally reachable. The unchanged
    `project.create` allow path remains green. `plugin.register` now requires a durable approval;
    no plugin effect occurs while pending or denied. A granted approval must match action,
    resource type/id, requester actor/roles, context, required scopes, status, and inclusive expiry.
    Consumption, plugin registration, and audits commit atomically; a colliding protected write
    rolls all of them back. Real HTTP + real SQLite tests prove auth, malformed/not-found errors,
    grant/deny, every represented mismatch, single use, idempotent completed retry, and pending/
    granted/denied/consumed restart durability. Approval and audit status/query filters now apply
    before pagination, so items, totals, and cursors cannot leak another filter's records.
16. **Stage 3 integrity realignment and three-pass drift audit (2026-08-11)** — a real exploit
    proved the legacy generic `record.put` command could mint a granted approval outside policy and
    authorize a protected plugin write. The command is removed; typed application/runtime commands
    are again the only mutation authority, and a permanent HTTP/SQLite regression proves the bypass
    remains closed. Bounded RED→GREEN repairs also enforce strict SSE/infrastructure cursors and
    runtime environment integers, remove JSON-RPC abort-listener retention, preserve the original
    error after a failing post-commit hook without attempting rollback after commit, and split the
    789-line composition root below the mandatory 500-line limit with a runtime architecture guard.
    The independent forward, reverse, and adversarial drift passes reconcile to
    **ON_TRACK_WITH_APPROVED_DEVIATIONS** after repair. See
    `docs/reviews/stage-3-system-integrity-drift-audit.md`.
17. **Stage 4: Real Supervised Execution (2026-08-11)** — an explicit optional
    `supervised_local` profile now binds the existing model/tool/production-kernel ports and
    gateways to three supervised child processes. A real installed Ollama 0.32.7
    `devstral-small-2:24b` inference produces a bounded candidate artifact; an allowlisted kernel
    checkpoints and applies it exactly once inside a contained job workspace; a separate
    permission-bounded Node verifier derives pass/fail from an actual command exit status and
    persists immutable evidence before the unchanged champion/delivery gate. Default startup and
    `pnpm check` remain hermetic and use the retained reference profile. Real HTTP + SQLite proof
    interrupts after kernel apply, restarts a brand-new runtime on the same database/workspace,
    inspects and resumes the durable checkpoint, and finishes with one model invocation,
    candidate, checkpoint, evidence record, decision, receipt, and kernel apply. The negative path
    applies incorrect code, records failed verifier evidence, selects no champion, and creates no
    delivery. See `docs/reviews/stage-4-real-supervised-execution-proof.md`.
18. **Item 1: General Real Coding Production (2026-08-12)** — the same `supervised_local`
    model/kernel/verifier path now accepts a strict project-owned `.v31m4/build-packet.json` for
    `software.production.v1`, prepares a bounded symlink-free isolated copy, supplies only
    allowed-path context, accepts a closed multi-file change manifest, applies the complete change
    set atomically, and runs the packet's mandatory independent Node check. Real HTTP + SQLite
    regressions prove out-of-scope refusal, verifier-gated no-delivery, idempotent replay, restart
    readback, unrelated/source-repository preservation, and Stage 4 compatibility. The opt-in
    target-host proof passed with installed Ollama 0.32.7 `devstral-small-2:24b`. See
    `docs/reviews/general-coding-production-proof.md`.
19. **Item 2: Autonomous Verified Repair (2026-08-12)** — failed general-software verification
    now composes the existing issue, improvement-policy, reconstructed-candidate, repair,
    checkpoint, and verifier authorities into a bounded loop. Every round preserves parent
    lineage, consumes declared mission/build-packet budgets, applies through the supervised kernel,
    and persists distinct focused/regression evidence. Real HTTP + SQLite regressions prove
    successful repair, exact exhaustion/no delivery, forbidden-path refusal, completed replay, and
    fresh-runtime reconciliation after an applied repair effect. The opt-in installed-Ollama proof
    passed with `devstral-small-2:24b`. See `docs/reviews/autonomous-repair-proof.md`.
20. **Item 3: Measured Model Routing (2026-08-12)** — the supervised model gateway now discovers
    provider-neutral installed profiles from its child adapter, the application layer produces a
    capability/availability/context/budget route, and `job.execute` performs bounded retryable
    escalation while candidate provenance records the actual selected model. Authenticated
    `model.list` exposes the filtered live catalog. A supervised OpenAI-compatible transport is
    loopback-contract-proven without paid calls. The target-host proof passed real inference with
    installed `qwen3:8b` and `qwen2.5-coder:14b`. See
    `docs/reviews/model-routing-proof.md`.
    Initial implementation SHA: `23aecdec3d272a48433757ca15488821cd937ea8`. A post-publication
    RED/GREEN correction makes both the query and router consume the complete bounded provider
    catalog, fails closed on malformed/cyclic pagination, and applies strict canonical decimal
    parsing to the external query cursor.

**Verified, not asserted:** every externally reachable command/query above has real HTTP-request
tests against a real server + real SQLite, including applicable happy path, auth/policy denial,
malformed payload, idempotent retry, not-found, and restart behavior. The original vertical-slice
commands were also smoke-tested through the actual `pnpm dev` process via `curl`.
Stage 1 additionally drives the complete workflow through a real Chromium browser and asserts the
rendered UI plus SSE/restart behavior rather than inferring browser behavior from HTTP bytes.
Stage 2 additionally exercises all four list operations over the real authenticated HTTP boundary,
real repository adapters, and real SQLite before and after a brand-new runtime composition.
Stage 3 additionally exercises approval creation/decision/consumption and the protected plugin
effect through that same real boundary, including rollback and restart.
Stage 4 additionally exercises actual Ollama inference and distinct supervised kernel/verifier
processes; no reference component participates in that explicit profile.
Item 1 additionally exercises a real installed model against a multi-file project-owned software
fixture; no reference component participates, and only independent command evidence gates delivery.
Item 2 additionally exercises two real installed-model inferences around a real failed verifier
command; only the second candidate's independent focused/regression evidence permits delivery.
Item 3 additionally performs live Ollama inventory and real inference with two installed models;
the runtime fallback proof records the actual second model in immutable candidate provenance.

Full workspace gate at `86c3d1a`: `pnpm typecheck` 9/9, `pnpm build` 9/9, `pnpm test` 408 passing /
10 skipped across 89 passing + 2 skipped files, `pnpm lint` 0 errors (9 warnings, 1 info), `pnpm
check` PASS, `git diff --check` clean.

Stage 1 workspace gate re-run on 2026-08-11: focused browser/runtime verification **11/11** across
4 files; `pnpm check` PASS with lint at 0 errors (9 pre-existing warnings, 1 pre-existing info),
typecheck 9/9, and **410 passing / 10 skipped (420 total) across 90 passing + 2 skipped test files**.
The target WSL image lacked three Chromium shared libraries and sudo authentication was
unavailable, so the real browser runs used the Playwright-downloaded Chromium with Ubuntu's
`libnspr4`, `libnss3`, and `libasound2t64` extracted reversibly under `/tmp` and supplied through
`LD_LIBRARY_PATH`; no system packages or repository binaries were installed.

Stage 2 workspace gate re-run on 2026-08-11: focused Stage 2 contract/runtime verification
**10/10 across 3 files**; complete owning contract/runtime regression **83/83 across 21 files**;
`pnpm check` PASS with lint at 0 errors (9 pre-existing warnings, 1 pre-existing info), typecheck
9/9, and **413 passing / 10 skipped (423 total) across 91 passing + 2 skipped test files**.
`git diff --check` is required again immediately before the Stage 2 commit.

Stage 3 focused verification: approval/contracts/application/runtime plus governance pagination
**98/98 across 30 files**; post-repair cross-layer integrity selection **195/195 across 46 files**.
Stage 3 final workspace gate: `pnpm check` PASS with lint at 0 errors (9 existing warnings, 1
existing info), typecheck 9/9, and **436 passing / 10 skipped (446 total) across 97 passing + 2
skipped test files (99 total)**. The first unchanged gate attempt reached the browser test but the
host omitted `libnspr4`; the successful run used the same reversible Stage 1 libraries already
extracted under `/tmp` through `LD_LIBRARY_PATH`. No system or repository dependency was installed.
`git diff --check` and final static/diff review are recorded in the Stage 3 audit.

Stage 4 final workspace gate: focused Stage 4/owning-layer verification **52/52 across 11 files**;
post-reconciliation runtime selection **19/19 across 4 files**; actual installed-Ollama acceptance
**1/1** (final rerun 22.07 seconds); `pnpm check` PASS with lint at 0 errors (9 existing warnings,
1 existing info), typecheck 9/9, and **453 passing / 11 skipped (464 total) across 100 passing + 3
skipped files (103 total)**. The additional default skip is the explicitly opt-in actual-Ollama
test, which was run separately and passed. Source-size/dependency/explicit-`any` guards pass;
`job-command-surface.ts` is 498 lines.

Item 1 final workspace gate: focused contract/runtime/adapter/architecture verification **28
passing / 1 opt-in skip across 8 files**; actual installed-Ollama general-production acceptance
**1 passing / 3 intentionally filtered skips**; `pnpm check` PASS with lint at 0 errors (9
existing warnings, 1 existing info), typecheck 9/9, and **472 passing / 12 skipped (484 total)
across 104 passing + 3 skipped test files (107 total)**. The successful browser-inclusive gate
used the same reversible libraries under `/tmp` through `LD_LIBRARY_PATH`; no system or repository
binary was installed.

Item 2 final workspace gate: focused repair/runtime/application/process/architecture verification
**41 passing / 2 opt-in skips across 12 files**; actual installed-Ollama repair acceptance **1
passing / 6 intentionally filtered skips** (43.02 seconds); Item 1 installed-model regression **1
passing / 6 intentionally filtered skips** (9.11 seconds); `pnpm check` PASS with lint at 0 errors
(9 existing warnings, 1 existing info), typecheck 9/9, and **476 passing / 13 skipped (489 total)
across 105 passing + 3 skipped test files (108 total)**. The browser-inclusive gate used the same
reversible `/tmp` libraries; no system or repository binary was installed.

Item 3 corrected focused gate: routing/runtime/adapter/application verification **43 passing / 1
opt-in skip across 7 passing + 1 skipped files**; corrected installed-Ollama routing acceptance **1
passing** with `qwen3:8b` and `qwen2.5-coder:14b` (8.25 seconds); corrected `pnpm check` PASS with
lint at 0 errors (9 existing warnings, 1 existing info), typecheck 9/9, and **490 passing / 14
skipped (504 total) across 107 passing + 4 skipped test files (111 total)**. Dependency,
source-size, and explicit-`any` guards passed in the complete suite; the browser-inclusive gate used
the same reversible `/tmp` libraries.

**Not yet done — next verified incomplete task after Item 3:**

- **General governed tool execution** — Item 4 must expose closed filesystem/Git/command/browser
  operations through `ToolGatewayPort`, with contained working directories, policy, bounded process
  resources, authoritative artifacts/evidence, and restart-safe failure behavior.
- **Video `ShotGenerationAdapter`** (needs ComfyUI — confirmed installed at
  `/home/xxthatguyxx/ComfyUI`, WSL-native, not yet run/exercised) and **Game's Summer-backed real
  adapters** (needs Summer, not installed) — unrelated to the system-build program above, tracked
  independently in the Video/Game sections.

## Session-start rule

Read this file first, verify branch/HEAD/status/diff, then continue from the latest verified incomplete task. Do not rescan the entire repository unless evidence requires it.
