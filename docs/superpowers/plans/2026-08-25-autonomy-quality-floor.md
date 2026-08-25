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
  interoperability.test.ts
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

**Files:** `docs/reviews/autonomy-baseline.md`, `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`, `docs/current-state.md`.

**Produces:** exact pre-autonomy baseline and named acceptance fixtures.

- [ ] Run and record:
```bash
git rev-parse HEAD
node --version
pnpm --version
pnpm check
```
Any failure is a blocker until explained.
- [ ] Create the exact Phase-0 inventory:
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
- [ ] `autonomy-baseline.md` records HEAD, Node/pnpm versions, `pnpm check`, current model/tool profiles, and current limitations. `docs/current-state.md` says approved/planned, not implemented.
- [ ] Verify/commit:
```bash
pnpm check
git diff --check
git add -A
git commit -m "test: freeze autonomy program baseline"
```

**Hard gate:** clean explained baseline and no false implementation claim.

---

## Task 1 — Governed Semantic ACI + `SandboxPort`

**Files:** `packages/application/src/ports/sandbox.port.ts`, existing `tool-gateway.port.ts`, existing `invoke-tool.ts`, `packages/infrastructure/src/sandbox/{direct-docker-sandbox,sandbox-supervisor}.ts`, `apps/runtime/src/autonomy/semantic-tool-catalog.ts`, `packages/application/tests/sandbox-port.test.ts`, focused invoke-tool tests, `apps/runtime/tests/autonomy/governed-aci.test.ts`, `scripts/prove-autonomy-phase1-real.mjs`.

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
Semantic IDs are exactly `repo.map_task`, `repo.search`, `repo.symbol`, `repo.references`, `repo.impact`, `repo.history`, `code.inspect`, `code.patch`, `build.check`, `test.targeted`, `test.regression`, `debug.reproduce`, `failure.explain`, `git.status`, `git.diff`, `git.history`, `git.worktree`, `command.run`, `browser.inspect`, `browser.verify`.

- [ ] First failing tests prove effectful operations require job identity, policy authorization, resource budget, sandbox handle, cancellation semantics, and provenance; no model path reaches shell/browser/sandbox directly.
- [ ] Run expected failure:
```bash
pnpm vitest run packages/application/tests/sandbox-port.test.ts packages/application/tests/use-cases apps/runtime/tests/autonomy/governed-aci.test.ts
```
- [ ] Implement port/catalog/minimal direct-Docker/reference adapter: network denied by default, no sandbox Docker socket, no ambient host secrets, explicit resource limits, hermetic profile unchanged.
- [ ] Add cancellation, timeout, orphan, resource, and unknown-effect tests.
- [ ] Real proof calls V31M4 create -> execute -> inspect -> destroy, never Docker directly.
- [ ] Replace `no model-direct tool bypass` todo.
- [ ] Verify/commit with focused tests, `pnpm check`, `git diff --check`, `git add -A`, commit `feat: add governed semantic tool and sandbox boundary`.

**Hard gate:** typed/policy-gated/evidenced/cancellable/sandboxed effects and no direct bypass.

---

## Task 2 — Task Capsule + Checked State Machine + Task DAG

**Files:** `task-capsule.ts`, `task-capsules.schemas.ts`, `task-capsule-repository.port.ts`, `task-transition-policy.ts`, `create-task-capsule.ts`, `propose-task-transition.ts`, `apps/runtime/src/autonomy/{autonomy-state-infrastructure,task-manager}.ts`, domain/contract/application/runtime tests.

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
Entity includes every Spec §5 field, deterministic fingerprint, and acyclic DAG.

- [ ] Write failures for mutation, cycle, invalid transition, stale revision, missing predicate evidence, exhausted attempt bound, fingerprint instability.
- [ ] Write strict contract failures for unknown/malformed state.
- [ ] Implement entity/service/use cases.
- [ ] Implement `SqliteTaskCapsuleRepository` in `autonomy-state-infrastructure.ts`: immutable `task_capsule_revision` records + mutable `task_capsule_head`, atomically via supplied transaction.
- [ ] Restart/replay test reconstructs identical latest state/fingerprint without chat history.
- [ ] Replace task-state todo.
- [ ] Run focused domain/contracts/application/runtime tests, `pnpm check`, docs/maps/evidence, `git add -A`, commit `feat: add durable task capsule state machine`.

**Hard gate:** deterministic replay, checked transitions, bounded attempts, DAG validity, restart recovery, no chat-history authority.

---

## Task 3 — Execution Ledger + Ambiguous-Effect Reconciliation

