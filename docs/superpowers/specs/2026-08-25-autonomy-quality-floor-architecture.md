# V31M4 Autonomy Quality-Floor Architecture

**Status:** Approved architecture expansion / implementation source of truth  
**Date:** 2026-08-25  
**Architecture baseline:** `V31M4-SRS-001 / 1.0.0`  
**Program ID:** `V31M4-AUTONOMY-001 / 1.0.0`  
**Primary local acceptance model:** Qwen3.8-27B Q4_K_M, behind the existing provider-neutral model boundary  
**Scope:** Core autonomous-system completion only. Video Production and 3D/Game Production remain independent post-core departments and are not part of this program unless an autonomy primitive is generic and required by all departments.

## 1. Purpose

This document freezes the architecture for the remaining V31M4 autonomy work. It converts the 2026-08 research program into implementation contracts so future Claude Code sessions do not reinterpret the design, substitute a convenient agent framework, or create parallel state/tool/memory authorities.

The target is not "a better chatbot." The target is a local-first autonomous production system that compensates for limits of a locally hosted model by externalizing everything that can be made deterministic, stateful, reusable, testable, independently verifiable, or recoverable.

The operational quality rule is:

> V31M4 may deliver only a verified result that satisfies the task's acceptance contract. If the required quality floor cannot be established, V31M4 returns `UNVERIFIED`, `PARTIAL`, `FAILED`, or `NO_VERIFIED_SOLUTION` rather than silently lowering the quality floor.

A "10/10" result is an operational classification, not a metaphysical claim of perfection: every mandatory criterion is evidenced, all applicable deterministic checks pass, no known critical risk remains, independent/adversarial verification finds no contradiction, and the system has no unresolved evidence of a defect.

## 2. Non-negotiable architecture rules

1. **One authority.** V31M4 remains the authority for mission/task state, policy, permissions, evidence, acceptance, capability measurements, memory validity, skill promotion, and delivery. External projects may supply mechanisms; they never become a second sovereign orchestrator.
2. **Models do not certify themselves.** Model confidence, model size, chain-of-thought, and self-reported certainty are not evidence.
3. **Deterministic checks outrank neural judgment.** Compilers, tests, type checks, property checks, schemas, static analysis, security checks, invariants, and environment facts are authoritative when applicable.
4. **No unverified success.** Missing mandatory evidence is not success. Ambiguous effects after a crash are reconciled before retry or completion.
5. **Fail closed for consequential effects.** Write, delete, execute, network, credential, publish, install, and other effectful operations require policy plus task-specific evidence preconditions.
6. **State lives outside model context.** Conversation history is never authoritative task state.
7. **Fresh context is a feature.** Long jobs use explicit phase/task handoffs and fresh model contexts rather than endlessly growing transcripts.
8. **High-level tools first, raw shell second.** The agent receives a small semantic Agent-Computer Interface; raw commands remain a governed escape hatch.
9. **No single retrieval or memory substrate is assumed best.** V31M4 routes/fuses multiple substrates according to task and evidence.
10. **External components are replaceable.** All third-party runtimes, indexers, protocols, models, and sandboxes sit behind V31M4-owned ports/adapters.
11. **Pin production dependencies.** No trusted path may depend on `latest`. Exact versions/hashes are recorded and target-host validated before promotion.
12. **Self-improvement cannot self-certify.** Candidate harness/skill changes must beat the incumbent on held-out tasks and preserve prior capabilities before promotion.

## 3. Relationship to the frozen L1-L10 baseline

The audited L1-L10 baseline remains an immutable reference and all existing public v1 semantics remain preserved. This program is an **explicitly approved additive architecture expansion**.

The old core-freeze rule must not be interpreted as permission to create shadow state in an app-local JSON file, separate database, external agent framework, or untyped sidecar merely to avoid adding a legitimate authoritative concept.

Implementation rule:

