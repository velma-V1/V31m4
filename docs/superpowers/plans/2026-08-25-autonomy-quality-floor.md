# V31M4 Autonomy Quality-Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `V31M4-AUTONOMY-001` so V31M4 can autonomously investigate, act, verify, repair, recover, and abstain through governed local tools while preserving a calibrated quality floor.

**Architecture:** Extend the existing V31M4 domain/application/infrastructure/runtime authority instead of installing a second agent framework. New authoritative state follows the existing domain -> application port/use-case -> runtime adapter -> `SqliteRecordStore` pattern; external runtimes/indexers remain replaceable infrastructure adapters. Durable task state, execution reality, project intelligence, skills, memory, quality calibration, sandboxing, and self-improvement stay under V31M4 authority.

**Tech Stack:** TypeScript 7, Node >=22, pnpm 11.17, Vitest 4, SQLite/`SqliteRecordStore`, existing supervised process/JSON-RPC infrastructure, existing model/tool/verifier gateways, Ollama, Tree-sitter, SCIP/scip-typescript, ast-grep, Git, Playwright, MCP TypeScript SDK, optional Qwen3 embedding sidecar, sandbox backend selected by target-host bake-off.

**Spec:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture.md`

## Global Constraints

- Preserve all existing public V31M4 v1 semantics and dependency direction.
- No second orchestrator, state database, policy authority, evidence authority, memory authority, or acceptance authority.
- Models never certify their own work; deterministic evidence outranks neural judgment.
- No trusted production path may depend on a floating `latest` version.
- Optional embedding, reranking, sandbox-server, MCP, browser, Video, and Game services remain optional and cannot break hermetic startup.
- Qwen3.8-27B Q4_K_M is the initial local acceptance model only; no domain/application type may depend on that model name.
- External work never runs inside an authoritative SQLite transaction.
- Ambiguous post-crash effects are reconciled before retry.
- Target <400 source lines; never exceed the existing 500-line source guard without a separately documented exception.
- TDD is mandatory for every task: failing focused test -> minimal implementation -> focused pass -> owning-layer pass -> `pnpm check` -> evidence/docs -> commit.
- Execute exactly one task at a time. A later task cannot start until the current hard gate is green and reviewed.

## Locked ownership map

```text
packages/domain/src/entities/
  task-capsule.ts
  execution-ledger-entry.ts
  skill-profile.ts
  memory-record.ts

packages/contracts/src/
  task-capsules.schemas.ts
  skills.schemas.ts
  memory.schemas.ts

packages/application/src/ports/
  task-capsule-repository.port.ts
  execution-ledger-repository.port.ts
  sandbox.port.ts
  project-intelligence.port.ts
  skill-registry.port.ts
  memory-repository.port.ts
  benchmark-runner.port.ts

packages/application/src/services/
  task-transition-policy.ts
  evidence-precondition.ts
  project-retrieval-fusion.ts
  skill-selector.ts
  memory-router.ts
  capability-confidence.ts
  quality-floor-controller.ts

packages/application/src/use-cases/
  create-task-capsule.ts
  propose-task-transition.ts
  append-execution-ledger.ts
  reconcile-execution-effect.ts
  select-next-task.ts
  audit-task-result.ts
  register-skill.ts
  promote-skill.ts
  record-memory.ts
  retrieve-memory.ts

packages/infrastructure/src/sandbox/
  sandbox-supervisor.ts
  direct-docker-sandbox.ts
  opensandbox-adapter.ts
  openshell-adapter.ts

packages/infrastructure/src/project-intelligence/
  tree-sitter-index.ts
  scip-index.ts
  ast-grep-index.ts
  git-project-facts.ts
  lexical-index.ts
  semantic-index.ts
  project-intelligence-adapter.ts

packages/infrastructure/src/skills/
  agent-skills-loader.ts

packages/infrastructure/src/memory/
  semantic-memory-index.ts

packages/infrastructure/src/interoperability/
  mcp-tool-adapter.ts