**Files:** `execution-ledger-entry.ts`, `execution-ledger-repository.port.ts`, `append-execution-ledger.ts`, `reconcile-execution-effect.ts`, `autonomy-state-infrastructure.ts`, `effect-reconciler.ts`, domain/runtime tests.

**Produces:**
```ts
export type EffectState = "observed" | "attempted" | "confirmed" | "unknown" | "reconciled" | "invalidated";
export interface ExecutionLedgerRepositoryPort {
  append(entry: ExecutionLedgerEntry, context: OperationContext, transaction: UnitOfWorkTransaction): Promise<void>;
  listForJob(jobId: JobId, request: PortPageRequest, context: OperationContext): Promise<PortPage<ExecutionLedgerEntry>>;
}
```
Each entry includes invocation ID, resource locator, pre/post fingerprint, evidence IDs, validity dependencies, timestamps, failure signature.

- [ ] Write failures for stale observation, duplicate operation, invalidated test result, unknown crash effect, restart restore.
- [ ] Implement ledger without model calls and persist immutable `execution_ledger_entry` records.
- [ ] Interrupted effect persists `unknown`; reconciler must establish applied/not-applied evidence before retry.
- [ ] Replace ambiguous-effect todo.
- [ ] Run focused tests, `pnpm check`, docs/evidence, `git add -A`, commit `feat: add execution ledger and effect reconciliation`.

**Hard gate:** correct invalidation, redundant-work detection, no blind retry, deterministic reconciliation.

---

## Task 4 — Manager -> Fresh Executor -> Independent Read-Only Auditor

**Files:** create `packages/application/src/use-cases/select-next-task.ts`, `audit-task-result.ts`; modify `task-manager.ts`; create `task-executor.ts`, `task-auditor.ts`; modify `routed-solver.ts`; add application use-case tests and `apps/runtime/tests/autonomy/role-isolation.test.ts`.

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
`selectNextTask` reads authoritative capsule/DAG state and returns one bounded executable node plus required skill/tool/context recipe. `auditTaskResult` consumes acceptance contract, final capsule revision, candidate artifacts/diff, ledger facts, and evidence and returns an audit decision; it cannot mutate candidate state.

- [ ] Write failing application tests for deterministic next-node selection, dependency/blocker respect, and no completion mutation from planner output.
- [ ] Write runtime failures for distinct role context manifests, no Executor private-reasoning artifact in Auditor context, read-only auditor toolset, auditor rejection of executor-complete claim.
- [ ] Implement use cases and sequential role runtime through existing model gateway; never simultaneous 27B residency requirement.
- [ ] Persist context/model/toolset fingerprints as normal artifacts/evidence.
- [ ] Restart tests at each role boundary.
- [ ] Replace auditor todo.
- [ ] Run focused tests, `pnpm check`, docs/evidence, `git add -A`, commit `feat: add isolated manager executor auditor harness`.

**Hard gate:** deterministic task selection, fresh role isolation, read-only audit default, independent rejection, restart-safe handoff.

---

## Task 5 — Evidence-Conditioned Consequential Actions

**Files:** `evidence-precondition.ts`, existing `invoke-tool.ts`, `semantic-tool-catalog.ts`, service/runtime tests.

**Produces:**
```ts
export interface EvidenceRequirement { readonly evidenceClass: string; readonly mandatory: boolean; }
export interface EvidencePreconditionDecision {
  readonly allowed: boolean;
  readonly missing: readonly EvidenceRequirement[];
  readonly satisfiedEvidenceIds: readonly EvidenceId[];
}
```

- [ ] Write failure where `code.patch` is denied until task/risk-required definition/impact/test evidence exists; read-only inspection remains allowed.
- [ ] Implement deterministic operation + task class + risk class evaluation over existing evidence/linker inputs.
- [ ] Typed denial lists missing evidence; no `command.run` fallback bypass.
- [ ] Prove MCP/browser/raw command cannot bypass same effect gate.
- [ ] Focused tests, `pnpm check`, docs/evidence, `git add -A`, commit `feat: gate effects on required evidence`.

**Hard gate:** required evidence blocks consequential effects fail-closed with actionable denial.

---

## Task 6 — Project Intelligence Ensemble + Context Compiler

**Files:** `project-intelligence.port.ts`, `project-retrieval-fusion.ts`, all `packages/infrastructure/src/project-intelligence/*`, `retrieval-context-source.ts`, supervised software-production context assembly after A/B gate, runtime test, real proof script.

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

