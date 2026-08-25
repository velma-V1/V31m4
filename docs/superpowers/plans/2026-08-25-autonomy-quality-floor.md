# V31M4 Autonomy Quality-Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `V31M4-AUTONOMY-001` so V31M4 can autonomously investigate, act, verify, repair, recover, and abstain through governed local tools while preserving a calibrated quality floor.

**Architecture:** Extend the existing V31M4 domain/application/infrastructure/runtime authority instead of installing a second agent framework. Durable task state, execution reality, project intelligence, skills, memory, quality calibration, sandboxing, and self-improvement remain behind V31M4-owned types/ports; external open-source projects supply replaceable substrates or research mechanisms only.

**Tech Stack:** TypeScript 7, Node >=22, pnpm 11.17, Vitest 4, SQLite, existing supervised JSON-RPC/process infrastructure, Ollama/model gateway, Tree-sitter, SCIP/scip-typescript, ast-grep, Git, Playwright, MCP TypeScript SDK, optional Qwen3 embedding sidecar, sandbox backend selected by target-host bake-off.

**Spec:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture.md`

## Global Constraints

- Preserve all existing public V31M4 v1 semantics and Clean Architecture dependency direction.
- Do not introduce OpenHands, LangGraph, AutoGen, CrewAI, SWE-agent, StateM, LongHorizon-Harness, Symphony, or another framework as a second orchestrator/state authority.
- Models never certify their own outputs; deterministic evidence outranks neural judgment.
- No trusted production path may depend on a floating `latest` version.
- Optional embedding, reranking, sandbox-server, MCP, browser, Video, and Game services must not become hermetic core-startup dependencies.
- The primary local acceptance model is initially Qwen3.8-27B Q4_K_M, but no domain/application type may depend on that model name.
- Effectful work remains outside SQLite transactions and behind policy, approval where required, resource budget, evidence, and sandbox boundaries.
- Ambiguous post-crash effects are reconciled before retry; blind replay is forbidden.
- Keep source files focused; target <400 lines and do not exceed the repository's existing 500-line guard without an explicitly documented exception.
- Every task uses TDD: failing focused test first, minimal implementation, focused pass, owning-layer pass, `pnpm check`, documentation/evidence update, commit.
- Do not start a later task until the prior task's hard gate passes.

## Planned file ownership

The exact file names below are the intended ownership map. Reuse an existing file instead only when it already owns the exact responsibility; do not create parallel abstractions.

```text
packages/domain/src/entities/
  task-capsule.ts                  authoritative immutable task-state revision
  execution-ledger-entry.ts        immutable environment observation/effect history
  skill-profile.ts                 V31M4 trust/promotion metadata for Agent Skills
  memory-record.ts                 evidence-backed episodic/semantic memory record

packages/contracts/src/
  task-capsules.schemas.ts         external/query command schemas for capsule state
  skills.schemas.ts                skill registration/query/promotion boundary schemas
  memory.schemas.ts                memory query/observation boundary schemas

packages/application/src/ports/
  task-capsule-repository.port.ts
  execution-ledger-repository.port.ts
  sandbox.port.ts
  project-intelligence.port.ts
  skill-registry.port.ts
  memory-repository.port.ts
  benchmark-runner.port.ts         evaluation-lab boundary; never core-startup required

packages/application/src/services/
  task-transition-policy.ts        typed checked transitions and attempt bounds
  evidence-precondition.ts         operation/task/risk evidence requirements
  project-retrieval-fusion.ts      deterministic result fusion/ranking inputs
  skill-selector.ts                trusted/candidate filtering and ranking
  memory-router.ts                 deterministic substrate routing/abstention plan
  quality-floor-controller.ts      escalation ladder and calibrated eligibility
  capability-confidence.ts         one-sided Wilson lower-bound math

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