- Reuse an existing domain entity, contract, port, service, or use case when its semantics are correct.
- Do not rename or weaken an existing public v1 API merely to fit this program.
- If a new authoritative concept is genuinely required (for example a durable task capsule revision), add it through the normal domain -> contract/port -> use-case -> infrastructure/runtime path as an additive versioned capability.
- Every such addition requires explicit dependency-boundary tests, migration tests when persistence changes, and full regression verification.
- Provider/tool/framework-specific types remain outside domain/application boundaries.

## 4. Target topology

```text
Mission / request
      |
      v
Quality Floor Controller
      |
      v
Task Capsule + checked state machine + Task DAG
      |
      +---- Execution Ledger
      |
      v
Manager / Planner
      |
      v
Project Intelligence + Memory Router + Skill Retrieval
      |
      v
Existing Context Compiler
      |
      v
Qwen3.8-27B Q4_K_M (or another routed model)
      |
      v
Evidence-conditioned Agent-Computer Interface
      |
      v
Existing ToolGatewayPort / policy / approval / evidence boundaries
      |
      v
SandboxPort -> selected local sandbox backend
      |
      v
Isolated effects
      |
      v
Deterministic verification
      |
      v
Fresh-context read-only Auditor
      |
      +---- RETRACE-style patch reasoning / contextual rubric where applicable
      |
      v
Champion / delivery gate
      |
      v
Verified memory + capability measurements
      |
      v
Later: evidence-backed harness/skill evolution
```

## 5. Workstream A — Task Capsule, Task DAG, and checked state machine

### Decision

Build a **native V31M4 Task Capsule**. Adopt the strongest mechanisms demonstrated by StateM and LongHorizon-Harness, but do not install either project as V31M4's orchestrator.

Research references:

- StateM: `https://github.com/henryqin1997/statem`
- LongHorizon-Harness: `https://github.com/AMAP-ML/LongHorizon-Harness`

### Required Task Capsule fields

At minimum each durable capsule revision records:

- task/mission/job identity and parent-child relationships
- immutable revision, previous revision, created-at timestamp, and content fingerprint
- exact objective
- mandatory acceptance criteria and evidence rules
- constraints and forbidden changes
- current state/phase
- Task DAG: children, dependencies, blockers, completion state
- current bounded plan / next action
- verified facts with provenance
- assumptions, explicitly marked non-facts
- active hypotheses and rejected hypotheses
- decisions with evidence and alternatives considered
- project-intelligence references, not copied giant source blobs
- workspace/sandbox identity and checkpoint identity
- current diff/change artifact references
- test/check status and evidence references
- attempt/failure history
- active skill IDs and versions
- model/harness/toolset versions used
- context manifest/fingerprint for each model invocation
- unresolved questions and risks
- required escalation or stop condition

### State-transition rules

Use StateM-style checked transitions:

- states/transitions are typed and explicit
- transitions have machine-verifiable predicates when possible
- failed predicates block transition
- each transition attempt is durably recorded
- bounded transitions have explicit attempt limits
- repair/escalation transitions are explicit, not prompt conventions
- state cannot advance merely because the model claims work is complete

The model does not directly rewrite authoritative task state. It proposes a typed delta; V31M4 validates and commits the next immutable capsule revision.

### Acceptance

- crash/restart between any two phases resumes from durable state without relying on chat history
- stale/invalid transition is rejected
- a missing transition predicate cannot be silently skipped
- repeated attempts respect configured bounds
- every delivered result references the final capsule revision
- capsule replay reconstructs the same current state deterministically

## 6. Workstream B — Execution Ledger

### Decision

Build a deterministic native execution ledger using the mechanism demonstrated by Ledger, not a second model call.

Research reference: Ledger paper/release discovered during the 2026-08 audit; implementation semantics are what matter, not adopting a parallel orchestrator.

### Ledger responsibility

The ledger records what actually happened in the environment:

- files/symbols/resources observed
- exact version/hash/state observed
- effects attempted
- effects confirmed
- ambiguous effects awaiting reconciliation
- modifications and resulting fingerprints
- commands/tests run and validity scope of their results
- failed approaches and failure signatures
- information invalidated by later changes
- environment facts with timestamps