apps/runtime/src/autonomy/
  autonomy-composition.ts
  autonomy-state-infrastructure.ts
  semantic-tool-catalog.ts
  task-manager.ts
  task-executor.ts
  task-auditor.ts
  effect-reconciler.ts
  retrieval-context-source.ts
  skill-context-source.ts
  memory-context-source.ts
  quality-floor-runtime.ts

apps/runtime/tests/autonomy/
  autonomy-program-invariants.test.ts
  governed-aci.test.ts
  task-capsule.test.ts
  execution-ledger.test.ts
  role-isolation.test.ts
  evidence-gating.test.ts
  project-intelligence.test.ts
  skill-runtime.test.ts
  memory-router.test.ts
  quality-floor.test.ts

scripts/
  prove-autonomy-phase1-real.mjs
  prove-project-intelligence-real.mjs
  prove-sandbox-backends-real.mjs
  prove-autonomy-quality-floor-real.mjs
```

### Persistence rule

Do **not** invent migration files: the repository currently has one generic `records` table and `SqliteRecordStore`. New autonomy repositories should reuse it unless measured requirements prove the generic store insufficient.

- Mutable heads/profiles use `SqliteRecordStore.save(..., WriteCondition, transaction)`.
- Immutable records use unique IDs and `SqliteRecordStore.append(...)`.
- Task Capsule history uses immutable revision records (`task_capsule_revision`) plus one mutable head record (`task_capsule_head`) in the same transaction. Never overwrite a historical revision.
- Execution Ledger entries are immutable `execution_ledger_entry` records.
- Skill profiles and memory records use the same existing store and current transaction rules.
- Only if a later measured query requirement cannot be satisfied safely through the generic store may `packages/infrastructure/src/database/schema.ts` and `SqliteRuntimeDatabase.#migrate()` change; that requires its own migration/backup/restore regression and architecture note.

---

## Task 0 — Freeze the Program Baseline

**Files:**
- Create: `docs/reviews/autonomy-baseline.md`
- Create: `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`
- Modify: `docs/current-state.md`

**Produces:** exact pre-autonomy baseline and named acceptance fixtures.

- [ ] Run:
```bash
git rev-parse HEAD
node --version
pnpm --version
pnpm check
```
Record every output in `docs/reviews/autonomy-baseline.md`. Any failure is a blocker until explained.
- [ ] Create `autonomy-program-invariants.test.ts` with these exact Phase-0 inventory entries:
```ts
it.todo("no model-direct tool bypass");
it.todo("task state survives restart without chat history");
it.todo("ambiguous effect is reconciled before retry");
it.todo("auditor cannot mutate candidate");
it.todo("stale memory is not injected as current fact");
it.todo("deterministic failure cannot be overridden by neural verifier");
it.todo("quality floor abstains outside calibrated envelope");
```
Each later task replaces its relevant `todo` with executable coverage.
- [ ] Update `docs/current-state.md` to say `V31M4-AUTONOMY-001` is approved/planned, not implemented.
- [ ] Verify and commit:
```bash
pnpm check
git diff --check
git add -A
git commit -m "test: freeze autonomy program baseline"
```

**Hard gate:** clean explained baseline and no false implementation claim.

---

## Task 1 — Governed Semantic ACI + `SandboxPort`

**Files:**
- Create: `packages/application/src/ports/sandbox.port.ts`
- Modify: `packages/application/src/ports/tool-gateway.port.ts`
- Modify: `packages/application/src/use-cases/invoke-tool.ts`
- Create: `packages/infrastructure/src/sandbox/direct-docker-sandbox.ts`
- Create: `packages/infrastructure/src/sandbox/sandbox-supervisor.ts`
- Create: `apps/runtime/src/autonomy/semantic-tool-catalog.ts`
- Create: `packages/application/tests/sandbox-port.test.ts`
- Modify/Create focused invoke-tool tests under `packages/application/tests/use-cases/`
- Create: `apps/runtime/tests/autonomy/governed-aci.test.ts`
- Create: `scripts/prove-autonomy-phase1-real.mjs`

