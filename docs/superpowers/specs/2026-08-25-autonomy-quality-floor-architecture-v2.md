# V31M4 Autonomy Quality-Floor Architecture — Preflight-Hardened

**Status:** Approved architecture expansion / canonical implementation source of truth  
**Date:** 2026-08-25  
**Supersedes:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture.md`  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`  
**Program:** `V31M4-AUTONOMY-001 / 1.1.0`  
**Runtime API:** remains `1.0.0` unless a separate negotiated API-version decision is approved  
**Initial local acceptance model:** Qwen3.8-27B Q4_K_M behind provider-neutral model boundaries

## 1. Purpose

This is the pre-implementation freeze for the autonomy-quality-floor program. It preserves the approved goal and incorporates the final repository audit against the live V31M4 interfaces, persistence model, adapter protocol, contract-versioning rules, workspace authority, and current local model adapter.

The target is a local-first autonomous production system that compensates for model limitations by externalizing everything that can be deterministic, stateful, reusable, bounded, independently verifiable, recoverable, or routed to a stronger substrate.

V31M4 may deliver only a result whose acceptance contract is satisfied by valid evidence. When the required quality floor cannot be established, the system returns the correct non-success outcome (`UNVERIFIED`, `PARTIAL`, `FAILED`, or `NO_VERIFIED_SOLUTION`) rather than lowering the floor.

A `10/10` result is an operational classification: all mandatory criteria are evidenced, all applicable deterministic checks pass, no forbidden change or unresolved critical risk remains, no effect is ambiguously unreconciled, independent/adversarial verification finds no contradiction, and no known defect remains. It is not a claim that arbitrary software can be proven metaphysically flawless.

## 2. One-authority rule

V31M4 remains the sole authority for:

- mission/task state and Task DAG transitions
- workspace assignment and lifecycle
- tool/sandbox permissions
- policy and approvals
- evidence and acceptance
- capability measurements and quality-floor claims
- memory validity
- skill trust/promotion
- harness/self-improvement promotion
- final delivery

External projects provide replaceable mechanisms only. No agent framework, sandbox server, MCP server, memory product, skill server, benchmark harness, model runtime, or indexer may become a second source of authoritative state.

## 3. Preserved invariants

1. Models never certify their own work. Model confidence, size, private reasoning, or self-reported completion is not evidence.
2. Deterministic checks outrank neural judgment.
3. Missing mandatory evidence is not success.
4. Consequential effects fail closed on policy, task scope, resource limits, and evidence preconditions.
5. Conversation history is never authoritative state.
6. Fresh model contexts are deliberate and hand off through durable state/evidence.
7. Raw repository/web/MCP/memory content is untrusted data, not privileged instruction text.
8. High-level semantic operations are preferred over shell plumbing.
9. No single retrieval or memory substrate is presumed universally best.
10. External components are pinned, replaceable, and target-host validated before production promotion.
11. Unknown post-crash effects are reconciled before retry.
12. Self-improvement never self-certifies and cannot rewrite its own promotion/quality authority.

## 4. Contract/versioning rule

The existing runtime API `1.0.0`, public tool contracts, and adapter protocol `1.0.0` are immutable.

### Runtime API

Task Capsule, Ledger, memory, and skill trust state are internal domain/application concepts during this program. Do **not** add them to the public runtime API merely because they exist internally. If a public endpoint is later required, stop and follow `docs/contract-versioning.md`: introduce a separately negotiated runtime API minor version (normally `1.1.0`), preserve `1.0.0`, add cross-version tests, and never mutate an existing strict schema in place.

### Adapter protocol

Autonomous agent turns, task-scoped tool execution, and embedding calls require semantics absent from adapter protocol `1.0.0`. Add a separately negotiated adapter protocol `1.1.0` while retaining `1.0.0` for legacy workflows. Do not add fields to the strict v1.0 RPC schemas.

Protocol 1.1 introduces versioned provider-neutral capabilities for:

- structured agent-turn model invocation
- task/workspace/sandbox-scoped tool invocation
- embedding invocation when a semantic sidecar is configured