packages/infrastructure/src/
  database/task-capsule-repository.ts
  database/execution-ledger-repository.ts
  database/skill-registry.ts
  database/memory-repository.ts
  sandbox/sandbox-supervisor.ts
  sandbox/direct-docker-sandbox.ts
  sandbox/opensandbox-adapter.ts        challenger; promote only after bake-off
  sandbox/openshell-adapter.ts          challenger; promote only after bake-off
  project-intelligence/tree-sitter-index.ts
  project-intelligence/scip-index.ts
  project-intelligence/ast-grep-index.ts
  project-intelligence/git-project-facts.ts
  project-intelligence/lexical-index.ts
  project-intelligence/semantic-index.ts
  project-intelligence/project-intelligence-adapter.ts
  skills/agent-skills-loader.ts
  memory/semantic-memory-index.ts
  interoperability/mcp-tool-adapter.ts

apps/runtime/src/autonomy/
  autonomy-composition.ts
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
  one focused integration file per task below

scripts/
  prove-autonomy-phase1-real.mjs
  prove-project-intelligence-real.mjs
  prove-sandbox-backends-real.mjs
  prove-autonomy-quality-floor-real.mjs
```

If a task introduces a new persistence table, add a numbered migration under the existing `packages/infrastructure/src/database` migration mechanism and a migration/restore regression in infrastructure tests.

---

### Task 0: Freeze the Baseline and Add Program Acceptance Fixtures

**Files:**
- Create: `docs/reviews/autonomy-baseline.md`
- Create: `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`
- Modify: `docs/current-state.md`

**Interfaces:**
- Consumes: current `main`, existing `hermetic_reference` and `supervised_local` profiles.
- Produces: immutable baseline evidence and failure fixtures used by every later task.

- [ ] **Step 1: Record and verify the live baseline**

Run:
```bash
git rev-parse HEAD
pnpm check
```
Expected: current pre-implementation HEAD recorded verbatim; `pnpm check` exits 0. If not, stop and classify every failure before changing behavior.

- [ ] **Step 2: Add failing future-facing invariant fixtures**

Create `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts` with skipped-by-name fixtures that are individually unskipped by the task that implements them; do not use `it.skip` for an implemented phase. Fixture names must cover:
```ts
"no model-direct tool bypass"
"task state survives restart without chat history"
"ambiguous effect is reconciled before retry"
"auditor cannot mutate candidate"
"stale memory is not injected as current fact"
"deterministic failure cannot be overridden by neural verifier"
"quality floor abstains outside calibrated envelope"
```
Use explicit `it.todo(...)` only as Phase-0 inventory; each later task must replace its matching `todo` with an executable regression.

- [ ] **Step 3: Write baseline report**

`docs/reviews/autonomy-baseline.md` must record HEAD, Node/pnpm versions, `pnpm check` result, current model/tool profile behavior, and the known current limitations from the approved spec. No future capability may be described as implemented.

- [ ] **Step 4: Re-run the gate and commit**

Run:
```bash
pnpm check
git diff --check
git add docs/reviews/autonomy-baseline.md docs/current-state.md apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts
git commit -m "test: freeze autonomy program baseline"
```

**Hard gate:** zero unexplained baseline failures and no implemented capability claimed by a `todo` fixture.

---

### Task 1: Add `SandboxPort` and the Governed Semantic ACI

**Files:**
- Create: `packages/application/src/ports/sandbox.port.ts`
- Modify: `packages/application/src/ports/tool-gateway.port.ts`
- Modify: `packages/application/src/use-cases/invoke-tool.ts`
- Create: `apps/runtime/src/autonomy/semantic-tool-catalog.ts`
- Create: `packages/infrastructure/src/sandbox/direct-docker-sandbox.ts`
- Create: `packages/infrastructure/src/sandbox/sandbox-supervisor.ts`
- Test: `packages/application/tests/ports/sandbox.port.test.ts`
- Test: `packages/application/tests/use-cases/invoke-tool.test.ts`
- Test: `apps/runtime/tests/autonomy/governed-aci.test.ts`

**Interfaces:**
- Produces:
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
- Semantic tool IDs are exactly the spec vocabulary: `repo.map_task`, `repo.search`, `repo.symbol`, `repo.references`, `repo.impact`, `repo.history`, `code.inspect`, `code.patch`, `build.check`, `test.targeted`, `test.regression`, `debug.reproduce`, `failure.explain`, `git.status`, `git.diff`, `git.history`, `git.worktree`, `command.run`, `browser.inspect`, `browser.verify`.

- [ ] **Step 1: Write failing port and bypass tests** proving effectful semantic tools cannot execute without job identity, policy result, budget, and a sandbox handle; prove no runtime model path reaches shell/browser/sandbox directly.
- [ ] **Step 2: Run focused tests**
```bash
pnpm vitest run packages/application/tests/ports/sandbox.port.test.ts packages/application/tests/use-cases/invoke-tool.test.ts apps/runtime/tests/autonomy/governed-aci.test.ts
```
Expected: FAIL before implementation.
- [ ] **Step 3: Implement the port, catalog, and minimal hardened direct-Docker/reference adapter**. The reference/hermetic path must remain available. No OpenSandbox/OpenShell production dependency is added yet.
- [ ] **Step 4: Add cancellation, timeout, resource-limit, no-network-by-default, no-Docker-socket, and unknown-effect tests.**
- [ ] **Step 5: Add target-host proof script** `scripts/prove-autonomy-phase1-real.mjs` exercising create -> execute deterministic command -> inspect -> destroy through V31M4, not by calling Docker directly from the proof.
- [ ] **Step 6: Verify and commit**
```bash
pnpm vitest run packages/application/tests/ports/sandbox.port.test.ts packages/application/tests/use-cases/invoke-tool.test.ts apps/runtime/tests/autonomy/governed-aci.test.ts
pnpm check
git diff --check
git commit -am "feat: add governed semantic tool and sandbox boundary"
```

**Hard gate:** every effectful tool is typed, policy-gated, evidenced, cancellable, sandbox-routed, restart-safe, and no model-direct bypass exists.

---

### Task 2: Add the Durable Task Capsule, Checked State Machine, and Task DAG

**Files:**
- Create: `packages/domain/src/entities/task-capsule.ts`
- Create: `packages/contracts/src/task-capsules.schemas.ts`
- Create: `packages/application/src/ports/task-capsule-repository.port.ts`
- Create: `packages/application/src/services/task-transition-policy.ts`
- Create: `packages/application/src/use-cases/create-task-capsule.ts`
- Create: `packages/application/src/use-cases/propose-task-transition.ts`
- Create: `packages/infrastructure/src/database/task-capsule-repository.ts`
- Create: corresponding SQLite migration
- Create: `apps/runtime/src/autonomy/task-manager.ts`
- Test across domain/contracts/application/infrastructure/runtime.

**Interfaces:**
```ts
export type TaskPhase = "investigate" | "plan" | "execute" | "verify" | "repair" | "complete" | "blocked";
export interface TaskTransitionProposal {
  readonly capsuleId: string;
  readonly expectedRevision: number;
  readonly from: TaskPhase;
  readonly to: TaskPhase;
  readonly evidenceIds: readonly EvidenceId[];
  readonly reason: string;
}
export interface TaskCapsuleRepositoryPort {
  getLatest(capsuleId: string, context: OperationContext): Promise<Versioned<TaskCapsule> | null>;
  append(next: TaskCapsule, condition: WriteCondition, context: OperationContext): Promise<Versioned<TaskCapsule>>;
  listByJob(jobId: JobId, request: PortPageRequest, context: OperationContext): Promise<PortPage<TaskCapsule>>;
}
```
The entity must include all fields required by Spec §5 and immutable revision/fingerprint semantics.

- [ ] **Step 1: Write domain tests** for immutable revisions, DAG acyclicity, typed phases, forbidden stale revision, transition attempt bounds, and content fingerprint determinism.
- [ ] **Step 2: Write contract/schema tests** rejecting unknown fields, malformed DAGs, invalid phases, and unsafe JSON.
- [ ] **Step 3: Write repository migration/restart tests** proving latest revision and full history survive process restart.
- [ ] **Step 4: Implement domain -> contracts/port -> use cases -> SQLite -> runtime manager in that dependency order.** The model may only submit `TaskTransitionProposal`; it never persists a capsule directly.
- [ ] **Step 5: Replace the Phase-0 `task state survives restart without chat history` todo with an executable integration regression.**
- [ ] **Step 6: Verify replay** by loading revision 1..N and asserting deterministic reconstruction/fingerprint of current state.
- [ ] **Step 7: Run `pnpm check`, update maps/current-state/evidence, commit**
```bash
git commit -am "feat: add durable task capsule state machine"
```

**Hard gate:** deterministic replay, checked transitions, bounded attempts, DAG validity, crash/restart recovery, and zero chat-history dependency.

---

### Task 3: Add the Deterministic Execution Ledger and Effect Reconciliation

**Files:**
- Create: `packages/domain/src/entities/execution-ledger-entry.ts`
- Create: `packages/application/src/ports/execution-ledger-repository.port.ts`
- Create: `packages/application/src/use-cases/append-execution-ledger.ts`
- Create: `packages/application/src/use-cases/reconcile-execution-effect.ts`
- Create: `packages/infrastructure/src/database/execution-ledger-repository.ts`
- Create: corresponding migration
- Create: `apps/runtime/src/autonomy/effect-reconciler.ts`
- Modify: tool/sandbox finalization path to write ledger entries.

**Interfaces:**
```ts
export type EffectState = "observed" | "attempted" | "confirmed" | "unknown" | "reconciled" | "invalidated";
export interface ExecutionLedgerRepositoryPort {
  append(entry: ExecutionLedgerEntry, context: OperationContext): Promise<void>;
  listForJob(jobId: JobId, request: PortPageRequest, context: OperationContext): Promise<PortPage<ExecutionLedgerEntry>>;
}
```
Every entry records resource identity, pre/post fingerprint when applicable, invocation ID, evidence IDs, validity dependencies, timestamps, and failure signature.

- [ ] **Step 1: Write failing tests** for observation invalidation after file change, duplicate-operation detection, command/test validity scope, unknown post-crash effect, and restart restoration.
- [ ] **Step 2: Implement append-only ledger persistence and invalidation rules without model calls.**
- [ ] **Step 3: Integrate effect reconciliation** so `unknown` blocks blind retry until environment inspection produces `confirmed` or safe-not-applied evidence.
- [ ] **Step 4: Replace the Phase-0 ambiguous-effect todo with executable crash-window coverage.**
- [ ] **Step 5: Verify and commit**
```bash
pnpm vitest run packages/application/tests apps/runtime/tests/autonomy
pnpm check
git commit -am "feat: add execution ledger and effect reconciliation"
```

**Hard gate:** stale observations invalidate correctly, redundant work is detectable, ambiguous effects block retry, and restart reconciliation is deterministic.

---

### Task 4: Implement Manager -> Fresh Executor -> Read-Only Auditor

**Files:**
- Create: `apps/runtime/src/autonomy/task-executor.ts`
- Create: `apps/runtime/src/autonomy/task-auditor.ts`
- Modify: `apps/runtime/src/autonomy/task-manager.ts`
- Modify: `apps/runtime/src/routed-solver.ts`
- Modify: model invocation composition so manager/executor/auditor receive separate context manifests.
- Test: `apps/runtime/tests/autonomy/role-isolation.test.ts`

**Interfaces:**
```ts
export interface RoleInvocationManifest {
  readonly role: "manager" | "executor" | "auditor";
  readonly capsuleRevision: number;
  readonly contextFingerprint: string;
  readonly toolIds: readonly ToolId[];
  readonly readOnly: boolean;
}
```
Auditor receives acceptance contract, final capsule, diff/artifacts, ledger facts, and verification evidence; it does not receive Executor private reasoning and has no effectful tool IDs by default.

- [ ] **Step 1: Write failing tests** proving separate context fingerprints, no Executor-reasoning artifact in Auditor context, Auditor mutation denial, and Auditor ability to reject Executor completion.
- [ ] **Step 2: Implement sequential role orchestration** using one model gateway; do not require simultaneous 27B residency.
- [ ] **Step 3: Persist role invocation manifests and context fingerprints as evidence/artifacts.**
- [ ] **Step 4: Add restart tests at manager, executor, and auditor boundaries.**
- [ ] **Step 5: Replace `auditor cannot mutate candidate` todo, run `pnpm check`, update docs/evidence, commit.**

**Hard gate:** fresh role isolation, read-only auditor default, self-completion rejection, and restart-safe phase handoff.

---

### Task 5: Enforce Evidence Preconditions Before Consequential Actions

**Files:**
- Create: `packages/application/src/services/evidence-precondition.ts`
- Modify: `packages/application/src/use-cases/invoke-tool.ts`
- Modify: `apps/runtime/src/autonomy/semantic-tool-catalog.ts`
- Test: `packages/application/tests/services/evidence-precondition.test.ts`
- Test: `apps/runtime/tests/autonomy/evidence-gating.test.ts`

**Interfaces:**
```ts
export interface EvidenceRequirement {
  readonly evidenceClass: string;
  readonly mandatory: boolean;
}
export interface EvidencePreconditionDecision {
  readonly allowed: boolean;
  readonly missing: readonly EvidenceRequirement[];
  readonly satisfiedEvidenceIds: readonly EvidenceId[];
}
```
Requirements are selected by operation + task class + risk class; there is no universal hard-coded checklist.

- [ ] **Step 1: Write failing tests** where `code.patch` is denied until definition/impact/test evidence required by its task profile exists; ensure low-risk read-only inspection remains allowed.
- [ ] **Step 2: Implement deterministic precondition evaluation using EvidenceRepository/EvidenceLinker inputs.**
- [ ] **Step 3: Return typed actionable denial metadata; do not silently substitute `command.run`.**
- [ ] **Step 4: Prove direct shell/MCP/browser bypass cannot evade the same effect policy.**
- [ ] **Step 5: `pnpm check`, evidence report, commit.**

**Hard gate:** missing task/risk-specific evidence blocks consequential effects fail-closed and tells the agent exactly which evidence classes are missing.

---

### Task 6: Build the Project Intelligence Ensemble and Feed the Existing Context Compiler

**Files:**
- Create: `packages/application/src/ports/project-intelligence.port.ts`
- Create: `packages/application/src/services/project-retrieval-fusion.ts`
- Create infrastructure adapters listed in Planned file ownership.
- Create: `apps/runtime/src/autonomy/retrieval-context-source.ts`
- Modify: supervised software-production context assembly to consume `ProjectIntelligencePort` candidates rather than raw project concatenation when autonomy profile is active.
- Create: `scripts/prove-project-intelligence-real.mjs`
- Test: `apps/runtime/tests/autonomy/project-intelligence.test.ts`

**Interfaces:**
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

- [ ] **Step 1: Freeze a retrieval fixture suite** covering definition->references, trace->implementation, code->tests, requirement->files, architecture->boundaries, and hidden multi-file tasks.
- [ ] **Step 2: Add exact pinned dependencies/adapters one at a time:** Tree-sitter, SCIP/scip-typescript, ast-grep; keep provider-specific types in infrastructure.
- [ ] **Step 3: Implement Git facts and SQLite FTS5 lexical retrieval.**
- [ ] **Step 4: Implement deterministic fusion/RepoMap-style graph relevance** and feed only ranked candidates to the existing Context Compiler; mandatory mission context remains non-evictable.
- [ ] **Step 5: Add optional Qwen3-Embedding-4B semantic adapter behind existing model boundary.** If unavailable, lexical/structural operation must still function.
- [ ] **Step 6: Run matched-resource A/B**: lexical only, structural only, semantic only, fused. Do not promote a reranker unless fused+rereanker beats fused baseline on task success or equal quality with materially lower cost.
- [ ] **Step 7: Replace raw-context path only for the autonomy profile after the ensemble gate passes; preserve hermetic reference fixtures.**
- [ ] **Step 8: `pnpm check`, run real proof where installed substrates exist, update evidence/maps, commit.**

**Hard gate:** the measured fused system beats individual retrieval baselines on aggregate V31M4 task success or a documented quality/latency Pareto criterion, with Context Compiler still final authority.

---

### Task 7: Add Agent Skills Runtime, Retrieval, and Governed Promotion

**Files:**
- Create: `packages/domain/src/entities/skill-profile.ts`
- Create: `packages/contracts/src/skills.schemas.ts`
- Create: `packages/application/src/ports/skill-registry.port.ts`
- Create: `packages/application/src/services/skill-selector.ts`
- Create: `packages/application/src/use-cases/register-skill.ts`
- Create: `packages/application/src/use-cases/promote-skill.ts`
- Create: `packages/infrastructure/src/database/skill-registry.ts`
- Create: `packages/infrastructure/src/skills/agent-skills-loader.ts`
- Create: `apps/runtime/src/autonomy/skill-context-source.ts`

**Interfaces:**
Skill state is exactly `CANDIDATE | SHADOW | TRUSTED | REJECTED`. V31M4 side metadata records task class, preconditions, context recipe, tool permissions, checks, recovery/stop rules, supported harness constraints, evaluation IDs, and promotion history while preserving external `SKILL.md` compatibility.

- [ ] **Step 1: Write failing import tests** for valid Agent Skills layout and rejection of malformed/unsafe scripts/metadata.
- [ ] **Step 2: Implement loader + registry; imported/generated skills always start `CANDIDATE`.**
- [ ] **Step 3: Implement selection that never returns an untrusted skill for production execution unless explicitly in shadow/evaluation mode.**
- [ ] **Step 4: Implement promotion use case requiring held-out comparison, no material regression, positive verified delta or materially lower resource cost, shadow evidence, and governed promotion record.**
- [ ] **Step 5: Verify a malicious skill cannot bypass ToolGateway policy or expand permissions.**
- [ ] **Step 6: Add SkillsBench/SWE-Skills/SkillGen-style local fixtures; `pnpm check`, update docs, commit.**

**Hard gate:** skill trust is evidence-backed; skill files cannot grant themselves permissions or promotion.

---

### Task 8: Add the Multi-Substrate Memory Router

**Files:**
- Create: `packages/domain/src/entities/memory-record.ts`
- Create: `packages/contracts/src/memory.schemas.ts`
- Create: `packages/application/src/ports/memory-repository.port.ts`
- Create: `packages/application/src/services/memory-router.ts`
- Create: `packages/application/src/use-cases/record-memory.ts`
- Create: `packages/application/src/use-cases/retrieve-memory.ts`
- Create: `packages/infrastructure/src/database/memory-repository.ts`
- Create: `packages/infrastructure/src/memory/semantic-memory-index.ts`
- Create: `apps/runtime/src/autonomy/memory-context-source.ts`

**Interfaces:**
```ts
export type MemoryClass = "episodic" | "semantic" | "procedural";
export interface MemoryQueryPlan {
  readonly substrates: readonly ("structured" | "lexical" | "semantic" | "graph" | "runbook")[];
  readonly maxItems: number;
  readonly maxContextTokens: number;
  readonly mayAbstain: true;
}
```
Every durable memory record carries provenance, evidence IDs, scope, creation/last-verified time, temporal validity, confidence/status, invalidators/expiry, and relationship links.

- [ ] **Step 1: Write stale-memory tests** proving an invalidator or expired temporal window prevents current-fact injection.
- [ ] **Step 2: Implement exact structured + FTS retrieval first; add semantic/graph/runbook adapters behind ports rather than as authoritative stores.**
- [ ] **Step 3: Implement deterministic routing/abstention by memory task class and context budget.**
- [ ] **Step 4: Add context-pollution regression:** a larger irrelevant retrieval set must not automatically displace smaller high-validity memory.
- [ ] **Step 5: Replace Phase-0 stale-memory todo, run memory fixture categories for factual, temporal, sequential, and long-trajectory recovery.**
- [ ] **Step 6: `pnpm check`, migration/restart tests, docs/evidence, commit.**

**Hard gate:** stale memory cannot masquerade as current truth, retrieval can abstain, and routing is measurably task-dependent rather than “retrieve everything.”

---

### Task 9: Implement the Quality Floor Controller and Supplemental Verification

**Files:**
- Create: `packages/application/src/services/capability-confidence.ts`
- Create: `packages/application/src/services/quality-floor-controller.ts`
- Modify: `compute-governor.ts`, `diversity-planner.ts`, `capability-calculator.ts`, `champion-selector.ts`, `improvement-policy.ts` only where the new controller composes existing semantics; do not duplicate them.
- Create: `apps/runtime/src/autonomy/quality-floor-runtime.ts`
- Create supplemental RETRACE-style/contextual-rubric verifier adapters behind existing verifier/model boundaries.
- Create: `scripts/prove-autonomy-quality-floor-real.mjs`

**Interfaces:**
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
Use one-sided 95% `z = 1.6448536269514722`. A calibrated 9/10 claim requires lower bound >=0.90 in a sufficiently homogeneous stratum; insufficient evidence forces escalation/abstention.

- [ ] **Step 1: Write exact Wilson math tests** including 0/N, N/N, small-sample, and large-sample cases.
- [ ] **Step 2: Write escalation tests** for `DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE -> SPECIALIST/ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION`.
- [ ] **Step 3: Implement controller as composition over existing services, not a replacement.**
- [ ] **Step 4: Add deterministic-failure supremacy test:** a neural auditor/RETRACE pass cannot override failing compiler/test/security/invariant evidence.
- [ ] **Step 5: Add RETRACE-style patch/problem reconstruction and contextual rubric only as supplemental evidence classes.**
- [ ] **Step 6: Replace Phase-0 quality-floor and deterministic-failure todos with executable regressions.**
- [ ] **Step 7: Run `pnpm check`, target-host Qwen proof where available, update evidence/maps, commit.**

**Hard gate:** calibrated lower-bound eligibility, deterministic escalation, correct abstention, and zero path where neural approval overrides deterministic failure.

---

### Task 10: Run the External Evaluation and Sandbox Backend Campaign

**Files:**
- Create: `packages/application/src/ports/benchmark-runner.port.ts`
- Create: `scripts/prove-sandbox-backends-real.mjs`
- Create: `docs/reviews/autonomy-evaluation-campaign.md`
- Create: `docs/reviews/sandbox-backend-bakeoff.md`
- Add OpenSandbox/OpenShell adapters only on an isolated evaluation branch or behind disabled optional composition until selected.

**Interfaces:**
Evaluation results are immutable artifacts/evidence; Harbor/benchmarks never gain production state access. Sandbox challengers implement the same `SandboxPort` contract.

- [ ] **Step 1: Run matched sandbox tests** against hardened direct Docker, OpenSandbox, and OpenShell where target-host install/support permits: filesystem escape, network egress, resource limits, secret leakage, orphan/child behavior, cancellation, crash recovery, reconciliation, latency, workload compatibility.
- [ ] **Step 2: Select backend only from measured results.** If no challenger clearly beats hardened direct Docker without an unacceptable reliability cost, retain direct Docker and record why.
- [ ] **Step 3: Run external agent evaluation categories**: Harbor/Harbor-Index, Terminal-Bench, RigorBench, Agent Retrieval Bench, SWE-style software tasks, skill tasks, memory tasks, plus V31M4 private restart/governance/evidence fixtures as available on the machine.
- [ ] **Step 4: Record resource-matched baselines and regressions; benchmark score alone cannot promote a component.**
- [ ] **Step 5: `pnpm check` and all target-host proof scripts; update current-state with only verified claims; commit.**

**Hard gate:** no critical hidden regression and one sandbox backend selected from direct target-host evidence rather than documentation.

---

### Task 11: Add Verified Harness and Skill Self-Improvement

**Files:**
- Extend existing promotion/capability/evidence primitives rather than create a second improvement database.
- Create focused laboratory code under an isolated non-production package or `apps` lab consistent with existing repository laboratory rules.
- Create: `docs/reviews/autonomy-self-improvement-proof.md`

**Interfaces:**
Every improvement candidate records: component/version changed, explicit hypothesis, predicted metric movement, training/evaluation task set IDs, held-out result, prior-capability regression result, shadow result, evidence IDs, and final governed promotion decision.

- [ ] **Step 1: Write failing promotion tests** where a candidate improves a new task but regresses a protected prior capability; expected decision is reject.
- [ ] **Step 2: Implement AHE-style observability:** every change has a falsifiable hypothesis and measured outcome.
- [ ] **Step 3: Implement GSME-style diverse candidate archive/search semantics with deterministic measurement/significance owned by V31M4, not the proposer model.**
- [ ] **Step 4: Implement RELAI-style protected-capability constraints so prior accepted capability floors are part of every promotion gate.**
- [ ] **Step 5: Require held-out improvement -> no protected regression -> shadow production -> verified production evidence -> governed promotion.**
- [ ] **Step 6: Prove the improvement lab cannot mutate production policy/evidence/capability state without the normal promotion use case and authorization path.**
- [ ] **Step 7: Run full hermetic regression, external campaign regression subset, update final maps/current-state/evidence, commit.**

**Hard gate:** no candidate can self-certify or promote after improving a new task while materially regressing an already protected capability.

---

## Program Completion Verification

After Task 11, run from a clean checkout/worktree at the exact final commit:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```

