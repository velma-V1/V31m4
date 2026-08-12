# Stage 3 System Integrity and Three-Pass Drift Audit

## Baseline

- Repository: `velma-V1/V31m4`, branch `main`.
- Remote Stage 2 baseline: `9b4665298edf6befe61ecb25a5e93a10e3dec870`.
- Original-intent authorities: `docs/repository-specification.md`, `docs/architecture.md`, and
  `docs/superpowers/plans/2026-08-07-layers-6-10-canonical.md`.
- Current-truth inputs: source, executable tests, `docs/current-state.md`, both repository maps,
  applicable ADRs, and the Stage 1–3 plans/evidence.
- Audit method: targeted source-to-sink review plus adversarial RED→GREEN tests. Current-state
  documents were checked against source and execution rather than treated as self-proving.
- Constraint: repository policy for this run prohibited delegated subagents. The security review
  therefore used independent sequential risk passes by the primary agent; it does not claim the
  variance reduction of an independent-worker security baseline.

## Stage3Completion

Stage 3 makes the existing governance architecture real through the smallest coherent protected
path. `project.create` remains the unchanged policy `allow` proof. `plugin.register` now evaluates
the existing `PolicyEnginePort`; the production rule returns `require_approval`. A request without
an approval durably creates a pending `ApprovalRequest` and audit record without registering the
plugin. Authenticated `approval.decide` grants or denies a pending request, and `approval.list`
reads authoritative SQLite state.

Approval-backed registration re-evaluates current policy and validates status, inclusive expiry,
action, resource type/id, requester actor and roles, exact security context, and all required
scopes. Consumption, `approval.consume` audit, plugin registration, and plugin audit share one
SQLite transaction. A colliding plugin write rolls the consumption and audits back. The external
command's idempotency record commits with the successful effect, so an identical completed retry
returns the prior result without consuming twice. Pending, granted, denied, and consumed states are
restart-proven through brand-new runtime compositions.

Strict `1.0.0` contracts cover approval records, governed registration, decisions, and listing.
Malformed input, unknown fields, inconsistent decision metadata, duplicate records/scopes,
unauthenticated decisions, nonexistent approvals, denials, expiry, consumption, and every
represented mismatch fail through established error conventions. Real HTTP plus real SQLite tests
prove the externally visible lifecycle; application tests independently prove the invariants.

## ConfirmedDefects

| Severity | Evidence and root cause | Root-cause fix | Permanent regression |
|---|---|---|---|
| HIGH | The legacy authenticated `record.put` command could write `record_type=approval`, mint a forged granted approval, and authorize `plugin.register`. It bypassed Layer 6, policy, and the approval decision lifecycle, creating a competing state authority. The exploit returned 200 for both forged write and protected effect before repair. | Removed the generic state-changing command. Authoritative mutations now enter typed application/runtime surfaces. Existing runtime hardening tests were retargeted to `project.create`. | `apps/runtime/tests/authoritative-write-boundary.test.ts` proves `record.put` is unsupported, the forged approval cannot authorize an effect, and no plugin appears. |
| MEDIUM | `SqliteApprovalStore.list(status, ...)` and `SqliteAuditStore.list(query)` paginated before filtering. Interleaved unrelated records produced wrong items, totals, and cursors and could reveal cross-filter cardinality. | Both use the existing `listPersistedRecords` filter-before-slice path. | `apps/runtime/tests/governance-store-pagination.test.ts`. |
| MEDIUM | SSE and four infrastructure list implementations used partial numeric coercion, accepting cursors such as `1junk`; the SSE surface also accepted unsafe integers. | Exact canonical nonnegative safe-integer parsing; one private infrastructure helper removes sibling divergence. | `runtime-server`, `gateways`, `plugin-registry`, and `content-addressed-artifacts` tests. |
| MEDIUM | Runtime environment integers used `parseInt`, silently accepting values such as `8787junk`, `12items`, and noncanonical `01`. | Startup now parses canonical nonnegative safe integers before range validation. | `apps/runtime/tests/runtime-config.test.ts`. |
| MEDIUM | If an `afterCommit` hook threw, `SqliteRuntimeDatabase` entered its rollback catch after SQLite had committed, masking the original error with “no transaction is active.” | Transaction work/commit errors are handled separately from post-commit hooks; rollback is attempted only before a successful commit and the serialization lock is always released. | `packages/infrastructure/tests/sqlite-core.test.ts` proves the original hook error, committed record, absent rollback hook, and continued database usability. |
| MEDIUM | `JsonRpcClient` retained abort listeners after successful, timed-out, and process-failed calls, accumulating listeners on reused signals. | Every pending call owns cleanup invoked on resolve, timeout, cancellation, and reject-all paths. | `packages/infrastructure/tests/json-rpc.test.ts` asserts zero retained listeners after completion and timeout. |
| MEDIUM | `apps/runtime/src/composition-root.ts` had grown to 789 lines, above the mandatory 500-line architecture limit, and runtime lacked an executable source-size/explicit-`any` guard. | Extracted direct `job.start`/`job.execute` composition into `job-command-surface.ts` without changing application behavior. | `apps/runtime/tests/architecture.test.ts`; largest runtime source is now below 500 lines and explicit `any` is rejected. |