Legacy `model.invoke` / `tool.invoke` 1.0 behavior remains available for existing verified paths.

## 5. Durable identifiers

New authoritative concepts use domain-validated branded IDs, following the repository's existing durable-ID rule. Add only the IDs actually required:

- `TaskId`
- `SandboxId`
- `LedgerEntryId`
- `SkillId`
- `MemoryId`

Reuse `JobId`, `ProjectId`, `ArtifactId`, `EvidenceId`, `ModelId`, `ToolId`, and `ContentHash`. Do not use unvalidated strings for durable identity at application boundaries.

## 6. Task Capsule and checked state machine

Each root/child task has a native V31M4 Task Capsule. StateM-style checked transitions and LongHorizon-style explicit state handoff are mechanisms, not imported orchestrators.

A capsule revision contains bounded current state and **references** to large histories, not ever-growing copied logs. Detailed observations/effects belong in the Execution Ledger; evidence belongs in the evidence store.

Required state includes:

- `TaskId`, owning `JobId`, `ProjectId`, optional parent `TaskId`
- logical capsule revision number and previous capsule fingerprint
- exact objective and acceptance-criterion references
- constraints and forbidden changes
- typed phase/state
- bounded Task DAG node/dependency/blocker state
- current bounded plan and next action
- verified fact/evidence references
- explicit assumption/hypothesis references
- decision references
- assigned workspace/sandbox/checkpoint references
- current change/diff artifact references
- active skill/model/harness/toolset/context fingerprints
- unresolved risks/questions
- attempt/escalation counters and stop condition

All collections and strings are bounded by domain validation. The Task DAG has an explicit node ceiling and must be acyclic.

The model proposes a transition. V31M4 validates machine-checkable predicates, evidence requirements, expected head revision, logical capsule revision, and attempt bounds before atomically appending the immutable new revision and advancing the mutable head.

### Persistence

Reuse `SqliteRecordStore`:

- immutable `task_capsule_revision` records with unique revision-record IDs
- one mutable `task_capsule_head` per TaskId
- history append + head update in the same existing unit-of-work transaction

Do not confuse `Versioned<T>.revision` (store optimistic-concurrency revision) with the capsule's logical revision number.

## 7. Execution Ledger and effect reconciliation

The Ledger is deterministic and append-only. It records environment reality separately from task intent.

Use explicit entry kinds rather than a vague `reconciled` state:

- observation
- check_result
- effect_attempt
- effect_confirmation
- effect_nonapplication
- invalidation
- failure
- reconciliation_indeterminate

An effect attempt has an intent fingerprint. Confirmation/nonapplication entries reference the attempt. If the post-crash result cannot be proven, `reconciliation_indeterminate` blocks blind retry and completion.

Changing a resource invalidates dependent observations/check results by fingerprint/dependency reference. Repeated identical actions can be detected without another model call.

Do **not** add `unknown` to the existing public v1 `ToolInvocationResult.status`; that would break strict v1 contracts. Unknown effect state remains internal in the Sandbox/Ledger layer and is surfaced as a non-success/integrity condition until reconciled.

## 8. Workspace and sandbox authority

`WorkspaceManagerPort` remains the sole workspace/worktree lifecycle authority. The trusted runtime creates, snapshots, seals, and discards workspaces. The model does not create worktrees and never receives host `.git` authority.

Remove model-facing `git.worktree` from the semantic ACI. The model may use read-only `git.status`, `git.diff`, and `git.history` within its assigned workspace.

### `SandboxPort`

`SandboxPort` consumes an existing `WorkspaceHandle` and returns a typed `SandboxHandle`. It must not invent a second workspace lifecycle.

`ResourceBudget` remains unchanged because it is already part of strict public contracts. Sandbox-only limits that ResourceBudget cannot express are application-local typed policy, not untyped JSON. At minimum the sandbox isolation policy expresses:

- CPU quota/weight
- PID/process limit
- network mode (`none` by default; explicit allowlist when granted)
- workspace-only writable mount policy
- read-only root filesystem where backend supports it
- non-root user
- no-new-privileges
- capability drop
- host Docker socket forbidden
- ambient host secrets forbidden