The ledger and Task Capsule are separate:

- **Task Capsule:** what the task means and where the workflow is.
- **Execution Ledger:** what the system has actually observed/attempted/changed.
- **Evidence store:** why a claim is trusted.

### Acceptance

- changing a file invalidates observations/tests whose validity depended on the previous file version
- redundant operations can be detected without another model call
- ambiguous effects are never automatically replayed
- restart restores ledger state and reconciliation status
- ledger entries are append-only or revisioned; history is not rewritten

## 7. Workstream C — Manager, fresh Executor, independent Auditor

### Decision

Implement LongHorizon-Harness-style role separation natively using existing V31M4 jobs, routing, evidence, checkpoints, and model gateways.

### Roles

**Manager/Planner**
- reads authoritative task state
- selects the next bounded task/DAG node
- selects required skill/tool/context recipe
- does not mark its own task complete

**Executor**
- receives a fresh, bounded context
- acts only on the selected task
- uses governed tools
- writes candidate artifacts/effects, not acceptance decisions

**Auditor**
- receives fresh context independent of the Executor's reasoning transcript
- is read-only by default
- receives task capsule, acceptance contract, resulting artifacts/diff, ledger facts, and verification evidence
- may request additional deterministic checks
- cannot mutate the candidate under evaluation

On limited hardware, these roles run sequentially. Do not require simultaneous copies of the 27B model.

### Acceptance

- Auditor never receives private Executor reasoning as an authority
- independent audit can reject a candidate the Executor marked complete
- phase resets preserve all necessary state through capsule/ledger/evidence, not conversation history
- restart during any role is recoverable

## 8. Workstream D — Evidence-conditioned Agent-Computer Interface

### Decision

Extend the existing `ToolGatewayPort`; do not introduce a competing tool authority. Adopt SWE-agent ACI principles and ECLoop-style evidence gating.

References:

- SWE-agent / mini-SWE-agent ACI: `https://github.com/SWE-agent/mini-swe-agent`
- ECLoop: research mechanism; implement natively as policy/evidence preconditions

### Agent-facing tool vocabulary

Keep the semantic surface small. Initial target vocabulary:

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
git.worktree

command.run
browser.inspect
browser.verify
```

These are semantic V31M4 operations. Their internals may use Tree-sitter, SCIP, ast-grep, Git, Playwright, shell commands, language servers, or test frameworks.

### Evidence preconditions

Consequential operations can declare required prior evidence. Example: a code patch may require relevant definition inspection and known affected tests. Missing evidence yields a typed denial containing the missing evidence classes; the model must investigate rather than bypass the gate.

Do not hard-code one universal evidence checklist. Requirements are operation + task-class + risk dependent.

### Raw command escape hatch

`command.run` remains available only through existing policy/resource/sandbox controls. It is not the default interface when a higher-level semantic operation exists.

### Acceptance

- every effectful invocation has task/job identity, budget, policy decision, ledger entry, and artifact/log provenance
- no direct model -> shell, model -> browser, model -> MCP, or model -> sandbox path exists
- evidence preconditions fail closed
- cancellation, timeout, restart, and ambiguous-effect reconciliation are tested

## 9. Workstream E — Project Intelligence ensemble

### Decision

No single repository retriever is authoritative. Build a task-aware ensemble and feed the existing deterministic Context Compiler.

### Direct reusable substrates

1. Tree-sitter — syntax/AST/incremental parsing  
   `https://github.com/tree-sitter/tree-sitter`
2. SCIP — language-neutral symbol/reference protocol  
   `https://github.com/scip-code/scip`
3. scip-typescript — TypeScript/JavaScript indexer  
   `https://github.com/sourcegraph/scip-typescript`
4. ast-grep — structural search/lint/rewrite  
   `https://github.com/ast-grep/ast-grep`
5. Git — history/diff/worktree truth
6. SQLite FTS5/BM25-style lexical retrieval — local lexical substrate

### Adapt, do not adopt as an authority