**Produces:**
```ts
export interface SandboxExecutionRequest {
  readonly sandboxId: string;
  readonly jobId: JobId;
  readonly workspaceId: string;
  readonly operation: string;
  readonly parameters: ApplicationJsonObject;
  readonly resourceBudget: ResourceBudget;
}
export interface SandboxExecutionResult {
  readonly sandboxId: string;
  readonly status: "completed" | "failed" | "cancelled" | "unknown";
  readonly outputArtifactIds: readonly ArtifactId[];
  readonly logArtifactIds: readonly ArtifactId[];
  readonly metadata: ApplicationJsonObject;
}
export interface SandboxPort {
  prepare(request: SandboxExecutionRequest, context: OperationContext): Promise<void>;
  execute(request: SandboxExecutionRequest, context: OperationContext): Promise<SandboxExecutionResult>;
  inspect(sandboxId: string, context: OperationContext): Promise<ApplicationJsonObject>;
  cancel(sandboxId: string, context: OperationContext): Promise<void>;
  destroy(sandboxId: string, context: OperationContext): Promise<void>;
}
```
Agent-facing IDs are exactly: `repo.map_task`, `repo.search`, `repo.symbol`, `repo.references`, `repo.impact`, `repo.history`, `code.inspect`, `code.patch`, `build.check`, `test.targeted`, `test.regression`, `debug.reproduce`, `failure.explain`, `git.status`, `git.diff`, `git.history`, `git.worktree`, `command.run`, `browser.inspect`, `browser.verify`.

- [ ] First write failing tests proving effectful semantic tools require job identity, policy authorization, resource budget, sandbox handle, cancellation semantics, and artifact/log provenance; prove no model path reaches shell/browser/sandbox directly.
- [ ] Run focused failure:
```bash
pnpm vitest run packages/application/tests/sandbox-port.test.ts packages/application/tests/use-cases apps/runtime/tests/autonomy/governed-aci.test.ts
```
- [ ] Implement `SandboxPort`, semantic catalog, and a minimal hardened direct-Docker/reference adapter. Network is denied by default, no Docker socket is mounted into the agent sandbox, no ambient host secrets are inherited, and resource limits are explicit.
- [ ] Implement the runtime composition without making Docker required for `hermetic_reference` startup.
- [ ] Add cancellation, timeout, child/orphan, resource-limit, and unknown-effect tests.
- [ ] `prove-autonomy-phase1-real.mjs` must call V31M4 create -> execute deterministic command -> inspect -> destroy, never Docker directly.
- [ ] Replace `no model-direct tool bypass` todo with executable regression.
- [ ] Verify:
```bash
pnpm vitest run packages/application/tests/sandbox-port.test.ts packages/application/tests/use-cases apps/runtime/tests/autonomy/governed-aci.test.ts
pnpm check
git diff --check
git add -A
git commit -m "feat: add governed semantic tool and sandbox boundary"
```

**Hard gate:** typed/policy-gated/evidenced/cancellable/sandboxed effects and no model-direct bypass.

---

## Task 2 — Task Capsule + Checked State Machine + Task DAG

**Files:**
- Create: `packages/domain/src/entities/task-capsule.ts`
- Create: `packages/contracts/src/task-capsules.schemas.ts`
- Create: `packages/application/src/ports/task-capsule-repository.port.ts`
- Create: `packages/application/src/services/task-transition-policy.ts`
- Create: `packages/application/src/use-cases/create-task-capsule.ts`
- Create: `packages/application/src/use-cases/propose-task-transition.ts`
- Create: `apps/runtime/src/autonomy/autonomy-state-infrastructure.ts`
- Create: `apps/runtime/src/autonomy/task-manager.ts`
- Create: `packages/domain/tests/task-capsule.test.ts`
- Create: contract/application focused tests following existing test-directory conventions
- Create: `apps/runtime/tests/autonomy/task-capsule.test.ts`

