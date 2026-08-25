# V31M4 Autonomy Quality-Floor Implementation Plan — Preflight-Hardened

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `V31M4-AUTONOMY-001 / 1.1.0` so V31M4 can autonomously investigate, use interactive governed tools, verify, repair, recover, and abstain while preserving a calibrated quality floor.

**Architecture:** Extend existing V31M4 authority. Keep runtime API `1.0.0` unchanged. Add internal domain/application autonomy state, a negotiated adapter protocol `1.1.0` beside existing `1.0.0`, a structured agent-turn loop, workspace-scoped project intelligence, and isolated evaluation/improvement labs. External components remain replaceable adapters/caches, never authorities.

**Tech Stack:** TypeScript 7, Node >=22, pnpm 11.17, Vitest 4, existing SQLite/`SqliteRecordStore`, Layer-8 process/RPC supervision, existing model/tool/verifier gateways, Ollama, Tree-sitter-class parser substrate, SCIP/scip-typescript, ast-grep, Git, Playwright, official MCP TypeScript SDK, optional embedding sidecar, sandbox backend selected only by target-host bake-off.

**Spec:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`

## Global Constraints

- Runtime API `1.0.0`, public tool schemas, and adapter protocol `1.0.0` remain immutable.
- New Task Capsule/Ledger/skill/memory state is internal unless a separate negotiated runtime API minor-version decision is approved.
- Adapter protocol `1.1.0` is additive and coexists with `1.0.0`; never mutate strict v1.0 RPC schemas in place.
- Models never certify their own outputs; private reasoning is never evidence or memory.
- External execution never runs inside an authoritative SQLite transaction.
- `WorkspaceManagerPort` owns workspace/worktree lifecycle; the model never creates worktrees.
- `ToolInvocationResult.status` v1 remains `completed | failed | cancelled`; unknown effects live internally in Sandbox/Ledger state.
- No model-direct shell/browser/MCP/sandbox path.
- No second state/policy/evidence/memory/acceptance authority.
- No floating trusted dependency versions.
- Optional external tools/services cannot break hermetic startup.
- Every phase uses TDD, focused verification, full `pnpm check`, source/dependency guards, docs/maps/evidence, then a commit.
- Execute one phase at a time and stop at each hard gate for independent review.

## Locked ownership

```text
packages/domain/src/value-objects/ids.ts
  + TaskId, SandboxId, LedgerEntryId, SkillId, MemoryId

packages/domain/src/entities/
  task-capsule.ts
  execution-ledger-entry.ts
  skill-profile.ts
  memory-record.ts

packages/application/src/ports/
  sandbox.port.ts
  task-capsule-repository.port.ts
  execution-ledger-repository.port.ts
  project-intelligence.port.ts
  embedding-gateway.port.ts
  skill-registry.port.ts
  memory-repository.port.ts

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

packages/contracts/src/
  adapter-rpc-v1_1.schemas.ts
  agent-turn.schemas.ts
  # existing runtime/public 1.0 schemas remain untouched

