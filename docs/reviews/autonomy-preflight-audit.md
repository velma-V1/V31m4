# V31M4 Autonomy Preflight Audit

**Date:** 2026-08-25  
**Scope:** Static repository/architecture/implementation-plan audit before Claude begins `V31M4-AUTONOMY-001 / 1.1.0` implementation.  
**Canonical architecture:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`  
**Canonical plan:** `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`

## Audit objective

Find implementation blockers, contradictory ownership, strict-contract/versioning violations, missing protocol capabilities, stale-state hazards, or plan assumptions that do not match the live repository before product code changes begin.

This review is intentionally skeptical. It does **not** claim the current product test suite passes because this GitHub-only review did not execute the repository locally. Task 0 of the canonical plan must run the real `pnpm check` baseline in Claude's target-host worktree before implementation begins.

## Live repository facts checked

- `ToolGatewayPort` and `invokeTool` already enforce provider-neutral invocation and policy/audit composition.
- Existing public `ToolInvocationResult.status` and `tools.schemas.ts` accept only `completed | failed | cancelled`.
- `WorkspaceManagerPort` already owns create/get/snapshot/seal/discard workspace lifecycle.
- `ResourceBudget` does not express CPU quota, PID limits, network/mount policy, or secret policy.
- `SqliteRecordStore` is the generic authoritative record mechanism; `SqliteRuntimeDatabase.#migrate()` owns actual SQLite schema creation.
- `ModelGatewayPort` is generation-only and has no embedding operation.
- Adapter RPC `1.0.0` is strict and has no agent-turn, task/workspace/sandbox-scoped tool, reasoning-policy, or embedding capability.
- `CONTRACT_SCHEMA_VERSION` and `ADAPTER_PROTOCOL_VERSION` are both exact `1.0.0` constants today.
- The live local Ollama adapter is one-shot: 64 KiB prompt ceiling, `think:false`, structured legacy JS/change-manifest output, and no interactive tool-call loop.
- Existing `EvidenceRecord` already defines authoritative evidence kinds/statuses; autonomy evidence gating should compose this rather than create a second truth taxonomy.
- Existing Layer-8 `ProcessSupervisor` can supervise normal foreground child processes with bounded environment/output/shutdown behavior.
- `pnpm-workspace.yaml` currently allows build scripts only for esbuild, so new native dependencies require explicit supply-chain/build-script review.

## Hidden issues found and corrected

### 1. Sandbox isolation was under-specified

The first plan reused `ResourceBudget` as if it covered isolation. It does not. The v2 spec/plan now adds an application-local typed `SandboxIsolationPolicy` for CPU, PID, network, mount, privilege, capability, Docker-socket, and ambient-secret rules while preserving the existing strict public `ResourceBudget` contract.

`writableWorkspaceOnly` now means no additional writable host mounts; bounded ephemeral sandbox-internal tmp/cache/HOME storage remains allowed so build/test tools are not broken by the security boundary.

### 2. Workspace authority could have been duplicated

The original semantic ACI exposed `git.worktree`. That conflicted with existing `WorkspaceManagerPort` and risked exposing host `.git` authority. The v2 architecture removes model-facing worktree creation. Trusted V31M4 runtime code owns workspace lifecycle; the model receives only the assigned workspace and read-only Git inspection operations plus governed patch/build/test operations.

### 3. Public runtime contracts were at risk of accidental mutation

The first plan proposed new public task/skill/memory schemas without a negotiated runtime API version. V31M4 strict versioning forbids this. The v2 design keeps these concepts internal by default and leaves runtime API `1.0.0` untouched. Any later public endpoint requires a separate negotiated runtime API minor version and compatibility tests.

### 4. Adapter protocol 1.0 cannot carry the required autonomy semantics

Strict adapter RPC 1.0 cannot carry structured agent turns, task/workspace/sandbox scope, reasoning policy, or embedding requests. The v2 design adds a side-by-side adapter protocol `1.1.0` and explicitly preserves `ADAPTER_PROTOCOL_VERSION = "1.0.0"` and the existing v1 schemas. Claude must not simply bump the global constant or mutate the v1 union.

### 5. The model still had no interactive tool loop

This was the largest functional omission. The current Ollama adapter is one-shot and cannot use the new semantic tools iteratively. The v2 plan adds a runtime-owned structured `AgentTurn` loop (`tool_call | finish | defer`) and adapter-protocol-1.1 agent invocation. Tool calls are validated and executed by V31M4; the model never calls tools directly. Private chain-of-thought is neither requested as an output contract nor persisted as evidence/memory.

### 6. Current model adapter artificially caps the stronger local model

The current adapter hard-codes a 64 KiB prompt ceiling and `think:false`. The v2 plan preserves legacy behavior but adds task/role-aware provider-neutral reasoning policy for the autonomy path, an explicit fail-closed byte ceiling coordinated with Context Compiler/token budgets, and target-host 32K-context acceptance first with 64K only after measured evidence.

### 7. Embeddings could not honestly use the generation gateway

`ModelGatewayPort` has no embedding semantics. The v2 plan introduces a provider-neutral `EmbeddingGatewayPort` and adapter-1.1 embedding capability rather than overloading generation calls. Semantic embeddings remain optional/on-demand and must beat non-semantic retrieval under matched resources.