- Aider RepoMap graph-ranking/token-budget ideas: `https://github.com/Aider-AI/aider`
- task-aware retrieval fusion / reciprocal-rank-style fusion

### Optional semantic sidecar

- Qwen3-Embedding-4B is the normal semantic-retrieval candidate.
- Qwen3-Embedding-8B may be evaluated only as a high-recall escalation.
- A reranker (initial challenger: Qwen3-Reranker-4B) is not promoted unless it beats the fused baseline under the same practical latency/memory budget.
- Embedding/reranking models are on-demand; do not require them to remain resident alongside the primary 27B model.

### Required graph/facts

Project Intelligence should be able to answer, with provenance:

- files and modules
- definitions/symbols
- references/callers/implementations
- imports/dependencies
- interfaces/contracts
- tests related to symbols/files
- build/package relationships
- recent relevant Git changes
- architecture/dependency rules
- known failure history
- task relevance and impact radius

### Context integration

Project Intelligence produces candidates; the existing V31M4 Context Compiler remains the final packing authority. Mandatory mission material can never be displaced by retrieval ranking.

### Acceptance

Evaluate against a frozen repository-task suite including:

- definition -> references
- failure trace -> implementation
- code -> affected tests
- requirement -> relevant files
- architecture rule -> affected boundaries
- hidden multi-file tasks where naive lexical search fails

The production ensemble must beat each individual retrieval family on aggregate V31M4 task success or provide a materially better quality/latency trade-off with no measured regression.

## 10. Workstream F — Skills runtime, retrieval, and promotion

### Decision

Use the open **Agent Skills** package shape as the interoperability format; V31M4 owns registration, policy, retrieval, verification, capability measurement, and promotion.

Reference: `https://github.com/agentskills/agentskills`

### Skill semantics

A trusted V31M4 skill is a versioned procedure, not merely a prompt. Its registered metadata must define or resolve:

- capability/task class
- preconditions
- context recipe
- required/optional tools
- permission class
- bounded workflow/runbook
- deterministic checks
- recovery/escalation rules
- stop conditions
- supported model/harness constraints
- evaluation evidence
- promotion state

External `SKILL.md` compatibility must be preserved; V31M4-specific trust metadata stays in the registry/side metadata rather than making the public format incompatible.

### Retrieval

Use SkillRet research methodology/datasets as the evaluation reference for selecting a skill from a large library. Do not require SkillRet's training stack as a production dependency.

### Promotion

Every generated/imported skill begins `CANDIDATE`. Promotion requires:

1. held-out evaluation
2. incumbent vs candidate comparison
3. no material regression category
4. positive verified delta or equivalent quality at materially lower resource cost
5. shadow production evidence
6. final governed promotion

Use SkillsBench, SWE-Skills-Bench, SkillGenBench, SkillRet-style evaluation, plus V31M4 hidden tasks. A skill that increases token usage without improving verified outcomes is rejected.

## 11. Workstream G — Multi-substrate Memory Router

### Decision

Do **not** make MemOS, Mem0, Letta, Graphiti, a vector DB, or any single memory system the authoritative memory backend. Controlled 2026 evidence shows memory substrates trade wins by task/history regime.

V31M4 owns memory semantics and routes among substrates.

### Memory classes

1. **Working memory** — Task Capsule + Execution Ledger. Authoritative for the active task.
2. **Episodic memory** — verified prior task events/outcomes/failures.
3. **Semantic memory** — durable project/environment facts.
4. **Procedural memory** — trusted skills/runbooks.

### Substrates

- SQLite structured records for exact authoritative facts
- FTS5/lexical index for exact/near-exact retrieval
- semantic embeddings for similarity retrieval
- causal/relationship graph for dependencies, temporal validity, and objective/action/result relationships
- file/runbook-style long trajectory records when investigation is better than eager RAG injection

### Memory record requirements

Every non-working-memory item records:

- source/provenance
- supporting evidence IDs
- scope/project/task class
- created and last-verified time
- temporal validity when applicable
- confidence/status
- invalidators/expiry conditions
- causal/relationship links when applicable