**Produces:**
```ts
export type TaskPhase = "investigate" | "plan" | "execute" | "verify" | "repair" | "complete" | "blocked";
export interface TaskTransitionProposal {
  readonly capsuleId: string;
  readonly expectedRevision: string;
  readonly from: TaskPhase;
  readonly to: TaskPhase;
  readonly evidenceIds: readonly EvidenceId[];
  readonly reason: string;
}
export interface TaskCapsuleRepositoryPort {
  getLatest(capsuleId: string, context: OperationContext): Promise<Versioned<TaskCapsule> | null>;
  appendRevision(next: TaskCapsule, condition: WriteCondition, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<Versioned<TaskCapsule>>;
  listByJob(jobId: JobId, request: PortPageRequest, context: OperationContext): Promise<PortPage<Versioned<TaskCapsule>>>;
}
```
`TaskCapsule` contains every required field from Spec §5; DAG edges are acyclic; content fingerprint is deterministic; state transitions are explicit and predicate-checked.

- [ ] Write domain failures for mutation, DAG cycle, invalid state transition, stale revision, missing predicate evidence, exhausted transition attempts, and non-deterministic fingerprint.
- [ ] Write strict contract failures for unknown properties and malformed DAG/state data.
- [ ] Implement entity/service/use cases first.
- [ ] Implement `SqliteTaskCapsuleRepository` inside `autonomy-state-infrastructure.ts` using immutable `task_capsule_revision` records plus mutable `task_capsule_head`, atomically in the supplied `UnitOfWorkTransaction`.
- [ ] Add restart/replay integration: after process restart, reconstruct the same latest state/fingerprint from persisted head+revision records without conversation history.
- [ ] Replace `task state survives restart without chat history` todo.
- [ ] Verify:
```bash
pnpm vitest run packages/domain/tests/task-capsule.test.ts packages/contracts/tests packages/application/tests apps/runtime/tests/autonomy/task-capsule.test.ts
pnpm check
git diff --check
git add -A
git commit -m "feat: add durable task capsule state machine"
```

**Hard gate:** deterministic replay, checked transitions, bounded attempts, valid DAG, restart recovery, zero chat-history authority.

---

## Task 3 — Execution Ledger + Ambiguous-Effect Reconciliation

**Files:**
- Create: `packages/domain/src/entities/execution-ledger-entry.ts`
- Create: `packages/application/src/ports/execution-ledger-repository.port.ts`
- Create: `packages/application/src/use-cases/append-execution-ledger.ts`
- Create: `packages/application/src/use-cases/reconcile-execution-effect.ts`
- Modify: `apps/runtime/src/autonomy/autonomy-state-infrastructure.ts`
- Create: `apps/runtime/src/autonomy/effect-reconciler.ts`
- Create: `packages/domain/tests/execution-ledger.test.ts`
- Create: `apps/runtime/tests/autonomy/execution-ledger.test.ts`

**Produces:**
```ts
export type EffectState = "observed" | "attempted" | "confirmed" | "unknown" | "reconciled" | "invalidated";
export interface ExecutionLedgerRepositoryPort {
  append(entry: ExecutionLedgerEntry, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<void>;
  listForJob(jobId: JobId, request: PortPageRequest, context: OperationContext): Promise<PortPage<ExecutionLedgerEntry>>;
}
```
Each immutable entry includes invocation ID, resource locator, pre/post fingerprint when applicable, evidence IDs, validity dependencies, timestamps, and failure signature.

- [ ] Write failures for observation invalidation after a file version changes, duplicate-operation detection, test-result invalidation when a dependency changes, unknown post-crash effect, and restart restoration.
- [ ] Implement ledger domain and use cases without model calls.
- [ ] Implement `SqliteExecutionLedgerRepository` in `autonomy-state-infrastructure.ts` as immutable `execution_ledger_entry` records.
- [ ] Integrate tool/sandbox finalization: an interrupted invocation with unknown outcome persists `unknown` and blocks blind retry until `effect-reconciler.ts` establishes applied/not-applied evidence.
- [ ] Replace `ambiguous effect is reconciled before retry` todo.
- [ ] Verify and commit:
```bash
pnpm vitest run packages/domain/tests/execution-ledger.test.ts packages/application/tests apps/runtime/tests/autonomy/execution-ledger.test.ts
pnpm check
git diff --check
git add -A
git commit -m "feat: add execution ledger and effect reconciliation"
```

**Hard gate:** correct invalidation, redundant-work detection, no blind retry, deterministic restart reconciliation.

---

