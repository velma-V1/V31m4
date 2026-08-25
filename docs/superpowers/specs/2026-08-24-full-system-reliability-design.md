# V31M4 Full-System Reliability Design

**Status:** Approved implementation direction
**Scope:** Finish V31M4 as a general-purpose autonomous system/product builder while leaving Video Production and 3D/Game Production real-adapter work deferred.
**Baseline:** Existing V31M4 L1-L10 architecture and post-core runtime on `main`.

## Goal

V31M4 must be able to accept an unfamiliar production objective and carry it through a durable, governed loop:

```text
goal -> gather context -> plan -> execute/build -> verify -> diagnose/repair -> select champion -> deliver -> retain proven knowledge
```

The model is never the final authority. Deterministic state, policy, evidence, verification, and promotion remain authoritative.

## Scope

This program contains the previously identified Item 4 plus nine reliability additions.

### Item 4 — General governed tool execution

Expose real filesystem, Git, command, and browser operations through the existing `ToolGatewayPort` and `invokeTool` governance path.

Required properties:

- tool operations are provider-neutral and typed;
- every state-changing invocation passes policy/approval before execution;
- external effects never run inside an authoritative SQLite transaction;
- operations are bounded by deadline, cancellation, output limits, working-root containment, and resource budget;
- outputs/logs become runtime-owned artifacts/evidence where applicable;
- failures are explicit and restart-safe;
- no model directly invokes shell, browser, Git, filesystem, MCP, or future tool providers outside the gateway.

### 1. Task Capsule / checked state machine

Add a V31M4-native durable task capsule that records explicit phase/state, checked transitions, attempt limits, task DAG dependencies, runbook/practice version, and repair transitions. Persist task state outside model context.

### 2. Ledger + evidence-gated transitions

Record what has actually been observed, modified, attempted, verified, invalidated, or made stale. Effects that require evidence must refuse transition until evidence requirements are satisfied.

### 3. Fresh-context executor / read-only auditor separation

Separate orchestration roles so an executor receives a bounded fresh task context and an independent auditor receives read-only evidence/context. Only independently verified facts may update trusted task state.

### 4. Project Intelligence ensemble

Implement task-aware retrieval as an ensemble rather than a single vector store:

- lexical retrieval;
- structural/syntax retrieval;
- semantic retrieval;
- graph/repository relevance;
- deterministic fusion;
- final packing by the existing Context Compiler.

External retrievers are replaceable adapters. The Context Compiler remains final context authority.

### 5. Native multi-substrate memory router

Route memory requests by purpose instead of treating memory as one vector database:

- exact/durable state -> authoritative SQLite/records;
- lexical/file/runbook memory -> files + lexical index;
- semantic similarity -> replaceable embedding index;
- causal/workflow memory -> provenance/causal graph;
- temporal validity and evidence provenance apply before context injection.

Memory may inform decisions but may not bypass authoritative state or evidence requirements.

### 6. Real sandbox boundary

Add a native `SandboxPort` abstraction. Backend selection remains replaceable and target-host tested. The first accepted backend must provide containment, bounded resources, fail-closed startup when required isolation is unavailable, cleanup, and restart-safe workspace identity. OpenSandbox/OpenShell/hardened WSL2-Docker remain challengers rather than hard-coded core dependencies.

### 7. Small high-quality agent tool vocabulary

Expose a compact semantic tool surface rather than dozens of low-level commands. Initial families:

- repository map/search/symbol/reference/impact;
- code inspect/patch;
- targeted/regression test;
- debug reproduce/explain;
- Git status/diff/history/worktree;
- bounded command execution;
- browser inspect/verify.

Low-level implementation details remain behind adapters.

### 8. Skills registry/retrieval with hard promotion tests

Use Agent Skills-compatible packaging where useful, but keep execution, trust, and promotion V31M4-native. Generated or imported skills begin untrusted. Promotion requires measured positive delta on held-out tasks, no material regression, governance preservation, and recorded evidence.

### 9. End-to-end hidden acceptance suite

Build a V31M4-specific acceptance battery that evaluates the whole system rather than isolated components. It must cover:

- long-horizon state/recovery;
- governed tool execution;
- repository retrieval/context quality;
- execution/auditor separation;
- evidence completeness;
- repair and bounded retry behavior;
- memory relevance and stale-memory rejection;
- sandbox refusal/containment;
- skill promotion rejection and success;
- restart/replay and idempotency;
- a previously unseen build objective from request through verified delivery.

## Explicit exclusions

- No new Video Production real-generation adapter work.
- No new 3D/Game Production real-adapter work.
- No autonomous market/opportunity-discovery subsystem in this program.
- No mandatory self-modifying harness/evolution engine until ordinary task execution is reliable under the hidden acceptance suite.
- No external component becomes sovereign over runtime state, verification, policy, memory, or task state.

## Architectural ownership

Reuse existing V31M4 owners before adding new abstractions:

- `packages/domain`: immutable task/ledger state and invariants only when new domain state is required.
- `packages/application`: provider-neutral ports, deterministic decision services, and governed use cases.
- `packages/infrastructure`: persistence, sandbox/tool implementations, indexes, process supervision, and gateways.
- `apps/runtime`: authoritative composition, command/query surfaces, restart/recovery, and translation of external contracts.
- `adapters/*`: external processes/providers only.
- optional capabilities remain removable and cannot become startup requirements.

No model, plugin, adapter, or UI receives direct SQLite authority.

## Sequencing

The implementation order is dependency-driven:

1. General governed tool execution.
2. Task Capsule + Ledger/evidence gates.
3. Fresh executor/auditor separation.
4. Project Intelligence ensemble.
5. Memory router.
6. SandboxPort + target-host backend acceptance.
7. Semantic agent tool vocabulary over the governed tool path.
8. Skills registry/retrieval/promotion gates.
9. Hidden end-to-end acceptance suite.
10. Run the full system against unfamiliar production objectives; repair only evidence-backed failures.

This order is intentional: later capabilities must not be built on an unproven execution substrate.

## Acceptance rule for every external component

A challenger enters V31M4 only when, under the same model/task/resource ceiling/acceptance checks/harness version, it either improves capability or provides equivalent capability at materially lower cost, while preserving:

- no significant regression;
- no governance bypass;
- restart/replay correctness;
- deterministic authoritative state;
- fail-closed permissions;
- complete evidence/provenance;
- acceptable licensing;
- replaceability.

Otherwise it is rejected.

## Program finish line

The program is complete only when V31M4 can take a previously unseen system-building objective, autonomously gather the necessary project context, perform governed tool work, survive interruption/restart, independently verify and repair its output, reject unsupported success claims, deliver a verified result, and retain only evidence-backed reusable knowledge without requiring Video or Game departments.