All confirmed HIGH and bounded MEDIUM findings were repaired. The cursor finding covers five
concrete sites; the pagination finding covers two stores.

## RejectedDefectCandidates

- **Approval mismatch HTTP status:** an initial 400 was traced to a test-only plugin identifier
  that violated the existing contract. With a valid identifier, wrong action, resource type/id,
  requester, scope, context, and expiry all return the established approval-required failure and
  perform no protected effect. No production change was made for the bad fixture.
- **Authenticated generic reads:** `/records/:type/:id` can read persisted records but cannot
  mutate them. Under the documented loopback, configured-session, single-runtime threat model this
  is an established authenticated read surface, not an approval bypass. State-changing approval
  operations remain operator-policy protected.
- **External execution bypass:** direct process/network calls found in Video Production are inside
  that removable department's typed adapter implementations, not application/domain code or direct
  runtime persistence access. Core runtime imports no department.
- **Model self-certification:** the reference model and reference verifier are separate gateway
  implementations; champion/delivery still consumes independent verification results and evidence.
  Their limited realism is a capability gap, not evidence that model claims certify themselves.
- **Operator-UI HTML rendering:** displayed values originate from the same authenticated local
  operator/runtime boundary. No privilege gain or cross-user attack path was demonstrated, so no
  UI redesign was introduced in this bounded stage.

## KnownIntentionalLimitations

- `ReferenceModelGateway`, `ReferenceVerifier`, and `ReferenceProductionKernel` prove orchestration
  only. They are not real autonomous production capability.
- A crashed `job.execute` after its durable execution claim remains fail-closed as `executing`; an
  externally reachable checkpoint/resume/reconciliation workflow is not yet wired.
- Expired approvals fail closed at use time. No background process materializes `expired` as a new
  stored status.
- Outbox retention/pruning is intentionally absent; replay already fails explicitly with
  `refresh_required` when retained history is insufficient.
- Video shot generation and Game Summer adapters remain unimplemented external integrations.
- CLI, desktop, and laboratories remain outside the implemented boundary.

## DriftPass1ForwardTraceability

This pass started only from original requirements and traced forward. It did not use later
implementation structure as its organizing frame.