## Task 4 — Manager -> Fresh Executor -> Independent Read-Only Auditor

**Files:**
- Modify: `apps/runtime/src/autonomy/task-manager.ts`
- Create: `apps/runtime/src/autonomy/task-executor.ts`
- Create: `apps/runtime/src/autonomy/task-auditor.ts`
- Modify: `apps/runtime/src/routed-solver.ts`
- Create: `apps/runtime/tests/autonomy/role-isolation.test.ts`

**Produces:**
```ts
export interface RoleInvocationManifest {
  readonly role: "manager" | "executor" | "auditor";
  readonly capsuleRevision: string;
  readonly contextFingerprint: string;
  readonly toolIds: readonly ToolId[];
  readonly readOnly: boolean;
}
```

- [ ] Write failing tests proving three distinct context manifests, no Executor private-reasoning artifact in Auditor context, Auditor has no effectful tools by default, and Auditor can reject an Executor-complete claim.
- [ ] Implement sequential roles through the existing provider-neutral model gateway; never require simultaneous 27B copies.
- [ ] Persist each role's context fingerprint/model/toolset provenance as normal artifacts/evidence.
- [ ] Add restart tests at manager, executor, and auditor boundaries.
- [ ] Replace `auditor cannot mutate candidate` todo.
- [ ] Verify/commit with `pnpm check`, `git diff --check`, `git add -A`, commit message `feat: add isolated manager executor auditor harness`.

**Hard gate:** fresh role isolation, read-only audit default, independent rejection, restart-safe handoff.

---

## Task 5 — Evidence-Conditioned Consequential Actions

**Files:**
- Create: `packages/application/src/services/evidence-precondition.ts`
- Modify: `packages/application/src/use-cases/invoke-tool.ts`
- Modify: `apps/runtime/src/autonomy/semantic-tool-catalog.ts`
- Create: `packages/application/tests/services/evidence-precondition.test.ts`
- Create: `apps/runtime/tests/autonomy/evidence-gating.test.ts`

**Produces:**
```ts
export interface EvidenceRequirement { readonly evidenceClass: string; readonly mandatory: boolean; }
export interface EvidencePreconditionDecision {
  readonly allowed: boolean;
  readonly missing: readonly EvidenceRequirement[];
  readonly satisfiedEvidenceIds: readonly EvidenceId[];
}
```

- [ ] Write failures where `code.patch` is denied until the task/risk profile's required definition/impact/test evidence exists; prove read-only inspection can still proceed.
- [ ] Implement deterministic operation + task-class + risk-class requirement evaluation using existing evidence repositories/linker.
- [ ] Return typed missing-evidence details; never silently fall back to `command.run` to bypass denial.
- [ ] Prove MCP/browser/raw-command routes cannot bypass the same effect gate.
- [ ] Run focused tests, `pnpm check`, update evidence/docs, `git add -A`, commit `feat: gate effects on required evidence`.

**Hard gate:** missing required evidence blocks consequential effects fail-closed with actionable denial metadata.

---

## Task 6 — Project Intelligence Ensemble + Context Compiler Integration

**Files:**
- Create: `packages/application/src/ports/project-intelligence.port.ts`
- Create: `packages/application/src/services/project-retrieval-fusion.ts`
- Create: all `packages/infrastructure/src/project-intelligence/*` files from the ownership map
- Create: `apps/runtime/src/autonomy/retrieval-context-source.ts`
- Modify: supervised software-production context assembly only after the ensemble passes its A/B gate
- Create: `apps/runtime/tests/autonomy/project-intelligence.test.ts`
- Create: `scripts/prove-project-intelligence-real.mjs`

**Produces:**
```ts
export interface ProjectFact {
  readonly kind: "file" | "symbol" | "reference" | "dependency" | "test" | "history" | "architecture" | "failure";
  readonly locator: string;
  readonly score: number;
  readonly provenance: ApplicationJsonObject;
}
export interface ProjectIntelligencePort {
  query(projectId: string, query: string, context: OperationContext): Promise<readonly ProjectFact[]>;
  impact(projectId: string, locators: readonly string[], context: OperationContext): Promise<readonly ProjectFact[]>;
}
```