Then run all opt-in target-host proofs that the final `docs/current-state.md` claims as verified, including the autonomy, sandbox, project-intelligence, model-routing, general-coding, and autonomous-repair proofs. Record exact versions of Node, pnpm, Ollama, Qwen quant/model identifiers, sandbox backend, Tree-sitter/SCIP/ast-grep dependencies, embedding model if used, and MCP SDK if promoted.

Program completion requires every condition in Spec §21. If any condition is not evidenced, `V31M4-AUTONOMY-001` remains incomplete and `docs/current-state.md` must say so.

## Executor Rules

1. At the beginning of every task, read `AGENTS.md`, the approved spec, this plan, `docs/current-state.md`, and the nearest module README.
2. Verify live HEAD before editing.
3. Use an isolated git worktree for implementation.
4. Execute exactly one task at a time and stop for review at each hard gate.
5. TDD is mandatory; never write production behavior before its failing regression.
6. Do not opportunistically implement a later task while touching a nearby file.
7. Do not substitute a different external framework or model because it is easier to integrate.
8. If current code makes an interface in this plan invalid, stop and record the concrete conflict; preserve the approved architecture rather than silently invent a parallel path.
9. Every task updates `repo_map.md`, `docs/repository-map.md`, and `docs/current-state.md` when ownership/implementation truth changes, plus an immutable review/evidence report.
10. Every task ends with a commit so rollback and review boundaries remain exact.