| Original requirement/property | Current implementation and executable evidence | Status |
|---|---|---|
| Local-first system | Loopback-only validated runtime, local SQLite/artifacts/workspaces, authenticated browser/runtime tests | ALIGNED |
| Modular monolith / Clean Architecture | Package dependency tests; domain/application boundaries; one composition root | ALIGNED |
| Authoritative runtime; UI non-authority | Typed runtime commands/queries and durable readback; browser only submits/displays; generic write bypass removed | ALIGNED |
| Durable projects, missions, and jobs | SQLite repositories, CAS writes, restart tests | ALIGNED |
| Atomic transactions and failure safety | Serialized UoW, rollback suites, outbox/idempotency atomicity, approval rollback and post-commit regression | ALIGNED |
| Idempotent external commands | Actor/key/type/payload-hash records, concurrency/restart/replay tests | ALIGNED |
| Durable events and resumable operation | Transactional outbox, replay/live handoff, SSE cursor/restart/gap/slow-client tests | ALIGNED_WITH_APPROVED_DEVIATION |
| Checkpoint recovery | Verified checkpoint/resume use cases and domain rules exist; operator runtime does not yet expose full resume/reconciliation | PARTIAL |
| Isolated production workspaces | `WorkspaceManagerPort`, local isolated copies, solver/practice cleanup tests, path containment | ALIGNED |
| Replaceable model/tool/kernel boundaries | Provider-neutral ports plus supervised gateways and typed JSON-RPC/process infrastructure | ALIGNED |
| Real model/tool/kernel execution | Extension points exist, but system-build composition still selects reference implementations | DEFERRED_BY_EXPLICIT_PLAN |
| Removable departments/plugins | Generic department host, independent Video/Game plugins, absence/removal integration tests | ALIGNED |
| Policy and approval governance | Real durable Stage 3 lifecycle, exact matching, single use, audit, auth, restart and rollback tests | ALIGNED |
| Immutable evidence/checkpoints | Append-only repositories and domain invariants; mutation conflicts and restart evidence tests | ALIGNED |
| Independent verification | Verifier port and separate verifier execution; mandatory failures block champion/delivery | ALIGNED |
| Candidate/repair/champion loop | Layer 6 solver, verify, repair, champion and delivery use cases plus negative-verification tests | ALIGNED |
| Verified delivery | Champion and delivery invariants require evidence and complete mandatory/requirement coverage | ALIGNED |
| Controlled learning/capability improvement | Quarantine, held-out verification, promotion, capability, practice, and avatar use cases exist; not runtime-wired | PARTIAL |
| Idle practice isolation | Domain/services/use cases and workspace cleanup exist; no operator/runtime scheduling surface | DEFERRED_BY_EXPLICIT_PLAN |
| Typed external boundaries | Strict Zod contracts, JSON-RPC versioning/framing, provider-neutral ports, malformed-input tests | ALIGNED |
| No external-tool/provider bypass | Static dependency searches/tests and supervisor/gateway boundaries; department tools stay adapter-local | ALIGNED |
| Optional integration independence | Core boots/tests without departments, ffmpeg/Ollama/ComfyUI/Summer | ALIGNED |
| Autonomous production extensibility | Necessary ports, durable state, evidence, governance, process supervision and plugins exist; real bound executors are still missing | PARTIAL |

The named Fastify/WebSocket blueprint was intentionally implemented as `node:http` plus SSE under
ADR 0009. The required property—authenticated typed local transport with ordered durable replay,
resume, refresh refusal, and bounded clients—is preserved and executable, so this is
`ALIGNED_WITH_APPROVED_DEVIATION`, not harmful drift.

## DriftPass2ReverseTraceability

This pass reset the forward classifications, started from present subsystems, and asked why each
exists.

| Current subsystem/change | Backward justification | Reverse verdict |
|---|---|---|
| Immutable domain and strict contracts | Original domain/typed-boundary invariants | Necessary core |
| SQLite records/UoW/outbox/idempotency/artifacts | Durable projects/jobs, failure atomicity, evidence authority, recovery | Necessary core |
| Process supervisor, JSON-RPC, gateways, path policy | Replaceable governed model/tool/kernel execution and isolation | Necessary core |
| Runtime command/query/event surface | Sole state authority and usable local operator boundary | Necessary support |
| Minimal browser UI and Stage 1 proof | Original operator interface with non-authoritative state; proves the boundary rather than adding a second state store | Necessary support |
| Stage 2 list queries | Authoritative observation of missions/jobs/candidates/evidence; required for an operable production system | Necessary support; stop short of generic CRUD |
| Stage 3 approval surface | Original Approval and Policy Engine made externally usable through existing ports/use case | Necessary core completion |
| Reference execution adapters | Deterministic orchestration/test scaffold, explicitly documented as reference | Approved temporary scaffold; risk only if mislabeled real |
| Video/Game departments | Original removable first-party plugin targets, kept outside core | Approved post-core extensions |
| `node:http` + SSE | ADR-approved replacement preserving runtime/event properties | Approved deviation |
| Legacy `record.put` | Once a runtime proof helper; after typed commands it bypassed application authority and had no valid original-goal justification | Orphan/harmful drift; removed |
| Oversized composition root | Accreted wiring obscured review and violated the frozen source limit | Harmful structural drift; split at existing runtime boundary |
| Shared strict pagination parser | Prevents repeated boundary bugs without creating a public framework | Necessary private support |