- [ ] Freeze one deterministic repository-task fixture set covering definition->references, trace->implementation, code->tests, requirement->files, architecture->boundaries, and multi-file tasks where lexical-only retrieval fails.
- [ ] Pin/add Tree-sitter, SCIP/scip-typescript, and ast-grep one at a time; provider types stay inside infrastructure.
- [ ] Implement Git facts and FTS5 lexical retrieval.
- [ ] Implement RepoMap-style graph relevance and deterministic reciprocal-rank-style fusion.
- [ ] Add optional Qwen3-Embedding-4B semantic retrieval behind the model boundary; system remains functional when unavailable.
- [ ] A/B lexical, structural, semantic, and fused under matched budgets. Promote no reranker unless fused+reranker beats fused on verified task success or equal quality at materially lower resource cost.
- [ ] Only after the A/B gate, replace autonomy-profile raw concatenation with ranked candidates into the existing Context Compiler. Mandatory mission material remains non-evictable.
- [ ] Run `prove-project-intelligence-real.mjs`, `pnpm check`, update maps/evidence, `git add -A`, commit `feat: add measured project intelligence ensemble`.

**Hard gate:** fused project intelligence beats individual baselines by the declared matched-resource criterion; Context Compiler remains final packing authority.

---

## Task 7 — Agent Skills Runtime, Retrieval, and Promotion

**Files:**
- Create: `packages/domain/src/entities/skill-profile.ts`
- Create: `packages/contracts/src/skills.schemas.ts`
- Create: `packages/application/src/ports/skill-registry.port.ts`
- Create: `packages/application/src/services/skill-selector.ts`
- Create: `packages/application/src/use-cases/register-skill.ts`
- Create: `packages/application/src/use-cases/promote-skill.ts`
- Create: `packages/infrastructure/src/skills/agent-skills-loader.ts`
- Modify: `apps/runtime/src/autonomy/autonomy-state-infrastructure.ts`
- Create: `apps/runtime/src/autonomy/skill-context-source.ts`
- Create: `apps/runtime/tests/autonomy/skill-runtime.test.ts`

**Produces:** skill trust state exactly `CANDIDATE | SHADOW | TRUSTED | REJECTED` plus V31M4 side metadata for task class, preconditions, context recipe, tools/permissions, checks, recovery/stop rules, harness constraints, evaluation evidence, and promotion history.

- [ ] Write import failures for malformed Agent Skills layout, path escape, unsafe script metadata, and self-declared permissions.
- [ ] Implement Agent Skills loader without making public `SKILL.md` incompatible.
- [ ] Implement `SqliteSkillRegistry` in `autonomy-state-infrastructure.ts` using `SqliteRecordStore`; every import/generated skill starts `CANDIDATE`.
- [ ] Implement selector that cannot return `CANDIDATE` for trusted production execution.
- [ ] Implement promotion requiring held-out incumbent comparison, no material regression, positive verified delta or materially lower cost, shadow evidence, and governed promotion.
- [ ] Prove a skill cannot expand ToolGateway permissions.
- [ ] Add local SkillsBench/SWE-Skills/SkillGen-style fixtures; run `pnpm check`, docs/evidence, `git add -A`, commit `feat: add governed agent skills runtime`.

**Hard gate:** skill files cannot grant trust/permissions; promotion is evidence-backed.

---

## Task 8 — Multi-Substrate Memory Router

**Files:**
- Create: `packages/domain/src/entities/memory-record.ts`
- Create: `packages/contracts/src/memory.schemas.ts`
- Create: `packages/application/src/ports/memory-repository.port.ts`
- Create: `packages/application/src/services/memory-router.ts`
- Create: `packages/application/src/use-cases/record-memory.ts`
- Create: `packages/application/src/use-cases/retrieve-memory.ts`
- Modify: `apps/runtime/src/autonomy/autonomy-state-infrastructure.ts`
- Create: `packages/infrastructure/src/memory/semantic-memory-index.ts`
- Create: `apps/runtime/src/autonomy/memory-context-source.ts`
- Create: `apps/runtime/tests/autonomy/memory-router.test.ts`