RAM and wall-clock limits reuse `ResourceBudget` where applicable.

The direct Docker/OpenSandbox/OpenShell adapters sit behind the same port. Backend selection occurs only after target-host bake-off; the bake-off may conclude **no candidate meets the floor**, which blocks promotion rather than forcing a winner.

If OpenSandbox is selected, V31M4 supervises its pinned foreground server through Layer 8 with a minimal environment, loopback-only allocated port, generated secret, readiness create/exec/destroy smoke test, restart budget, and reality reconciliation. The untrusted sandbox never receives the OpenSandbox control endpoint or secret.

## 9. Semantic Agent-Computer Interface

The model-facing semantic operation vocabulary is intentionally small:

```text
repo.map_task
repo.search
repo.symbol
repo.references
repo.impact
repo.history
code.inspect
code.patch
build.check
test.targeted
test.regression
debug.reproduce
failure.explain
git.status
git.diff
git.history
command.run
browser.inspect
browser.verify
```

These are **operation IDs**, not necessarily one ToolProfile per operation. V31M4 owns a `SemanticOperationDefinition` registry containing:

- operation ID
- input/result schema version
- effect class (`read`, `workspace_write`, `process_execute`, `network_read`, `network_effect`)
- risk class
- sandbox requirement
- allowed role(s)
- evidence-precondition policy ID
- resource policy

Role permissions are operation-level, not only `ToolId`-level. Raw `command.run` is an explicitly higher-risk escape hatch and cannot bypass a stronger semantic operation's evidence gate.

`code.patch` requires the expected current file/symbol fingerprint and allowed-path scope so stale edits fail rather than silently overwriting newer work.

## 10. Structured agent-turn protocol and local model harness

The live Ollama adapter is currently one-shot, has a 64 KiB prompt ceiling, forces `think: false`, and only emits legacy JS/change-manifest output. The autonomy program must remove this bottleneck rather than merely placing tools beside it.

### Agent turn

Add a provider-neutral `AgentTurn` output contract with only bounded actionable output, for example:

- `tool_call` — one allowed semantic operation + validated parameters
- `finish` — declares the current bounded task ready for independent verification; it does not certify success
- `defer` — cannot proceed with current evidence/capability

Do not request or persist private chain-of-thought. Reasoning traces, if produced by a model runtime, are ephemeral and never evidence/memory. Persist final structured turns, tool observations, usage, and context fingerprints only.

The runtime owns the loop:

```text
fresh context -> model agent turn -> validate -> governed operation -> ledger/evidence
     ^                                                        |
     +---------------- context rebuild / next turn -----------+
```

The model never invokes tools directly.

### Bounds and no-progress detection

- max turns/tool calls come from approved budgets
- repeated identical/no-new-evidence actions are detected from Ledger fingerprints
- cycles trigger fresh-context repair/alternate strategy/escalation or stop
- any operation not allowed by the role manifest is rejected before execution

### Local adapter modernization

For protocol 1.1-capable adapters:

- make reasoning mode provider-neutral and task/role-aware (`disabled`, `enabled`, `auto`), then translate inside the adapter
- target-host A/B the actual Qwen3.8/Ollama behavior; do not assume `think` semantics without proof
- remove the fixed 64 KiB autonomy bottleneck; use an explicit hard byte ceiling plus Context Compiler/token budgets and fail closed on oversize rather than truncating
- start with practical 32K-context acceptance on the target PC; evaluate 64K only if measured quality/latency/resource evidence justifies it
- retain legacy verified invocation behavior for existing workflows

## 11. Manager / Executor / Auditor

Use native V31M4 state/jobs/gateways:

- **Manager:** selects one dependency-ready bounded TaskId and the role/context/skill/operation policy. It cannot mark completion.
- **Executor:** receives a fresh bounded context and operates only on the selected TaskId/workspace.
- **Auditor:** receives a separate fresh context, is read-only by default, sees acceptance criteria, final artifacts/diff, Ledger facts, and verification evidence, but never treats Executor reasoning as evidence.