Adopt RaMem-style temporal/context validity, AMA-style causal memory, AgentRunbook-C-style file/runbook investigation, and MemOS-style consolidation/scheduling ideas where they win V31M4 evaluation. Do not import any of these as a second authority.

### Acceptance

- invalidated/stale memory cannot be silently injected as current fact
- retrieval can abstain
- more retrieved memory must not automatically mean better; context cost is measured
- memory routing is evaluated separately on factual recall, temporal reasoning, sequential decision-making, and long trajectory recovery
- MemoryArena/AMA-Bench/LongMemEval-style tests plus V31M4 hidden tasks gate promotion

## 12. Workstream H — Quality Floor Controller and verification stack

### Decision

Extend the existing Compute Governor, Diversity Planner, Capability Calculator, Evidence Linker, Champion Selector, Improvement Policy, verification use cases, and immutable evidence machinery. Do not replace them with an agent framework.

### Quality-floor execution ladder

```text
DIRECT
  -> CHECKED
  -> COMPETITIVE
  -> ADVERSARIAL
  -> DECOMPOSE
  -> SPECIALIST SKILL / ALTERNATE MODEL
  -> ACQUIRE MISSING CONTEXT/EVIDENCE
  -> NO_VERIFIED_SOLUTION
```

The system may only move downward in rigor when the required safety/quality floor still holds. Otherwise it defers/refuses.

### Calibrated capability gate

Capability is measured for a concrete configuration stratum, not for a model name alone:

```text
model/checkpoint + quant
+ task class + difficulty band
+ skill version
+ toolset/ACI version
+ context/retrieval version
+ harness version
+ verification class
```

For binary accepted/rejected production outcomes, implement a conservative lower confidence bound (initial design: one-sided 95% Wilson lower bound) over sufficient verified samples within a reasonably homogeneous stratum. The quality-floor claim requires the lower bound, not the raw mean, to meet the configured threshold (for the 9/10 floor, >= 0.90). If the sample is insufficient or the task is outside the measured envelope, V31M4 increases execution rigor and may not claim calibrated 9/10 capability.

Do not collapse heterogeneous task classes into one flattering global score.

### Verification stack

Order of authority:

1. deterministic compiler/build/type/schema checks
2. deterministic tests/property/integration/regression checks
3. security/policy/invariant checks
4. environment/effect evidence
5. RETRACE-style independent patch/problem reasoning where code patches are involved
6. task-specific Agentic-Rubrics-style contextual checks where deterministic checks cannot express architectural completeness
7. fresh-context Auditor
8. champion/delivery gate

RETRACE and rubric agents are supplemental; they never override a deterministic failure.

### Delivery invariant

`SUCCESS` / delivery requires:

- every mandatory acceptance criterion covered by valid evidence
- every mandatory deterministic check passing
- no forbidden change
- no unresolved critical risk
- no ambiguous unreconciled effect
- internally consistent final task capsule/ledger state
- required independent audit completed
- quality-floor requirements satisfied for the task's risk class

Otherwise return the correct non-success typed result.

## 13. Workstream I — SandboxPort and supervised local sandbox backend

### Decision

Freeze the **V31M4-owned `SandboxPort` abstraction**, not one third-party backend. The backend winner must be selected by target-host testing on the actual Windows 11 + WSL2 machine.

### Current challengers

- OpenSandbox: `https://github.com/opensandbox-group/OpenSandbox`
- NVIDIA OpenShell: `https://github.com/NVIDIA/OpenShell`
- hardened direct WSL2/Docker implementation as the minimal incumbent

### Backend requirements

At minimum:

- isolated per-task/worktree filesystem
- non-root execution
- bounded CPU/RAM/PIDs/wall clock
- network denied by default and explicitly granted
- no host Docker socket exposure to the agent sandbox
- no ambient host secrets
- bounded output/logging
- clean cancellation/kill semantics
- orphan detection and cleanup
- restart/reconciliation support
- fail-closed startup if a configured stronger isolation runtime is unavailable
- target-host proof for actual WSL2/Docker behavior