### 8. Project Intelligence could become stale after edits

A ProjectId-only index is insufficient for an autonomous coding loop. The v2 design scopes every query/index to ProjectId + TaskId + assigned workspace + snapshot fingerprint and requires stale cache rejection/rebuild after changes.

### 9. Derived indexes were at risk of becoming shadow truth

Project/memory lexical/vector/graph indexes are now explicitly rebuildable caches. Authoritative task/memory/evidence state remains in V31M4 records. Cache corruption/deletion must not erase canonical truth.

### 10. Task Capsule revision semantics could collide with store revision semantics

The v2 design explicitly distinguishes logical `capsuleRevision` from `Versioned<T>.revision`. Immutable capsule revisions and the mutable head are written atomically through the existing record-store/unit-of-work pattern.

### 11. Task Capsule could have grown without bound

The v2 design makes the capsule bounded and referential. Detailed history lives in Ledger/evidence; the capsule carries only bounded current state plus references. Task DAG size and collections receive domain ceilings.

### 12. Ledger reconciliation states were ambiguous

The original generic `reconciled` state was replaced with explicit append-only event kinds: observation, check_result, effect_attempt, effect_confirmation, effect_nonapplication, invalidation, failure, and reconciliation_indeterminate. Unknown effects do not modify public v1 tool status and cannot be blindly retried.

### 13. Evidence gating could have created a second taxonomy

The v2 design composes existing `EvidenceRecord` semantics with current Ledger observations/check results. It does not create a competing evidence truth store.

### 14. Skill/MCP text and scripts could become an authority injection path

Agent Skills/MCP inputs are explicitly untrusted. Skill scripts never execute during load; they run only as separately authorized sandbox/tool effects. MCP annotations/schemas/output cannot grant permissions or write authoritative state directly.

### 15. Repository/memory retrieval needed instruction-provenance separation

Retrieved source/comments/README/web/MCP/memory text is data, not system instruction. Explicit V31M4 governance documents carry separate authoritative provenance. Memory cannot promote arbitrary remembered text into procedural authority; trusted promoted skills/runbooks own procedure.

### 16. Benchmark infrastructure was incorrectly placed in the production application layer

The original plan proposed `BenchmarkRunnerPort`. The v2 design removes it and creates isolated `apps/autonomy-lab`, which production runtime must not import. Benchmarks challenge V31M4 but do not become a core/runtime dependency or authority.

### 17. Self-improvement needed anti-overfitting and authority protection

The v2 design separates development, validation, and sealed promotion sets; prevents optimization from repeatedly consuming sealed labels/trajectories; protects quality/promotion/evidence/approval/sandbox authority surfaces from autonomous self-edit; requires governed human approval for executable source/harness promotion; activates only through controlled replacement/restart; and retains rollback.

### 18. Capability evidence needed stronger compatibility keys

Quality calibration now includes model-runtime, sandbox/backend, and environment fingerprints in addition to model/quant/task/skill/toolset/retrieval/harness/verification. Incompatible environment/version evidence cannot silently support a current 9/10 floor claim.

### 19. Sandbox selection needed a valid failure outcome

The target-host bake-off may conclude `NO_ACCEPTABLE_BACKEND`. V31M4 must not promote OpenSandbox/OpenShell/direct Docker merely to satisfy the plan. A failed security/reliability gate is a blocker, not a reason to lower the floor.

### 20. New native dependencies need an explicit build/supply-chain gate

Because workspace install scripts are currently tightly allowlisted, parser/indexer/native dependencies must be exactly pinned, license/lockfile checked, Node/WSL compatibility proven, and build scripts explicitly approved when required. Equivalent safer WASM/CLI boundaries are preferred when capability is not reduced.

## Static closeout checklist

- [x] Canonical v2 spec preserves one V31M4 authority.
- [x] Canonical v2 plan preserves runtime API 1.0.
- [x] Adapter 1.1 is side-by-side, not a silent v1 mutation.
- [x] Existing workspace authority is reused.
- [x] Sandbox policy is typed beyond generic resource budget.
- [x] Interactive model/tool loop is explicitly implemented before higher-level agent roles depend on it.
- [x] Embedding semantics have their own provider-neutral boundary.
- [x] Project intelligence is workspace/snapshot scoped.
- [x] Task/Ledger/memory identities and revision semantics are explicit.
- [x] Public v1 tool status remains unchanged.
- [x] Evidence gating reuses existing evidence authority.
- [x] External text/skills/MCP/memory cannot gain instruction authority merely through retrieval.
- [x] Evaluation/self-improvement are isolated from production authority.
- [x] Sandbox bake-off allows no-winner/blocker outcome.
- [x] Supply-chain/native-build risk is a hard implementation gate.

## Verification limitation and next mandatory gate

This review validated repository files and architecture/plan consistency through the connected GitHub source. It did **not** execute `pnpm check`, target-host Docker/WSL/Ollama behavior, or any future autonomy test because no product-code implementation exists yet and this review session does not have the user's local checkout/runtime.

Therefore the first Claude terminal action remains **Task 0**:

```bash
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm check
```

No product implementation begins until that baseline is green or every failure is explained.