Roles run sequentially on constrained hardware. Role manifests contain operation-level permissions and full context/model/skill/harness fingerprints.

## 12. Evidence-conditioned effects

Evidence gating consumes both:

- immutable `EvidenceRecord` facts, using existing `EvidenceKind`/subject/status semantics
- current valid Ledger observations/check results

Do not invent a parallel free-form evidence taxonomy.

A precondition is a deterministic predicate over operation + task class + risk class + current scope. Missing predicates produce a typed actionable denial. Inspection can remain read-only while patch/execute/network effects are blocked.

## 13. Project Intelligence

Project Intelligence is scoped to the **current assigned workspace snapshot**, never only a ProjectId. Every query includes a `ProjectIntelligenceScope` containing `ProjectId`, `TaskId`, workspace ID, and current workspace/snapshot fingerprint. Index caches are keyed by that fingerprint and invalidated after relevant changes.

Use a measured ensemble:

- Tree-sitter syntax/AST
- SCIP/scip-typescript symbols/references
- ast-grep structural queries/rewrites
- Git facts/history
- lexical retrieval (FTS/BM25-style)
- RepoMap-style graph relevance
- optional semantic embeddings
- deterministic fusion

Derived indexes are non-authoritative caches and must be rebuildable. Do not put Project Intelligence cache truth in the authoritative runtime database.

Repository/project text is untrusted content. Retrieved comments, READMEs, issues, web/MCP content, or source strings cannot override system/mission/policy instructions. Explicit V31M4 governance documents are tagged separately by provenance.

### Embeddings

The existing `ModelGatewayPort` only supports generation and its adapter RPC 1.0 has no embedding method. Add a provider-neutral `EmbeddingGatewayPort` / adapter-protocol-1.1 embedding capability instead of pretending generation invocation is embedding.

Qwen3-Embedding-4B remains the normal challenger; 8B is high-recall escalation. Both are optional/on-demand and must beat non-semantic baselines under matched resources before promotion.

Native/build-script dependencies require a supply-chain gate: exact pin, lockfile integrity, license check, Node/WSL compatibility, and explicit `pnpm allowBuilds` approval if needed. Prefer a safer WASM/CLI boundary when capability is equivalent.

## 14. Skills and MCP

Use Agent Skills as an interoperability package format. V31M4 owns `SkillId`, trust state, permission policy, selection, evaluation, and promotion.

Imported/generated skills begin `candidate`. `SKILL.md` text is not authority. Loader code validates path containment and metadata. Skill scripts are never executed by the loader; any script execution is a governed sandbox/tool effect under the skill's allowed permissions.

Skill promotion requires held-out positive delta (or equal verified quality at materially lower resource cost), no material regression, shadow evidence, and governed promotion.

MCP is an external tool protocol only:

```text
MCP server -> pinned V31M4 MCP adapter -> semantic/tool gateway -> policy/evidence/sandbox -> agent
```

MCP catalog annotations, schemas, and outputs are untrusted input. They cannot grant permissions or expand a skill's authority. Remote/local MCP processes get bounded transport, output/schema validation, timeouts, and minimal environment. No MCP server writes authoritative V31M4 state directly.

A2A is not added without a concrete external-agent requirement.

## 15. Memory Router

Working state is Task Capsule + Ledger. Persistent memory is split into episodic, semantic, and procedural classes.

Authoritative memory records use `SqliteRecordStore`. Lexical/vector/graph/runbook indexes are derived, rebuildable caches. A broken index cannot erase or overwrite canonical memory.

Every memory record has `MemoryId`, evidence/provenance, scope, created/verified times, temporal validity, confidence/status, invalidators/expiry, and relationship references.

Memory retrieval can abstain. External/untrusted text stored as memory remains data and can never become privileged system instruction. Procedural instruction authority comes only from a trusted promoted Skill/Runbook.

## 16. Quality Floor Controller