**Produces:**
```ts
export type MemoryClass = "episodic" | "semantic" | "procedural";
export interface MemoryQueryPlan {
  readonly substrates: readonly ("structured" | "lexical" | "semantic" | "graph" | "runbook")[];
  readonly maxItems: number;
  readonly maxContextTokens: number;
  readonly mayAbstain: true;
}
```
Every record includes provenance, evidence IDs, scope, creation/verification times, temporal validity, status/confidence, invalidators/expiry, and relationship links.

- [ ] Write failures proving expired/invalidated memory cannot enter context as current fact.
- [ ] Implement `SqliteMemoryRepository` in `autonomy-state-infrastructure.ts` for authoritative records; exact/FTS retrieval first.
- [ ] Add semantic/graph/runbook retrieval as optional substrates behind ports, never as truth stores.
- [ ] Implement deterministic router with abstention and token budget.
- [ ] Add context-pollution regression: larger irrelevant retrieval cannot displace smaller high-validity memory merely due quantity.
- [ ] Replace `stale memory is not injected as current fact` todo.
- [ ] Run factual/temporal/sequential/long-trajectory fixture categories, restart tests, `pnpm check`, docs/evidence, `git add -A`, commit `feat: add routed evidence-backed memory`.

**Hard gate:** stale memory cannot masquerade as current fact; retrieval may abstain; task-dependent routing is measured.

---

## Task 9 — Quality Floor Controller + Supplemental Verification

**Files:**
- Create: `packages/application/src/services/capability-confidence.ts`
- Create: `packages/application/src/services/quality-floor-controller.ts`
- Modify existing compute/diversity/capability/champion/improvement services only where composition requires it
- Create: `apps/runtime/src/autonomy/quality-floor-runtime.ts`
- Add RETRACE-style/contextual-rubric adapters behind existing verifier/model boundaries
- Create: `apps/runtime/tests/autonomy/quality-floor.test.ts`
- Create: `scripts/prove-autonomy-quality-floor-real.mjs`

**Produces:**
```ts
export interface CapabilityStratum {
  readonly modelId: ModelId;
  readonly modelVariant: string;
  readonly taskClass: string;
  readonly difficultyBand: string;
  readonly skillVersion: string | null;
  readonly toolsetVersion: string;
  readonly retrievalVersion: string;
  readonly harnessVersion: string;
  readonly verificationClass: string;
}
export function wilsonLowerBound(successes: number, trials: number, z?: number): number;
```
Default one-sided 95% `z = 1.6448536269514722`; calibrated 9/10 eligibility requires lower bound >=0.90 for a sufficiently homogeneous measured stratum.

- [ ] Write exact Wilson tests for 0/N, N/N, small sample, large sample, invalid inputs.
- [ ] Write ladder tests: `DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE -> SPECIALIST_OR_ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION`.
- [ ] Implement controller by composing existing Compute Governor, Diversity Planner, Capability Calculator, Champion Selector, Evidence Linker, and Improvement Policy; do not duplicate their responsibilities.
- [ ] Add deterministic-failure supremacy regression: no RETRACE/rubric/auditor pass can override compiler/test/security/invariant failure.
- [ ] Add supplemental RETRACE-style patch/problem reconstruction and contextual rubric evidence classes.
- [ ] Replace both Phase-0 quality-floor/deterministic-failure todos.
- [ ] Run `prove-autonomy-quality-floor-real.mjs`, `pnpm check`, docs/evidence, `git add -A`, commit `feat: enforce calibrated autonomy quality floor`.

**Hard gate:** conservative capability eligibility, deterministic escalation/abstention, and zero neural override of deterministic failure.

---

## Task 10 — External Evaluation + Sandbox Backend Bake-Off

**Files:**
- Create: `packages/application/src/ports/benchmark-runner.port.ts`
- Create challengers: `packages/infrastructure/src/sandbox/opensandbox-adapter.ts`, `openshell-adapter.ts`
- Create: `scripts/prove-sandbox-backends-real.mjs`
- Create: `docs/reviews/sandbox-backend-bakeoff.md`
- Create: `docs/reviews/autonomy-evaluation-campaign.md`