- [ ] Freeze deterministic fixture set: definition->references, trace->implementation, code->tests, requirement->files, architecture->boundaries, hidden multi-file lexical failure.
- [ ] Pin/add Tree-sitter, SCIP/scip-typescript, ast-grep; provider types stay infrastructure-local.
- [ ] Implement Git facts + FTS5 lexical retrieval.
- [ ] Implement RepoMap-style graph relevance + deterministic RRF-style fusion.
- [ ] Add optional Qwen3-Embedding-4B via model boundary; unavailable sidecar cannot break structural/lexical path.
- [ ] Matched-budget A/B lexical/structural/semantic/fused. No reranker promotion without verified improvement or equal quality at materially lower cost.
- [ ] Only after gate, autonomy profile replaces raw concatenation with candidates into existing Context Compiler; mandatory context remains non-evictable.
- [ ] Real proof, `pnpm check`, maps/evidence, `git add -A`, commit `feat: add measured project intelligence ensemble`.

**Hard gate:** fused system beats individual baselines by declared matched-resource criterion; Context Compiler remains final authority.

---

## Task 7 — Agent Skills + MCP Interoperability + Governed Promotion

**Files:** `skill-profile.ts`, `skills.schemas.ts`, `skill-registry.port.ts`, `skill-selector.ts`, `register-skill.ts`, `promote-skill.ts`, `agent-skills-loader.ts`, `mcp-tool-adapter.ts`, `autonomy-state-infrastructure.ts`, `skill-context-source.ts`, `skill-runtime.test.ts`, `interoperability.test.ts`.

**Produces:** trust state exactly `CANDIDATE | SHADOW | TRUSTED | REJECTED`. Side metadata records task class, preconditions, context recipe, tools/permissions, checks, recovery/stop rules, harness constraints, evaluation evidence, promotion history.

MCP boundary is exactly:
```text
external MCP server -> V31M4 MCP adapter -> ToolGatewayPort -> policy/evidence/budget/sandbox -> semantic tool
```
No raw MCP tool is directly model-visible. A2A is **not** implemented merely for standards coverage; if a concrete external-agent integration later requires A2A, it must be a replaceable adapter using native Task Capsule semantics internally.

- [ ] Write Agent Skills import failures for malformed layout, path escape, unsafe scripts, self-declared permissions.
- [ ] Implement loader preserving public `SKILL.md` compatibility.
- [ ] Implement `SqliteSkillRegistry` with `SqliteRecordStore`; all imports/generated skills start `CANDIDATE`.
- [ ] Selector cannot return candidate skill for trusted production execution.
- [ ] Promotion requires held-out incumbent comparison, no material regression, positive verified delta or lower cost, shadow evidence, governed promotion.
- [ ] Pin official MCP TS SDK; implement adapter translating external catalogs/calls to provider-neutral V31M4 tool profiles/results.
- [ ] Prove MCP server cannot write authoritative V31M4 state, bypass evidence/policy, expand skill permissions, or become hermetic startup dependency.
- [ ] Local SkillsBench/SWE-Skills/SkillGen-style fixtures, `pnpm check`, docs/evidence, `git add -A`, commit `feat: add governed skills and MCP interoperability`.

**Hard gate:** skill/MCP input cannot grant trust, permissions, or authority; production skill promotion is evidence-backed.

---

## Task 8 — Multi-Substrate Memory Router

**Files:** `memory-record.ts`, `memory.schemas.ts`, `memory-repository.port.ts`, `memory-router.ts`, `record-memory.ts`, `retrieve-memory.ts`, `autonomy-state-infrastructure.ts`, `semantic-memory-index.ts`, `memory-context-source.ts`, `memory-router.test.ts`.

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
Records include provenance, evidence, scope, creation/verification times, temporal validity, status/confidence, invalidators/expiry, relationships.

- [ ] Failing tests: expired/invalidated memory cannot enter context as current fact.
- [ ] Implement `SqliteMemoryRepository` authoritative records + exact/FTS path first.
- [ ] Semantic/graph/runbook are optional retrieval substrates, never truth stores.
- [ ] Deterministic router supports abstention/token budget.
- [ ] Context-pollution regression: quantity cannot displace validity.
- [ ] Replace stale-memory todo; run factual/temporal/sequential/long-trajectory fixtures and restart tests.
- [ ] `pnpm check`, docs/evidence, `git add -A`, commit `feat: add routed evidence-backed memory`.

**Hard gate:** stale memory cannot masquerade as current truth; retrieval may abstain; routing is measured by task class.

---

## Task 9 — Quality Floor Controller + Supplemental Verification

**Files:** `capability-confidence.ts`, `quality-floor-controller.ts`, minimal composition changes to existing compute/diversity/capability/champion/improvement services, `quality-floor-runtime.ts`, supplemental RETRACE/rubric adapters behind existing verifier/model boundaries, runtime test, real proof script.

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
Default one-sided 95% `z = 1.6448536269514722`; calibrated 9/10 requires lower bound >=0.90 in a sufficiently homogeneous measured stratum.