No duplicate persistence, authorization, approval, event, or UI authority remains after repair.
Stages 1–3 increased API/test surface only where it made the already-planned runtime observable,
operable, and governed. Further generic API growth would be scope accretion; the critical path must
now move to real execution capability.

## DriftPass3IndependentAdversarialReview

This pass did not begin with either matrix. It asked whether continuing the present trajectory
would still converge on the intended autonomous production operating system.

The strongest adverse case is credible: infrastructure and proof surfaces are presently more
mature than autonomous capability. The shipped runtime can durably accept a mission and run a
reference solver/verifier/kernel chain, but it cannot yet supervise a real model, perform a real
independent build/test verification plan, or drive a real production kernel. Calling the current
reference chain “autonomous production” would be false, and adding more generic CRUD/UI surfaces
next would turn necessary foundations into backend-project drift.

That risk has not yet become a competing architecture. Real integrations can enter through the
existing `ModelGatewayPort`, `ToolGatewayPort`, `VerifierPort`, `ProductionKernelPort`, supervised
process/JSON-RPC infrastructure, `PathPolicy`, secret leases, isolated workspaces, and composition
root. Evidence and champion selection remain independent of model confidence. Core still imports no
department, departments remain removable, and the UI does not own truth. Learning/practice and
promotion boundaries remain structurally possible because their domain/services/use cases are
already isolated from production authority.

Stages 1–3 were on the critical path: they proved a human can operate the real durable workflow,
inspect authoritative results, and govern a protected extension. They become a distraction only if
continued after these minimum proofs. The true blockers are now (1) one real supervised model
binding, (2) a real independent verifier plan executing deterministic checks, (3) a real production
kernel/tool path with checkpoint/restart reconciliation, and only then department-specific real
adapters. Controlled learning and idle practice should remain later until real production evidence
exists to learn from.

## ThreePassReconciliation

- Pass 1 calls model/tool/kernel boundaries `ALIGNED` while Pass 3 warns of missing autonomous
  capability. There is no contradiction: the architecture is aligned; the real adapter composition
  is explicitly incomplete.
- Pass 1 accepts Stage 2 queries and Pass 3 warns about backend drift. Pass 2 resolves this: the
  four relationship-scoped queries are necessary authoritative observation, but additional generic
  surface expansion is not the next critical-path work.
- Pass 1 initially assesses runtime authority as aligned; Pass 2 identifies `record.put` as an
  orphan, and the exploit proves Pass 1 would have been incomplete without reverse traceability.
  The repaired tree—not the starting tree—earns `ALIGNED`.
- Pass 1 accepts the runtime transport deviation; Passes 2 and 3 agree because replay/resume and
  non-authoritative UI properties are preserved by executable evidence.
- Pass 3's “infrastructure ahead of capability” concern is a roadmap risk, not proof of harmful
  architecture. It is resolved by correcting the next stage toward real supervised execution.

Overall trajectory before repair: **AT_RISK**. The generic write bypass silently violated the
application/runtime authority property, and runtime composition growth lacked the specified guard.

Overall trajectory after repair: **ON_TRACK_WITH_APPROVED_DEVIATIONS**. No major original property
is silently lost, no competing state authority remains, and the extension points needed for real
autonomous production are intact. This verdict depends on the roadmap pivoting now to real execution
rather than more generic API/UI infrastructure.

## HarmfulDriftFound

1. `record.put` had become a parallel mutable authority outside typed Layer 6 governance. It was
   security-reachable and exploited approval state, so it was harmful rather than merely obsolete.
2. Runtime composition exceeded the mandatory source-size ceiling without an owning architecture
   test, increasing the chance that transport, reference orchestration, and composition would merge
   into an unreviewable application authority.

## DriftRepairsApplied

- Removed the generic state-changing command and converted its valid invariant tests to typed
  `project.create` behavior.
- Added a permanent exploit regression at the real authenticated HTTP/SQLite boundary.
- Extracted the direct job command wiring into one runtime-owned module and added runtime-wide
  source-size/explicit-`any` enforcement.
- Corrected current truth and next-stage priority; historical ledgers remain historical rather than
  being rewritten.

## ApprovedDeviations