### OpenSandbox lifecycle if selected

OpenSandbox's server is **not operator-managed like Ollama**. V31M4 Layer 8 supervises it as a pinned infrastructure sidecar:

```text
V31M4 Layer 8 supervisor
    -> starts foreground opensandbox-server
    -> binds loopback on a V31M4-owned/allocated port
    -> captures stdout/stderr
    -> polls health
    -> performs a real create/exec/destroy readiness smoke test
    -> monitors/restarts within a bounded restart budget
    -> reconciles OpenSandbox/Docker reality against V31M4 durable state
```

A server crash does not imply the task effect failed. In-flight effects become unknown until reconciliation determines whether the effect happened. Blind retry is forbidden.

Docker/WSL2/host GPU driver remain host-managed dependencies. V31M4 diagnoses their absence; it does not silently reconfigure the machine.

### Sandbox bake-off

The backend is promoted only after the same target-host suite measures:

- filesystem escape attempts
- network isolation/egress policy
- process/resource limits
- secret leakage attempts
- child/orphan behavior
- cancellation/timeout
- server/backend crash recovery
- orphan sandbox reconciliation
- latency/overhead
- compatibility with required tool workloads

No documentation-only winner is accepted.

## 14. Workstream J — External interoperability

### MCP

Use the official current Model Context Protocol TypeScript SDK behind V31M4 adapters. External MCP tools never connect directly to the model.

```text
external MCP server
 -> V31M4 MCP adapter
 -> ToolGatewayPort
 -> policy/evidence/budget/sandbox
 -> model-visible semantic tool
```

Reference: `https://github.com/modelcontextprotocol/typescript-sdk`

### Agent-to-agent

External agent interoperability may use the current A2A protocol behind an adapter when needed. Internal V31M4 roles/subagents use native task/capsule protocols; do not add network/protocol overhead internally merely for standards compliance.

## 15. Workstream K — Verified self-improvement laboratory

### Ordering

This is the **last** workstream. Do not optimize an unstable harness.

### Decision

Combine three research mechanisms natively:

- AHE: observability and explicit hypotheses for harness changes
- GSME: diverse candidate search with deterministic measurement/significance ownership
- RELAI-VCL principle: continual improvement with explicit no-regression constraints across previously earned capabilities

Do not install another autonomous framework as V31M4's improvement authority.

### Candidate changes may include

- context/retrieval recipes
- skill selection or skill content
- tool selection/ACI behavior
- decomposition/runbook strategies
- routing/escalation policy
- repair policy
- memory routing/consolidation rules
- prompt templates where evidence shows prompts are actually the bottleneck

### Promotion pipeline

```text
verified production weakness
 -> failure clustering/pathology
 -> explicit predicted improvement
 -> candidate harness/skill version
 -> held-out tests
 -> incumbent comparison
 -> statistical/significance check
 -> prior-capability regression suite
 -> shadow production
 -> verified production evidence
 -> governed promotion
```

Any candidate that improves the new task but materially regresses a previously protected capability is rejected.

## 16. Evaluation laboratory — not production runtime dependencies

Use external evaluation infrastructure to challenge V31M4; do not make these tools runtime startup dependencies.

Primary evaluation stack:

- Harbor / Harbor-Index — broad independent task laboratory
- Terminal-Bench 2.1 — terminal/computer agency
- RigorBench — process discipline, recovery, abstention, atomicity
- Agent Retrieval Bench — project-intelligence quality
- SWE-bench / SWE-Pro / DeepSWE-style software tasks
- SkillsBench / SWE-Skills-Bench / SkillGenBench / SkillRet-style tests
- MemoryArena / AMA-Bench / LongMemEval-style memory tests
- V31M4 private/hidden acceptance suite — architecture constraints, restart recovery, induced failures, evidence truthfulness, regression avoidance

A benchmark score alone never promotes a component. Promotion requires direct V31M4 A/B evidence under matched resources.