- [ ] Exact Wilson tests: 0/N, N/N, small, large, invalid inputs.
- [ ] Ladder tests: `DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE -> SPECIALIST_OR_ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION`.
- [ ] Compose existing services rather than duplicate them.
- [ ] Deterministic-failure supremacy regression: RETRACE/rubric/auditor cannot override compiler/test/security/invariant failure.
- [ ] Add supplemental RETRACE-style reconstruction and contextual rubric evidence.
- [ ] Replace quality-floor/deterministic-failure todos.
- [ ] Real proof, `pnpm check`, docs/evidence, `git add -A`, commit `feat: enforce calibrated autonomy quality floor`.

**Hard gate:** conservative eligibility, escalation/abstention, zero neural override of deterministic failure.

---

## Task 10 — External Evaluation + Sandbox Backend Bake-Off

**Files:** `benchmark-runner.port.ts`, optional `opensandbox-adapter.ts`, optional `openshell-adapter.ts`, real bake-off script, `sandbox-backend-bakeoff.md`, `autonomy-evaluation-campaign.md`.

**Produces:** immutable matched-resource evaluation evidence; one selected sandbox backend behind unchanged `SandboxPort`.

- [ ] Implement challengers only behind disabled optional composition until measured.
- [ ] Identical target-host suite: filesystem escape, network egress, resource limits, secret leakage, child/orphan, cancellation, backend crash, server restart, effect reconciliation, latency, workload compatibility.
- [ ] Select backend only from evidence; retain hardened direct Docker if challengers do not clearly improve security/reliability at acceptable cost.
- [ ] Run available Harbor/Harbor-Index, Terminal-Bench, RigorBench, Agent Retrieval Bench, SWE-style, skills, memory, private recovery/governance suites under matched resources.
- [ ] Benchmarks cannot write production state; results are immutable evidence/artifacts.
- [ ] `pnpm check`, promoted target-host proofs, truth-only current-state update, `git add -A`, commit `test: complete autonomy external acceptance campaign`.

**Hard gate:** no critical hidden regression and sandbox backend selected by real target-host evidence.

---

## Task 11 — Verified Harness/Skill Self-Improvement Laboratory

**Files:** use existing laboratory isolation pattern; extend existing promotion/capability/evidence ports/use cases where semantics fit; create `docs/reviews/autonomy-self-improvement-proof.md`. Do not add self-improvement behavior to normal production composition.

**Candidate record:** component/version, hypothesis, predicted metric change, task-set IDs, held-out result, protected-capability regression result, shadow result, evidence IDs, governed promotion decision.

- [ ] Rejection test: new-task improvement + material protected-capability regression -> denied.
- [ ] AHE-style observability: falsifiable hypothesis + measured outcome.
- [ ] GSME-style diverse candidate archive/search; deterministic V31M4 owns measurement/significance.
- [ ] RELAI-style protected-capability constraints in normal promotion path.
- [ ] Promotion exactly held-out improvement -> protected-capability pass -> shadow -> verified production evidence -> governed promotion.
- [ ] Lab cannot mutate production policy/evidence/capability state except authorized promotion use cases.
- [ ] Full hermetic regression + external campaign regression subset, final maps/current-state/evidence, `git add -A`, commit `feat: add verified no-regression self-improvement lab`.

**Hard gate:** no self-certification and no promotion that materially regresses protected capability.

---

## Final Clean-Checkout Acceptance

At the final commit, use a clean worktree:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```
Run every opt-in target-host proof claimed by `docs/current-state.md`: autonomy Phase 1, project intelligence, sandbox backend, autonomy quality floor, model routing, general coding, autonomous repair. Record exact Node, pnpm, Ollama/model IDs, Qwen quant, sandbox backend, Tree-sitter/SCIP/ast-grep, embedding model if promoted, and MCP SDK if promoted.

`V31M4-AUTONOMY-001` is complete only when every Spec §21 condition has evidence; anything else remains explicitly incomplete.

## Executor Rules

1. Before each task read `AGENTS.md`, approved spec, this plan, `docs/current-state.md`, dependency rules, repository map, nearest README.
2. Verify live HEAD.
3. Use an isolated git worktree.
4. One task at a time; stop at every hard gate for review.
5. TDD before production behavior.
6. Do not opportunistically implement later tasks.
7. Do not substitute a different framework/model merely because it is easier.
8. If live code conflicts with an interface here, stop and record the exact conflict; preserve architecture and reconcile rather than creating a parallel path.
9. Update `repo_map.md`, `docs/repository-map.md`, `docs/current-state.md` when implementation truth changes, plus immutable phase evidence.
10. End every task with a commit.