Extend existing Compute Governor, Diversity Planner, Capability Calculator, Evidence Linker, Champion Selector, Improvement Policy, verifier use cases, and immutable evidence.

Execution ladder:

```text
DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE
-> SPECIALIST/ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION
```

Capability is calibrated for a concrete configuration stratum:

- model/checkpoint/quant
- model-runtime version
- task class + difficulty band
- skill version
- semantic ACI/toolset version
- retrieval/context version
- harness version
- verification class
- sandbox/backend version when effects matter
- environment/runtime fingerprint

Use a conservative one-sided 95% Wilson lower bound for binary verified outcomes. The 9/10 calibrated claim requires lower bound >= 0.90; the bound itself prevents tiny samples from qualifying. Version/environment changes invalidate incompatible evidence. Preserve existing recency/difficulty/evaluation-leak protections and do not collapse heterogeneous tasks into a flattering global score.

Deterministic failures cannot be overridden by RETRACE-style reasoning, rubrics, or neural auditors.

## 17. Evaluation and sandbox laboratory

Benchmark orchestration is **not** an application/core port. Create an isolated `apps/autonomy-lab` (or equivalently isolated lab app) that production runtime never imports. It exercises V31M4 through public/provider-neutral boundaries and writes evaluation artifacts/evidence, never production authority.

Evaluation includes matched-resource V31M4 suites plus available Harbor/Harbor-Index, Terminal-Bench, RigorBench, SWE-style, retrieval, skill, memory, recovery, governance, and hidden private tasks.

The sandbox bake-off may promote OpenSandbox, OpenShell, hardened direct Docker, or no backend. Documentation-only claims never select the winner.

## 18. Verified self-improvement

Self-improvement lives only in the isolated lab until promotion.

Use AHE-style observability, GSME-style diverse candidate search with deterministic measurement, and RELAI-style protected-capability constraints.

Candidate changes occur in isolated workspaces and cannot hot-patch the running authority. Promotion uses development tasks, validation/selection tasks, and a sealed promotion set that optimization cannot inspect. Repeated optimization may not consume sealed labels/trajectories.

Executable harness/source changes require existing governed human approval before production activation. Promotion policy, evidence authority, approval authority, sandbox policy, and Quality Floor Controller are protected surfaces that self-improvement cannot modify autonomously.

A promoted executable version activates only after restart/controlled replacement, retains the prior version for rollback, and automatically rolls back if startup/acceptance gates fail.

## 19. Implementation order

0. baseline/invariant freeze
1. scoped semantic ACI + SandboxPort + adapter-protocol-1.1 foundation
2. Task Capsule / checked state / Task DAG
3. Execution Ledger / reconciliation
4. structured agent-turn protocol + local model adapter modernization
5. Manager / fresh Executor / read-only Auditor
6. evidence-conditioned effects
7. workspace-scoped Project Intelligence + EmbeddingGateway
8. skills + MCP + promotion
9. Memory Router
10. Quality Floor Controller + supplemental verification
11. isolated external evaluation + sandbox backend bake-off
12. verified self-improvement laboratory

No later phase begins until the earlier hard gate passes.

## 20. Completion definition

The program is complete only when V31M4 can decompose, investigate, act, verify, repair, recover, and abstain through governed local tools; task state and execution reality survive context/process resets; tool use is interactive rather than one-shot-only; project context is workspace-current and measured; skills/memory are validity-gated; effects are evidence-conditioned and sandboxed; independent verification can reject the primary model; calibrated quality-floor logic escalates or abstains; no optional external framework owns authority; external dependencies are pinned/replaceable; hermetic regression is green; target-host and external evaluation evidence is recorded; and repository/current-state maps truthfully describe the result.

## 21. Instruction to Claude

Before autonomy work, read `AGENTS.md`, this file, the canonical implementation plan, `docs/current-state.md`, `docs/architecture.md`, `docs/repository-map.md`, `docs/dependency-rules.md`, and relevant module READMEs. Verify live HEAD. Execute one phase only. If live code contradicts a planned interface, stop and record the exact conflict; do not create a parallel authority or silently redesign the program.