- `node:http` + SSE replaces frozen-blueprint Fastify + WebSocket under ADR 0009 while preserving
  typed authentication, replay, resume, refresh refusal, and slow-client bounds.
- SQLite is accessed through `node:sqlite` rather than requiring the originally named Drizzle tool;
  transaction, migration, revision, durability, and port properties are preserved.
- TypeScript/runtime tool versions differ from frozen illustrative versions where the current
  workspace toolchain is stricter and all architecture contracts remain enforced.

These are system-property-preserving substitutions. Reference adapters are not an approved
substitution for real production capability; they remain explicitly temporary evidence scaffolds.

## MissingOriginalCapabilities

- Real supervised model inference composed into `job.execute`.
- Real independent verifier execution (build/test/lint/security or equivalent deterministic plan),
  not artifact-presence-only reference verification.
- Real production-kernel/tool execution plus durable checkpoint/reconciliation for interrupted work.
- Runtime reachability for repair loops, checkpoints/resume, learning promotion, capability updates,
  idle practice, and avatar progression after real evidence exists.
- Additional removable production departments and workflows from the original catalog.
- CLI/desktop/laboratory interfaces where they provide value without becoming state authorities.
- Video ComfyUI shot generation and Game Summer-backed adapters.

## OrphanOrScopeAccretionFindings

The only confirmed orphan with harmful behavior was `record.put`; it is removed. No duplicate
approval store, policy engine, event store, persistence authority, or UI state authority was found.
The current Stage 1–3 surfaces trace to necessary operator, observation, and governance properties.
The principal future scope-accretion risk is further generic API/UI work before real supervised
execution.

## ExternalDependencyBlockers

No external dependency blocked Stage 3 or the integrity repairs. Real future capability depends on
selecting/installing a production model adapter and verifier/kernel executors. ComfyUI is reportedly
installed but not validated for V31M4; Summer is not installed. Neither is required for core startup
or this stage.

## TrajectoryBeforeRepair

**AT_RISK** — the intended architecture remained visible, but an externally reachable generic
write had become a competing authority and could forge governance state.

## TrajectoryAfterRepair

**ON_TRACK_WITH_APPROVED_DEVIATIONS** — foundational architecture and original system properties
remain intact; bounded harmful drift is removed. Product capability is still partial and must now
advance through real gateways rather than more proof-only surfaces.

## CorrectCriticalPath

1. Bind one real supervised model through the existing gateway/process/RPC contracts.
2. Bind a genuinely independent verifier that executes deterministic checks and emits immutable
   evidence.
3. Bind a real production-kernel/tool path with isolated workspaces and checkpoint/restart
   reconciliation.
4. Prove the mission-to-verified-delivery workflow across restart and failure with those real
   boundaries.
5. Only then advance department-specific adapters and evidence-backed learning/practice reachability.

## RecommendedNextStage

**Stage 4 — Real supervised execution proof:** replace the system-build reference model,
artifact-presence verifier, and reference production kernel along one bounded end-to-end path using
the existing typed ports, supervisors, isolated workspaces, policy, and evidence authority. Include
failure, cancellation, timeout, restart/checkpoint, independent verification, and no-reference-
capability-mislabeling proofs. Do not broaden generic CRUD/UI surface.

## VerificationEvidence

- Stage 3 checkpoint: focused contracts/application/runtime/infrastructure selection, 98/98 across
  30 files; affected package typechecks and lint clean.
- Integrity selection after repairs: 195/195 across 46 files, covering domain state/evidence,
  Layer 6 use cases, SQLite/outbox/idempotency/artifacts, policy/approval, supervised processes and
  gateways, path isolation, SSE/recovery, runtime hardening, and dependency/source-size guards.
- Focused RED evidence is preserved in each regression's commit history and test purpose: the
  forged approval produced a protected effect; governance pages filtered after slicing; malformed
  cursors/config values were accepted; post-commit errors were masked; abort listeners remained;
  and runtime composition had 789 lines before extraction.
- Final workspace gate: `pnpm check` PASS; lint 0 errors (9 existing warnings, 1 existing info),
  typecheck 9/9, and 436 passing / 10 skipped across 97 passing + 2 skipped test files. The
  successful browser-inclusive run used the already-extracted reversible Stage 1 libraries under
  `/tmp` via `LD_LIBRARY_PATH`; no system or repository dependency was installed.