## 17. Open-source selection rules

Use the following classification so Claude does not confuse a research reference with a runtime dependency.

| Component/research | V31M4 use |
| --- | --- |
| StateM | **Mechanism/reference.** Port checked-state/runbook ideas natively; do not adopt as orchestrator. |
| LongHorizon-Harness | **Mechanism/reference.** Port Manager/fresh Executor/read-only Auditor pattern natively. |
| Ledger | **Mechanism/reference.** Build deterministic native execution ledger. |
| ECLoop | **Mechanism/reference.** Build evidence preconditions into V31M4 tool policy. |
| Tree-sitter | **Direct substrate** behind Project Intelligence. |
| SCIP / scip-typescript | **Direct substrate/indexer** behind Project Intelligence. |
| ast-grep | **Direct governed tool/substrate** for structural search/rewrite. |
| Aider RepoMap | **Algorithm/reference.** Adapt graph/context ranking; do not adopt Aider as orchestrator. |
| Qwen3-Embedding | **Optional routed model sidecar** behind V31M4 model boundary. |
| Qwen3-Reranker | **Challenger only** until direct V31M4 A/B proves value. |
| Agent Skills | **Interoperability format**, with V31M4-owned trust metadata/runtime. |
| SkillRet / SkillsBench family | **Evaluation/retrieval methodology**, not authority. |
| RaMem / AMA / AgentRunbook-C / MemOS | **Memory mechanisms/research references**; no single product owns V31M4 memory. |
| RETRACE | **Supplemental verifier mechanism**; deterministic checks remain authoritative. |
| Agentic Rubrics | **Contextual verification mechanism** where hard checks are incomplete. |
| OpenSandbox | **Sandbox backend challenger**, supervised by V31M4 if selected. |
| OpenShell | **Sandbox/security-policy challenger**, not automatically selected on WSL2. |
| MCP TypeScript SDK | **Direct protocol SDK** behind V31M4 adapter/policy boundaries. |
| AHE / GSME / RELAI-VCL | **Self-improvement mechanisms/research references**, implemented under V31M4 governance. |
| Harbor/benchmarks | **Evaluation lab only**, not production runtime dependencies. |

## 18. Explicitly forbidden implementation shortcuts

Claude must not:

- replace V31M4 orchestration with OpenHands, LangGraph, AutoGen, CrewAI, SWE-agent, StateM, LongHorizon-Harness, Symphony, or another full agent framework
- create a second authoritative task-state database
- let a sandbox/MCP/memory/skill server write authoritative V31M4 state directly
- expose raw MCP servers directly to the model
- let a model edit its own accepted evidence or capability measurements
- treat vector similarity as truth
- keep all memory/retrieved history in the prompt "just in case"
- mark success from model text without required evidence
- use the builder's reasoning transcript as verifier evidence
- automatically retry an effect whose post-crash outcome is unknown
- promote a skill/harness change from training/evaluation tasks without held-out and regression evidence
- hardwire the architecture to Qwen3.8; it is the initial local acceptance model, not a core type
- require optional embedding, reranking, sandbox-server, MCP, browser, Video, or Game services for hermetic core startup
- use floating dependency versions in trusted production paths

## 19. Implementation order and hard gates

Do not begin all workstreams in parallel. The dependency order is:

### Phase 0 — Baseline and invariants

- re-run current full hermetic gate
- record current HEAD and baseline evidence
- add program-specific hidden/focused acceptance fixtures before behavior changes

**Gate:** zero unexplained baseline failure.

### Phase 1 — Governed ACI + `SandboxPort`

Build the small semantic tool surface and sandbox abstraction first. Retain hermetic/reference adapters.

**Gate:** effectful tool operations are typed, policy-gated, evidenced, cancellable, sandboxed, restart-safe, and have no model-direct bypass.

### Phase 2 — Task Capsule + checked state machine + Task DAG

**Gate:** deterministic replay, checked transitions, bounded attempts, crash/restart recovery, no chat-history dependency.