packages/infrastructure/src/
  sandbox/*
  project-intelligence/*
  embeddings/*
  skills/*
  memory/*
  interoperability/mcp-tool-adapter.ts

apps/runtime/src/autonomy/
  autonomy-composition.ts
  autonomy-state-infrastructure.ts
  semantic-operation-catalog.ts
  agent-turn-loop.ts
  task-manager.ts
  task-executor.ts
  task-auditor.ts
  effect-reconciler.ts
  retrieval-context-source.ts
  skill-context-source.ts
  memory-context-source.ts
  quality-floor-runtime.ts

apps/autonomy-lab/
  isolated external evaluation + harness/skill candidate work

scripts/
  prove-autonomy-phase1-real.mjs
  prove-agent-turn-real.mjs
  prove-project-intelligence-real.mjs
  prove-sandbox-backends-real.mjs
  prove-autonomy-quality-floor-real.mjs
```

### Persistence

Use existing `SqliteRecordStore` unless a measured requirement proves it insufficient.

- Task history: immutable `task_capsule_revision` records + mutable `task_capsule_head` in one transaction.
- Ledger: immutable `execution_ledger_entry` records.
- Skills/memory: authoritative records in generic store.
- Project-intelligence and memory FTS/vector/graph indexes are **derived rebuildable caches**, not authoritative tables.
- If an authoritative schema change is genuinely required, modify `schema.ts` and `SqliteRuntimeDatabase.#migrate()` under the existing migration mechanism and add backup/restore/migration regressions.

---

## Task 0 — Freeze the pre-autonomy baseline

**Files:** Create `docs/reviews/autonomy-baseline-v2.md`; create `apps/runtime/tests/autonomy/autonomy-program-invariants.test.ts`; modify `docs/current-state.md` only to record approved/planned state.

**Produces:** exact pre-implementation evidence and named future invariants.

- [ ] **Step 1: Record live state.**
```bash
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm check
```
Expected: every pre-existing failure is classified before product behavior changes.

- [ ] **Step 2: Add only inventory todos.**
```ts
it.todo("no model-direct effect bypass");
it.todo("task state survives restart without chat history");
it.todo("ambiguous effect is reconciled before retry");
it.todo("agent turn cannot invoke disallowed operation");
it.todo("auditor cannot mutate candidate");
it.todo("stale workspace index cannot enter context");
it.todo("stale memory is not injected as current fact");
it.todo("deterministic failure cannot be overridden by neural verifier");
it.todo("quality floor abstains outside calibrated envelope");
```

- [ ] **Step 3: Write `autonomy-baseline-v2.md`** with HEAD, versions, current `pnpm check`, current supervised-local model behavior, fixed 64 KiB prompt ceiling, `think:false`, current one-shot output behavior, existing tool/workspace boundaries, and no false future capability claim.

- [ ] **Step 4: Verify and commit.**
```bash
pnpm check
git diff --check
git add -A
git commit -m "test: freeze autonomy v2 baseline"
```

**Hard gate:** zero unexplained baseline failure.

---

## Task 1 — Add scoped semantic ACI, `SandboxPort`, and adapter-protocol-1.1 foundation

**Files:** Modify `ids.ts`; create `sandbox.port.ts`; create `semantic-operation-catalog.ts`; create `adapter-rpc-v1_1.schemas.ts`; modify protocol negotiation/adapter invoker infrastructure without changing v1.0 schemas; create `packages/infrastructure/src/sandbox/{sandbox-supervisor,direct-docker-sandbox}.ts`; focused tests; `prove-autonomy-phase1-real.mjs`.

**Interfaces:**
```ts
export type SandboxNetworkPolicy =
  | Readonly<{ mode: "none" }>
  | Readonly<{ mode: "allowlist"; hosts: readonly string[] }>;

export interface SandboxIsolationPolicy {
  readonly maxCpuMillisPerSecond: number;
  readonly maxPids: number;
  readonly network: SandboxNetworkPolicy;
  readonly writableWorkspaceOnly: true;
  readonly readOnlyRootFilesystem: true;
  readonly nonRootUser: true;
  readonly noNewPrivileges: true;
  readonly dropAllCapabilities: true;
  readonly allowHostDockerSocket: false;
  readonly allowAmbientHostSecrets: false;
}

export interface SandboxHandle {
  readonly id: SandboxId;
  readonly jobId: JobId;
  readonly taskId: TaskId;
  readonly workspaceId: string;
  readonly backendId: string;
  readonly status: "ready" | "running" | "degraded" | "stopped";
}

export interface SandboxPort {
  prepare(
    taskId: TaskId,
    jobId: JobId,
    workspace: WorkspaceHandle,
    budget: ResourceBudget,
    policy: SandboxIsolationPolicy,
    context: OperationContext,
  ): Promise<SandboxHandle>;
  execute(
    sandbox: SandboxHandle,
    operation: string,
    parameters: ApplicationJsonObject,
    context: OperationContext,
  ): Promise<Readonly<{
    status: "completed" | "failed" | "cancelled" | "unknown";
    outputArtifactIds: readonly ArtifactId[];
    logArtifactIds: readonly ArtifactId[];
    metadata: ApplicationJsonObject;
  }>>;
  inspect(id: SandboxId, context: OperationContext): Promise<SandboxHandle | null>;
  cancel(id: SandboxId, context: OperationContext): Promise<void>;
  destroy(id: SandboxId, context: OperationContext): Promise<void>;
}
```

`WorkspaceManagerPort` creates the workspace before `SandboxPort.prepare`. The model never creates a worktree.

Semantic operation IDs are exactly:
```text
repo.map_task repo.search repo.symbol repo.references repo.impact repo.history
code.inspect code.patch
build.check test.targeted test.regression
debug.reproduce failure.explain
git.status git.diff git.history
command.run browser.inspect browser.verify
```

Each catalog entry records input/result schema, effect class, risk class, allowed roles, sandbox requirement, resource policy, and evidence-policy ID. `git.worktree` is deliberately absent.

Adapter protocol 1.1 adds task/workspace/sandbox-scoped tool invocation. Keep v1.0 `tool.invoke` unchanged. A scoped internal application request may carry `TaskId`/`SandboxId`; the public runtime API never gains these fields under 1.0.

- [ ] **Step 1: Write failing ID, protocol cross-version, sandbox-policy, and no-worktree-authority tests.** v1.0 must still reject v1.1-only fields.
- [ ] **Step 2: Write bypass tests** proving model/runtime autonomy code cannot reach shell/browser/Docker directly and an effect has no execution path without policy + assigned workspace + sandbox.
- [ ] **Step 3: Implement IDs, `SandboxPort`, operation catalog, exact adapter 1.1 negotiation, and a hermetic reference sandbox.**
- [ ] **Step 4: Implement hardened direct-Docker challenger** through existing Layer-8 process supervision/allowlisted environment. Enforce `--network none` by default, memory/time limits, CPU/PID bounds, non-root, read-only root where compatible, capability drop, no-new-privileges, workspace-only mount, and no Docker socket mount.
- [ ] **Step 5: Preserve unknown effect state internally.** Do not add `unknown` to existing public `ToolInvocationResult.status`.
- [ ] **Step 6: Replace `no model-direct effect bypass` todo with executable coverage.**
- [ ] **Step 7: Target-host proof through V31M4 only.**
```bash
node scripts/prove-autonomy-phase1-real.mjs
pnpm check
git diff --check
git add -A
git commit -m "feat: add scoped semantic ACI and sandbox boundary"
```

**Hard gate:** typed scope/isolation, no model worktree authority, no direct effect bypass, v1.0 compatibility preserved, actual target-host sandbox proof recorded.

---

## Task 2 — Add bounded Task Capsule, checked transitions, and Task DAG

**Files:** Modify `ids.ts`; create `task-capsule.ts`, `task-capsule-repository.port.ts`, `task-transition-policy.ts`, `create-task-capsule.ts`, `propose-task-transition.ts`, `autonomy-state-infrastructure.ts`, `task-manager.ts`; domain/application/runtime tests. Do **not** add a public runtime schema.

**Interfaces:**
```ts
export type TaskPhase =
  | "investigate"
  | "plan"
  | "execute"
  | "verify"
  | "repair"
  | "blocked"
  | "complete";

export interface TaskTransitionProposal {
  readonly taskId: TaskId;
  readonly expectedHeadRevision: string;
  readonly expectedCapsuleRevision: number;
  readonly from: TaskPhase;
  readonly to: TaskPhase;
  readonly evidenceIds: readonly EvidenceId[];
  readonly reason: string;
}
```

`TaskCapsule` has its own logical `capsuleRevision: number` and `ContentHash`; never confuse that with `Versioned<T>.revision` from `SqliteRecordStore`.

Capsule limits are explicit: bounded DAG nodes/dependencies, bounded active hypotheses/risks, bounded text lengths, and references to Ledger/evidence instead of copied unbounded history.

- [ ] **Step 1: Domain failures** for invalid IDs, mutation, stale head revision, wrong logical revision, DAG cycle, duplicate nodes, excessive DAG size, transition without predicate evidence, exhausted attempt limit, and fingerprint instability.
- [ ] **Step 2: Implement Task entity/value validation and deterministic transition service.**
- [ ] **Step 3: Implement repository** with immutable `task_capsule_revision` + mutable `task_capsule_head` atomically in one existing unit-of-work transaction.
- [ ] **Step 4: Restart/replay test** loads history and reconstructs identical latest state/fingerprint without conversation history.
- [ ] **Step 5: Replace task-state todo; run gates.**
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add bounded durable task state machine"
```

**Hard gate:** checked transitions, bounded state, deterministic replay, no revision conflation, restart recovery.

---

## Task 3 — Add deterministic Execution Ledger and reconciliation

**Files:** Modify `ids.ts`; create `execution-ledger-entry.ts`, `execution-ledger-repository.port.ts`, `append-execution-ledger.ts`, `reconcile-execution-effect.ts`, `effect-reconciler.ts`; extend `autonomy-state-infrastructure.ts`; integrate Sandbox finalization; tests.

**Ledger entry kinds:**
```ts
export type LedgerEntryKind =
  | "observation"
  | "check_result"
  | "effect_attempt"
  | "effect_confirmation"
  | "effect_nonapplication"
  | "invalidation"
  | "failure"
  | "reconciliation_indeterminate";
```

Every effect attempt stores an intent fingerprint. Confirm/nonapplication/indeterminate entries reference the attempt. Observation/check entries store resource fingerprints and validity dependencies.

- [ ] **Step 1: Failing tests** for stale observation after patch, check invalidation, duplicate intent detection, crash after effect/before response, restart restore, indeterminate reconciliation blocking retry.
- [ ] **Step 2: Implement append-only ledger in `SqliteRecordStore`.** No model call is involved.
- [ ] **Step 3: Integrate tool/sandbox effect lifecycle:** append attempt before effect; append confirmation only from verified post-state; unknown/indeterminate never maps to silent retry.
- [ ] **Step 4: Replace ambiguous-effect todo.**
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add execution ledger and effect reconciliation"
```

**Hard gate:** no blind replay, stale facts invalidate, repeated no-progress work is detectable, crash reconciliation survives restart.

---

## Task 4 — Add structured agent turns and modernize the local model adapter

**Files:** Create `agent-turn.schemas.ts`; extend adapter protocol 1.1 model schemas/negotiation; extend `ModelGatewayPort` with provider-neutral agent-turn capability while retaining legacy invoke; modify `SupervisedModelGateway`, reference gateways/mocks, `adapters/local-supervised/model-adapter.mjs`; create `agent-turn-loop.ts`; tests; `prove-agent-turn-real.mjs`.

**Agent output:**
```ts
export type AgentTurn =
  | Readonly<{
      kind: "tool_call";
      operation: string;
      parameters: ApplicationJsonObject;
    }>
  | Readonly<{
      kind: "finish";
      summary: string;
    }>
  | Readonly<{
      kind: "defer";
      reason: string;
    }>;
```

No chain-of-thought field exists. Runtime revalidates every model-produced turn even if adapter-side JSON schema validation succeeded.

Adapter protocol 1.1 agent invocation includes a provider-neutral reasoning policy (`disabled | enabled | auto`), agent-turn output contract version, allowed operation IDs, and context budget. v1.0 model invocation is unchanged.

- [ ] **Step 1: Cross-version tests** prove v1.0 remains byte/validation compatible and v1.1-only methods/fields are rejected by v1.0 parsers.
- [ ] **Step 2: Write agent-loop failures** for malformed action, unknown operation, operation not in role allowlist, repeated identical action without new evidence, turn/tool budget exhaustion, oversized context, and model `finish` being treated only as “ready for verification.”
- [ ] **Step 3: Implement runtime loop** `context -> model turn -> validate -> governed operation -> Ledger/evidence -> context rebuild`. The model never calls tools itself.
- [ ] **Step 4: Modernize Ollama adapter.** Preserve legacy branches. For agent protocol, use structured JSON output; make reasoning provider-neutral/task-aware; do not persist thinking text; replace fixed 64 KiB autonomy ceiling with configurable hard byte ceiling plus upstream token budget; oversize fails, never truncates.
- [ ] **Step 5: Target-host A/B Qwen3.8 reasoning modes** and record actual Ollama behavior. Start with a 32K practical context target; only promote 64K after measured target-host evidence.
- [ ] **Step 6: Replace disallowed-operation todo.**
```bash
node scripts/prove-agent-turn-real.mjs
pnpm check
git diff --check
git add -A
git commit -m "feat: add structured autonomous agent turns"
```

**Hard gate:** Qwen can interactively use governed semantic operations through V31M4; legacy verified paths still work; no private reasoning becomes evidence.

---

## Task 5 — Add Manager -> fresh Executor -> independent read-only Auditor

**Files:** Create `select-next-task.ts`, `audit-task-result.ts`, `task-executor.ts`, `task-auditor.ts`; modify `task-manager.ts`, `routed-solver.ts` only where ownership fits; runtime/application tests.

**Role manifest:**
```ts
export interface RoleInvocationManifest {
  readonly role: "manager" | "executor" | "auditor";
  readonly taskId: TaskId;
  readonly capsuleFingerprint: ContentHash;
  readonly contextFingerprint: ContentHash;
  readonly modelId: ModelId;
  readonly allowedOperations: readonly string[];
  readonly skillVersions: readonly string[];
  readonly harnessVersion: string;
  readonly readOnly: boolean;
}
```

- [ ] **Step 1: Deterministic Manager tests** for dependency-ready node selection, blocker respect, stable ordering, no completion mutation.
- [ ] **Step 2: Role-isolation failures:** Auditor gets a fresh prompt artifact, no Executor private reasoning, no write/execute/network-effect operation, and can reject Executor `finish`.
- [ ] **Step 3: Implement sequential roles** through existing routed model selection + Task Capsule/Agent Turn loop. No simultaneous 27B assumption.
- [ ] **Step 4: Persist role/context/tool/skill/model fingerprints as ordinary artifacts/evidence references.**
- [ ] **Step 5: Restart at Manager->Executor and Executor->Auditor boundaries.**
- [ ] **Step 6: Replace auditor todo.**
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add isolated manager executor auditor harness"
```

**Hard gate:** fresh role isolation, read-only audit default, independent rejection, restart-safe handoff.

---

## Task 6 — Gate consequential actions on Evidence + Ledger state

**Files:** Create `evidence-precondition.ts`; modify `invoke-tool.ts`/autonomy semantic executor only where necessary; modify operation catalog; tests.

**Requirements:** use existing `EvidenceKind`/subject/status semantics plus valid Ledger observations/checks. Do not create a parallel free-form evidence truth system.

```ts
export type PreconditionRequirement =
  | Readonly<{
      kind: "evidence";
      allowedEvidenceKinds: readonly EvidenceKind[];
      subjectType: string;
      requirePassed: true;
    }>
  | Readonly<{
      kind: "ledger_observation";
      resourceKind: string;
      requireCurrentFingerprint: true;
    }>;
```

- [ ] **Step 1:** failing `code.patch` until current definition/impact/test prerequisites are satisfied; stale observation must not satisfy.
- [ ] **Step 2:** raw `command.run`, browser, and MCP paths must hit equivalent operation/risk preconditions and cannot be used as a bypass.
- [ ] **Step 3:** implement deterministic operation + task class + risk policy; denial lists missing requirements and is non-retryable until new evidence/state exists.
- [ ] **Step 4:** verify/read operations remain available when safe so the agent can acquire missing evidence.
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: gate consequential effects on evidence"
```

**Hard gate:** missing/stale evidence blocks effects without blocking the investigation path needed to satisfy it.

---

## Task 7 — Add workspace-scoped Project Intelligence + `EmbeddingGatewayPort`

**Files:** Create `project-intelligence.port.ts`, `embedding-gateway.port.ts`, `project-retrieval-fusion.ts`; create infrastructure parser/SCIP/ast-grep/Git/lexical/semantic adapters; extend adapter protocol 1.1 for embeddings if the selected local adapter uses RPC; create `retrieval-context-source.ts`; tests; `prove-project-intelligence-real.mjs`.

**Interfaces:**
```ts
export interface ProjectIntelligenceScope {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly workspaceId: string;
  readonly snapshotFingerprint: ContentHash;
}

export type ProjectQueryKind =
  | "map_task"
  | "search"
  | "symbol"
  | "references"
  | "impact"
  | "history"
  | "related_tests";

export interface ProjectQuery {
  readonly kind: ProjectQueryKind;
  readonly text?: string;
  readonly locators?: readonly string[];
  readonly limit: number;
}

export interface ProjectIntelligencePort {
  query(
    scope: ProjectIntelligenceScope,
    query: ProjectQuery,
    context: OperationContext,
  ): Promise<readonly ProjectFact[]>;
}
```

`ProjectFact` includes source locator, source/snapshot fingerprint, score, source class, and provenance. Retrieved repo/web/MCP text is tagged untrusted content; V31M4 governance docs have explicit authoritative provenance.

- [ ] **Step 1: Freeze retrieval fixtures** for definition->references, trace->implementation, code->tests, requirement->files, architecture->boundaries, dirty-workspace change, and lexical-failure task.
- [ ] **Step 2: Supply-chain/compatibility probe before dependencies.** Exact pin/license/Node22+WSL checks; if native package scripts are required, explicitly review/update `pnpm-workspace.yaml allowBuilds`; prefer equivalent WASM/CLI isolation when safer.
- [ ] **Step 3: Implement structural and Git facts** keyed to current workspace snapshot; stale cache fingerprint must be rejected/rebuilt.
- [ ] **Step 4: Implement lexical cache as derived/rebuildable state, not authoritative DB truth.**
- [ ] **Step 5: Implement deterministic fusion/RepoMap-style ranking.**
- [ ] **Step 6: Implement provider-neutral embedding gateway** instead of pretending generation `ModelGatewayPort` is an embedding API. Semantic sidecar is optional/on-demand.
- [ ] **Step 7: Matched-resource A/B** lexical vs structural vs semantic vs fused; reranker remains challenger until it adds verified value.
- [ ] **Step 8: Only after A/B, feed candidates to existing Context Compiler; mandatory mission/governance content remains non-evictable.**
- [ ] **Step 9: Replace stale-workspace-index todo.**
```bash
node scripts/prove-project-intelligence-real.mjs
pnpm check
git diff --check
git add -A
git commit -m "feat: add workspace-scoped project intelligence"
```

**Hard gate:** current-workspace correctness, stale-index refusal, measured retrieval improvement, no instruction-provenance confusion.

---

## Task 8 — Add Agent Skills, MCP interoperability, and governed skill promotion

**Files:** Create `skill-profile.ts`, `skill-registry.port.ts`, `skill-selector.ts`, `register-skill.ts`, `promote-skill.ts`, `agent-skills-loader.ts`, `mcp-tool-adapter.ts`, `skill-context-source.ts`; extend autonomy state infra; tests. Do **not** add a public runtime `skills.schemas.ts` under API 1.0.

Trust states use repository style lowercase strings: `candidate | shadow | trusted | rejected`.

- [ ] **Step 1: Import failures** for path escape, malformed skill layout, duplicate ID/version, unsupported dependency, self-declared elevated permission, and executable script during load.
- [ ] **Step 2: Implement loader** preserving Agent Skills compatibility while treating text/assets/scripts as untrusted package content.
- [ ] **Step 3: Skill scripts never execute in loader.** Any script run is a separate governed semantic tool/sandbox effect with the skill's approved operation/permission set.
- [ ] **Step 4: Implement `SqliteSkillRegistry`; imports/generated skills begin `candidate`.**
- [ ] **Step 5: Trusted production selector cannot return candidate/shadow/rejected skill unless explicitly in evaluation/shadow mode.**
- [ ] **Step 6: Promotion:** held-out incumbent comparison -> no material regression -> positive verified delta/equal quality materially cheaper -> shadow evidence -> governed promotion.
- [ ] **Step 7: Pin current official MCP TS SDK exactly.** External tool catalogs are translated into V31M4 semantic/tool definitions; annotations/schemas never grant authority.
- [ ] **Step 8: MCP adversarial tests** for prompt-injection output, malformed schema, oversized output, permission expansion, direct state-write attempt, timeout/cancel, remote/local process failure.
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add governed skills and MCP adapter"
```

**Hard gate:** skills/MCP cannot grant themselves trust or permissions and cannot bypass tool/sandbox/evidence authority.

---

## Task 9 — Add multi-substrate Memory Router

**Files:** Create `memory-record.ts`, `memory-repository.port.ts`, `memory-router.ts`, `record-memory.ts`, `retrieve-memory.ts`, `semantic-memory-index.ts`, `memory-context-source.ts`; state infra; tests. Do **not** add public runtime `memory.schemas.ts` under API 1.0.

**Interfaces:**
```ts
export type MemoryClass = "episodic" | "semantic" | "procedural";
export type MemorySubstrate =
  | "structured"
  | "lexical"
  | "semantic"
  | "graph"
  | "runbook";

export interface MemoryQueryPlan {
  readonly substrates: readonly MemorySubstrate[];
  readonly maxItems: number;
  readonly maxContextTokens: number;
  readonly mayAbstain: true;
}
```

- [ ] **Step 1: Invalid/stale/expired memory tests** including stale fact with high semantic similarity and untrusted external text attempting to act as instruction.
- [ ] **Step 2: Implement authoritative memory records in `SqliteRecordStore`.**
- [ ] **Step 3: Derived lexical/vector/graph indexes are rebuildable caches only.** Corrupt/delete cache and prove canonical records survive/rebuild.
- [ ] **Step 4: Deterministic router supports abstention, validity filtering, task-class routing, and token budget before ranking.**
- [ ] **Step 5: Procedural instruction authority references trusted Skill/Runbook IDs; arbitrary remembered text cannot become procedure.**
- [ ] **Step 6: Context-pollution regression** proves more memory cannot displace more valid/current evidence.
- [ ] **Step 7: Replace stale-memory todo and run restart/factual/temporal/sequential/long-history fixtures.**
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add routed evidence-backed memory"
```

**Hard gate:** stale memory cannot masquerade as truth/instruction; retrieval can abstain; canonical state survives index failure.

---

## Task 10 — Add calibrated Quality Floor Controller + supplemental verification

**Files:** Create `capability-confidence.ts`, `quality-floor-controller.ts`, `quality-floor-runtime.ts`; compose existing compute/diversity/capability/evidence/champion/improvement services; add supplemental verifier adapters through existing boundaries; tests; `prove-autonomy-quality-floor-real.mjs`.

**Stratum:**
```ts
export interface CapabilityStratum {
  readonly modelId: ModelId;
  readonly modelVariant: string;
  readonly modelRuntimeVersion: string;
  readonly taskClass: string;
  readonly difficultyBand: string;
  readonly skillVersion: string | null;
  readonly toolsetVersion: string;
  readonly retrievalVersion: string;
  readonly harnessVersion: string;
  readonly verificationClass: string;
  readonly sandboxVersion: string | null;
  readonly environmentFingerprint: ContentHash;
}
```

`wilsonLowerBound(successes, trials, z=1.6448536269514722)` uses one-sided 95%. A calibrated 9/10 claim requires lower bound >=0.90 in a compatible, recent, homogeneous stratum. Version/environment mismatch cannot borrow stale success evidence.

- [ ] **Step 1: Exact Wilson math tests** for invalid, zero, all-success, mixed, small/large N. Verify 25/25 is the first all-success sample count to clear 0.90 at the specified z; do not add a weaker arbitrary small-N override.
- [ ] **Step 2: Ladder tests:** `DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE -> SPECIALIST_OR_ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION`.
- [ ] **Step 3: Compose existing services.** Do not create a second champion/capability/evidence system.
- [ ] **Step 4: Deterministic-failure supremacy:** compiler/test/security/policy/invariant fail cannot be overridden by RETRACE-style reasoning, rubric, or Auditor.
- [ ] **Step 5: Add RETRACE-style patch/problem reconstruction and contextual rubric only as supplemental evidence.**
- [ ] **Step 6: Replace quality-floor and deterministic-failure todos.**
```bash
node scripts/prove-autonomy-quality-floor-real.mjs
pnpm check
git diff --check
git add -A
git commit -m "feat: enforce calibrated autonomy quality floor"
```

**Hard gate:** conservative calibrated eligibility, escalation/abstention, zero neural override of deterministic failure.

---

## Task 11 — Create isolated evaluation lab and run sandbox backend bake-off

**Files:** Create `apps/autonomy-lab/package.json`, `apps/autonomy-lab/src/*`, tests/fixtures, `scripts/prove-sandbox-backends-real.mjs`, `docs/reviews/sandbox-backend-bakeoff.md`, `docs/reviews/autonomy-evaluation-campaign.md`; optional OpenSandbox/OpenShell adapters behind `SandboxPort`.

The lab is not imported by `apps/runtime` or application/domain production code. Do not add `BenchmarkRunnerPort` to the application layer.

- [ ] **Step 1: Add dependency-boundary test** proving production runtime/packages do not import `apps/autonomy-lab`.
- [ ] **Step 2: Implement optional challengers only behind disabled configuration.**
- [ ] **Step 3: If OpenSandbox challenger is enabled:** pinned foreground child under Layer 8; minimal env; allocated loopback port; generated secret; health + real create/exec/destroy readiness; bounded restart; orphan/reality reconciliation; no control endpoint/secret inside agent sandbox.
- [ ] **Step 4: Same target-host sandbox suite for every candidate:** filesystem escape, network egress, resource/PID limits, secret leakage, Docker-socket absence, child/orphan behavior, cancel/timeout, server/backend crash, unknown-effect reconciliation, latency, required workload compatibility.
- [ ] **Step 5: Allow `NO_ACCEPTABLE_BACKEND`.** Do not promote a backend merely because a challenger exists.
- [ ] **Step 6: External matched-resource campaign** across available Harbor/Harbor-Index, Terminal-Bench, RigorBench, SWE-style, retrieval, skills, memory, and V31M4 private recovery/governance tasks. Lab writes artifacts/evaluation evidence only.
```bash
node scripts/prove-sandbox-backends-real.mjs
pnpm check
git diff --check
git add -A
git commit -m "test: complete autonomy acceptance and sandbox bakeoff"
```

**Hard gate:** no critical hidden regression and either a proven backend or an explicit blocked/no-acceptable-backend outcome.

---

## Task 12 — Add verified no-regression self-improvement laboratory

**Files:** Extend only `apps/autonomy-lab` plus existing promotion/capability/evidence use cases where semantics already fit; create `docs/reviews/autonomy-self-improvement-proof.md`. Production runtime does not run autonomous improvement loops.

Candidate record includes component/version, isolated worktree, falsifiable hypothesis, predicted metric change, development set, validation set, sealed promotion set ID, held-out result, protected-capability regression result, shadow result, evidence IDs, approval ID when executable behavior changes, activation version, rollback version.

- [ ] **Step 1: Three-way data separation test:** optimizer can inspect development; selector can inspect validation; sealed promotion labels/trajectories are inaccessible until final gate.
- [ ] **Step 2: Rejection test:** new-task gain + material protected-capability regression -> denied.
- [ ] **Step 3: AHE-style observability** records hypothesis and measured outcome.
- [ ] **Step 4: GSME-style diverse candidates** while deterministic V31M4 owns measurement/significance.
- [ ] **Step 5: RELAI-style protected-capability constraints** are mandatory for promotion.
- [ ] **Step 6: Protect authority surfaces.** Self-improvement cannot autonomously modify Quality Floor Controller, approval authority, evidence authority, sandbox policy, or promotion policy.
- [ ] **Step 7: Executable source/harness change requires existing governed human approval.** Never hot-patch running authority; activate only through controlled restart/replacement with old version retained.
- [ ] **Step 8: Automatic rollback test** on startup/acceptance failure after activation.
```bash
pnpm check
git diff --check
git add -A
git commit -m "feat: add verified no-regression autonomy lab"
```

**Hard gate:** no self-certification, no adaptive holdout leakage, no authority self-edit, no executable promotion without approval/rollback.

---

## Final clean-checkout acceptance

At final program commit, create a fresh isolated worktree and run:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```

Run every target-host proof that `docs/current-state.md` claims: Phase 1 sandbox/ACI, agent turn/Qwen, project intelligence, selected sandbox backend, quality floor, model routing, general coding, autonomous repair. Record exact Node/pnpm/Ollama/Qwen quant, adapter protocol, sandbox backend, parser/SCIP/ast-grep versions, embedding model if promoted, Playwright/browser build if production browser tooling is promoted, MCP SDK, and all native-build approvals/checksums.

`V31M4-AUTONOMY-001` is complete only when every canonical spec completion condition has evidence. A missing target-host dependency or failed hard gate remains explicitly incomplete.

## Executor rules

1. Read `AGENTS.md`, canonical v2 spec, this v2 plan, `docs/current-state.md`, architecture/dependency/repository maps, and nearest README before each phase.
2. Verify live branch/HEAD/status first.
3. Use an isolated git worktree.
4. One phase at a time; stop for independent review at the hard gate.
5. TDD before product behavior.
6. Do not implement later phases opportunistically.
7. Preserve runtime API 1.0 and adapter protocol 1.0 exactly.
8. If a planned interface conflicts with live code, report the exact conflict rather than creating a shadow abstraction.
9. Update `repo_map.md`, `docs/repository-map.md`, and `docs/current-state.md` only when implementation truth changes; record immutable phase evidence.
10. End each phase in one or more small reviewable commits, with the final phase commit only after its gate is green.