**Produces:** immutable matched-resource evaluation evidence; one selected sandbox backend behind unchanged `SandboxPort`.

- [ ] Implement OpenSandbox/OpenShell challengers only behind disabled optional composition until measured.
- [ ] Run identical target-host suite on hardened direct Docker, OpenSandbox, OpenShell when install/support permits: filesystem escape, network egress, process/resource limits, secret leakage, child/orphan behavior, cancellation, backend crash, server restart, effect reconciliation, latency, workload compatibility.
- [ ] Select a backend only from recorded evidence. If no challenger clearly beats direct Docker on security/reliability without unacceptable overhead, retain direct Docker.
- [ ] Run available Harbor/Harbor-Index, Terminal-Bench, RigorBench, Agent Retrieval Bench, SWE-style, skills, memory, and V31M4 private recovery/governance suites under matched resources.
- [ ] No benchmark can write production state; results enter as immutable evaluation artifacts/evidence.
- [ ] Run `pnpm check`, all promoted target-host proof scripts, update only verified current-state claims, `git add -A`, commit `test: complete autonomy external acceptance campaign`.

**Hard gate:** no critical hidden regression and sandbox backend selected by real target-host evidence, not documentation.

---

## Task 11 — Verified Harness/Skill Self-Improvement Laboratory

**Files:**
- Use the repository's laboratory isolation pattern; do not add self-improvement behavior to the production composition root.
- Extend existing promotion/capability/evidence ports/use cases where semantics fit.
- Create: `docs/reviews/autonomy-self-improvement-proof.md`

**Candidate record must include:** component/version, explicit hypothesis, predicted metric change, task-set IDs, held-out result, prior-capability regression result, shadow result, evidence IDs, governed promotion decision.

- [ ] First write rejection test: candidate improves a new task but materially regresses a protected prior capability -> promotion denied.
- [ ] Implement AHE-style observability: every candidate has a falsifiable hypothesis and measured outcome.
- [ ] Implement GSME-style diverse candidate archive/search while deterministic V31M4 code owns measurements/significance.
- [ ] Implement RELAI-style protected-capability constraints in the existing promotion path.
- [ ] Promotion sequence is exactly held-out improvement -> protected-capability pass -> shadow production -> verified production evidence -> governed promotion.
- [ ] Prove lab code cannot mutate production policy/evidence/capability state except through normal authorized promotion use cases.
- [ ] Run full hermetic regression plus the external campaign regression subset, update final maps/current-state/evidence, `git add -A`, commit `feat: add verified no-regression self-improvement lab`.

**Hard gate:** no self-certification and no promotion that materially regresses a protected capability.

---

## Final Clean-Checkout Acceptance

At the exact final commit, create a clean worktree and run:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```
Then run every opt-in target-host proof that `docs/current-state.md` claims as verified: autonomy Phase 1, project intelligence, sandbox backend, autonomy quality floor, model routing, general coding, and autonomous repair. Record exact versions of Node, pnpm, Ollama/model IDs, Qwen quant, selected sandbox backend, Tree-sitter/SCIP/ast-grep, embedding model if promoted, and MCP SDK if promoted.

`V31M4-AUTONOMY-001` is complete only when all Spec §21 conditions have direct evidence. Anything unevidenced remains explicitly incomplete in `docs/current-state.md`.

## Executor Rules

1. Read `AGENTS.md`, approved spec, this plan, `docs/current-state.md`, dependency rules, repository map, and nearest README before each task.
2. Verify live HEAD before editing.
3. Execute implementation in an isolated git worktree.
4. One task at a time; stop for review at every hard gate.
5. TDD before production behavior.
6. Do not opportunistically implement later tasks.
7. Do not substitute a different framework/model because integration is easier.
8. If live code makes an interface here incompatible, stop and record the exact conflict. Reconcile with existing architecture instead of creating a parallel path.
9. Update `repo_map.md`, `docs/repository-map.md`, and `docs/current-state.md` when ownership/implementation truth changes, plus immutable phase evidence.
10. End every task with a commit so review/rollback boundaries remain exact.