### Phase 3 — Execution Ledger

**Gate:** observation invalidation, ambiguous-effect state, redundant-operation detection, recovery/reconciliation.

### Phase 4 — Manager / fresh Executor / independent Auditor

**Gate:** role isolation, fresh contexts, read-only audit default, task completion cannot be self-certified.

### Phase 5 — Evidence-conditioned action gating

**Gate:** task/risk-specific missing evidence blocks consequential effects and produces an actionable typed denial.

### Phase 6 — Project Intelligence ensemble

**Gate:** direct V31M4 retrieval/task suite proves the ensemble beats individual baselines at acceptable resource cost; Context Compiler remains final authority.

### Phase 7 — Skills runtime/retrieval/promotion

**Gate:** untrusted skill cannot bypass tool policy; candidate skills require held-out positive delta and no material regression before promotion.

### Phase 8 — Memory Router

**Gate:** stale/invalid memory is rejected or marked; routing is measured by memory task class; retrieval can abstain; context pollution regression tests pass.

### Phase 9 — Quality Floor Controller + supplemental verification

**Gate:** conservative capability lower bounds, execution escalation, no-verified-solution behavior, RETRACE/rubric integration, and zero deterministic-failure override.

### Phase 10 — External benchmark campaign

**Gate:** no major hidden regression across software, terminal, retrieval, skills, memory, recovery, governance, and process-discipline suites.

### Phase 11 — Verified self-improvement laboratory

**Gate:** candidate harness changes cannot promote without held-out improvement, protected-capability regression pass, shadow evidence, and governed promotion.

## 20. Required verification discipline for every phase

Every phase must include:

1. focused unit tests
2. negative/fail-closed tests
3. cancellation/timeout tests for external work
4. restart/recovery tests for durable work
5. hostile/invalid input tests at external boundaries
6. dependency-direction/static import checks
7. source-size/complexity review; split files rather than creating another composition monolith
8. full owning-layer regression
9. full workspace hermetic regression before completion
10. target-host proof for any claim that depends on installed local software/model/runtime
11. update `repo_map.md`, `docs/repository-map.md`, and `docs/current-state.md` when implementation/current-state meaning changes
12. immutable evidence/report documenting what was actually tested, including failures and unresolved limits

## 21. Definition of program completion

`V31M4-AUTONOMY-001` is complete only when all of the following are true:

- the production runtime can autonomously decompose, investigate, act, verify, repair, and recover through governed tools without relying on unbounded chat state
- task state and execution reality survive process/context resets
- project context is assembled from measured multi-source intelligence rather than raw file dumping
- skills and memory are selected/persisted under evidence-backed validity rules
- effectful actions are sandboxed and evidence-conditioned
- independent verification can reject the primary model
- quality-floor execution escalates or abstains instead of silently lowering standards
- no optional third-party framework owns V31M4 state, policy, evidence, or acceptance
- all added external components are pinned, replaceable, and target-host validated where applicable
- full hermetic regression is green
- external evaluation campaign shows no critical regression
- current-state and ownership maps truthfully describe the final implementation

## 22. Instruction to future Claude Code sessions

Before implementing any part of this program:

1. Read `AGENTS.md`, `docs/architecture.md`, `docs/repository-map.md`, `docs/dependency-rules.md`, `docs/current-state.md`, and **this specification**.
2. Verify live HEAD; do not trust stored SHA text.
3. Identify the exact phase and its gate. Do not opportunistically build later phases.
4. Reuse existing ports/services/use cases where semantics fit. Do not create parallel abstractions because an external repo used different names.
5. Treat every named external project above as either a substrate, adapter candidate, or research mechanism exactly as classified in Section 17.
6. If implementation evidence contradicts this spec or a current external component no longer meets the claimed boundary, stop and record the conflict rather than silently changing architecture.
7. A phase is not complete until its acceptance gate and required verification discipline are satisfied with recorded evidence.

This document is the canonical architecture decision for the autonomy-quality-floor program until explicitly superseded by a later approved spec.