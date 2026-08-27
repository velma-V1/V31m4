# V31M4 Research Intelligence Task 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded first-class Research Intelligence phase that prevents premature research convergence and permits only conclusions whose strength is supported by measured research coverage.

**Architecture:** Extend the existing Task Capsule/Ledger/Evidence/Artifact authority; do not create a parallel research runtime or database. Research planning, divergence/falsification, coverage, challenger search, saturation, and conclusion gating are V31M4-owned deterministic/application mechanisms around governed model/tool invocations. The primary model uses fresh contexts by default; heterogeneous challenger models remain optional until evaluation proves value.

**Tech Stack:** Existing TypeScript/Node autonomy runtime, `SqliteRecordStore`, Task Capsule, Execution Ledger, Evidence, Artifact store, Manager/Executor/Auditor, semantic tool gateway, Skills/MCP from Task 8, current model gateway, Vitest, existing target-host proof conventions.

**Spec:** `docs/superpowers/specs/2026-08-27-research-intelligence-amendment.md`

## Global Constraints

- This is **Task 9**, after Task 8 Skills + MCP and before Memory.
- Runtime API `1.0.0` remains unchanged.
- No accepted Task 0–6 behavior is reopened.
- No full external research framework becomes authority.
- No dedicated small-model subsystem is required.
- Brainstorming/divergence output is hypothesis only, never evidence.
- Task Capsule/Ledger/Evidence/Artifacts remain canonical.
- Research indexes/caches are derived and rebuildable.
- High-strength conclusions fail closed when required Research Coverage is incomplete.
- If no candidate fully satisfies the Research Contract, return best current solution + exact gap + strongest next path.
- Free-first applies only among candidates meeting the required correctness/reliability/security/capability floor.
- Every implementation phase uses TDD, focused checks, full `pnpm check`, source/dependency guards, docs/maps/evidence, then a hard gate.

## Task-number amendment

After this Task 9 is accepted, resume the original v2 plan with the following numbering only:

- original Task 9 Memory -> **Task 10**
- original Task 10 Quality Floor -> **Task 11**
- original Task 11 Eval Lab / sandbox bakeoff -> **Task 12**
- original Task 12 Self-improvement -> **Task 13**

The substantive requirements of those existing phases remain unchanged except where the Research Intelligence amendment explicitly adds Research Coverage consumption/evaluation requirements.

---

## Phase 9.1 — Freeze Research Contract and coverage types

**Files:**
- Create: `packages/application/src/research/research-contract.ts`
- Create: `packages/application/src/research/research-coverage.ts`
- Create: `packages/application/src/research/research-conclusion.ts`
- Test: `packages/application/tests/research/research-contract.test.ts`
- Test: `packages/application/tests/research/research-coverage.test.ts`

**Produces:** bounded infrastructure-free internal types/policies for Research Contract, source/strategy coverage, consequence/claim strength, conclusion class, and completion status. Do not add a public runtime schema.

- [ ] **Step 1: Write failing validation tests** for empty objectives, invalid consequence/claim-strength values, duplicate required source classes/strategies, unbounded arrays/text, inconsistent requirements, and conclusion strength above coverage.
- [ ] **Step 2: Define closed internal enums/unions** for decision consequence, claim-strength target, source class, research strategy, coverage status, and conclusion class. Keep provider/site names out of the types.
- [ ] **Step 3: Implement bounded `ResearchContract` construction** with exact objective, dimensions/constraints, freshness, applicable source classes, required strategies, primary-verification/challenger/saturation flags, and resource/stop conditions.
- [ ] **Step 4: Implement deterministic `ResearchCoverage` evaluation** over completed strategies/classes, verified finalists, contradictions, challenger completion, unknown-unknown completion, and saturation evidence.
- [ ] **Step 5: Implement deterministic conclusion-strength policy** so weak coverage cannot emit `best available`/equivalent strong classes.
- [ ] **Step 6: Run focused tests and dependency/source-size guards.**

**Hard gate:** invalid/insufficient coverage cannot be represented as a stronger conclusion through normal constructors/policies.

---

## Phase 9.2 — Add bounded research state to existing Task authority

**Files:**
- Modify only as needed: `packages/domain/src/entities/task-capsule.ts`
- Modify only as needed: Task Capsule repository/application serialization paths
- Test: Task Capsule domain/restart/replay tests

**Produces:** references/fingerprints needed to resume research without conversation history. Do not create a parallel ResearchTask aggregate unless a concrete invariant cannot be represented by Task Capsule references.

Required state is limited to references/fingerprints for:

- Research Contract;
- active candidate/comparison artifact;
- verified claim/evidence references;
- unresolved research questions/assumptions;
- current research phase/round;
- Research Coverage/receipt references;
- stop/saturation state.

- [ ] **Step 1: Write failing bounded-state/replay tests.**
- [ ] **Step 2: Reuse existing Task Capsule assumption/hypothesis/decision/reference mechanisms where sufficient.**
- [ ] **Step 3: Add only the minimum typed fields/references proven necessary.**
- [ ] **Step 4: Prove restart reconstructs identical research state/fingerprints without chat history.**

**Hard gate:** research can resume deterministically after restart and no duplicate research authority exists.

---

## Phase 9.3 — Implement fresh-context divergence/falsification planner

**Files:**
- Create: `packages/application/src/research/research-divergence-planner.ts`
- Create: `apps/runtime/src/autonomy/research/research-divergence-runtime.ts`
- Test: application planner tests + runtime context-separation tests

**Produces:** bounded independent research perspectives using the existing model gateway/role/context machinery.

Required default perspectives for consequential research:

1. initial candidate/solution generation;
2. falsifier — what makes the current answer wrong;
3. frame challenger — hidden assumptions and different problem classes;
4. opportunity/adjacent-domain scout — missing categories/hybrids;
5. coverage challenger — what search space/evidence remains missing.

- [ ] **Step 1: Write tests proving each perspective receives a fresh bounded context** and cannot consume prior private reasoning as evidence.
- [ ] **Step 2: Implement deterministic perspective selection by Research Contract consequence/requirements.**
- [ ] **Step 3: Route perspectives through the existing provider-neutral model boundary.** Do not add a `SmallModelPort`.
- [ ] **Step 4: Mark every model-generated idea as unverified hypothesis/candidate until researched.**
- [ ] **Step 5: Add no-progress/deduplication fingerprints so repeated equivalent candidate sets do not cause unbounded loops.**

**Hard gate:** divergence can expand the search space but cannot create verified facts or certify a conclusion.

---

## Phase 9.4 — Implement Discovery Planner and source-class strategy

**Files:**
- Create: `packages/application/src/research/research-discovery-planner.ts`
- Create: `apps/runtime/src/autonomy/research/research-discovery-runtime.ts`
- Test: strategy-selection/coverage tests

**Produces:** independent search directions and source-class requirements from the Research Contract.

- [ ] **Step 1: Write failing tests** that reject paraphrase-only search plans when multiple independent strategies are required.
- [ ] **Step 2: Implement strategy catalog** for name, capability, problem, architecture, component, alternatives/competitors, ecosystem, negative/failure, migration/replacement, adjacent-domain, assumption-inversion, and hybrid searches.
- [ ] **Step 3: Implement applicable source classes** for official/vendor, code host, registry, research/benchmark, ecosystem/directory/marketplace, community/user report, and current reporting.
- [ ] **Step 4: Require primary-source verification for material capability/availability/price/version/licensing/API/policy/compatibility claims where primary evidence exists.**
- [ ] **Step 5: Route actual retrieval only through existing governed tools/Skills/MCP/browser mechanisms.** No direct network bypass.

**Hard gate:** high-consequence research cannot satisfy coverage with one familiar source class or paraphrased query loop.

---

## Phase 9.5 — Candidate registry, contradiction, and challenger search

**Files:**
- Create: `packages/application/src/research/research-candidate-registry.ts`
- Create: `packages/application/src/research/research-challenger-policy.ts`
- Test: candidate/challenger/contradiction tests

**Produces:** bounded candidate comparison/provenance artifacts and deterministic requirements for strongest-challenger/negative-evidence work.

- [ ] **Step 1: Write failing tests** for duplicate candidates, unsupported claims, missing elimination reasons, missing strongest challenger, and unresolved contradiction falsely marked complete.
- [ ] **Step 2: Implement normalized bounded candidate records** carrying category, discovery strategy/source class, verified strengths/constraints, unresolved claims, contradictions, and finalist/elimination reason.
- [ ] **Step 3: Require negative/failure/migration searches when contract consequence requires challenger coverage.**
- [ ] **Step 4: Require evidence capable of overturning the current leader to be actively sought rather than only supporting evidence.**
- [ ] **Step 5: Store comparison/candidate tables as artifacts and verified claims as Evidence references.**

**Hard gate:** current leader cannot pass consequential research without a completed strongest-challenger/contradiction round.

---

## Phase 9.6 — Search saturation and independent coverage audit

**Files:**
- Create: `packages/application/src/research/research-saturation-policy.ts`
- Extend: `apps/runtime/src/autonomy/task-auditor.ts` through a bounded research-audit path; do not give Auditor mutation authority
- Test: saturation and Auditor blind-spot tests

**Produces:** deterministic stop/continue decision based on coverage and diminishing meaningful discovery yield.

- [ ] **Step 1: Write failing tests** for premature saturation with missing source classes, missing primary verification, omitted challenger, unresolved contradiction, or unexplored required adjacent-domain strategy.
- [ ] **Step 2: Implement bounded round/yield accounting** based on meaningful new candidates/material evidence, not raw result count.
- [ ] **Step 3: Add read-only Auditor research questions:** missed source class, framing assumption, strongest omitted challenger, missing primary proof, unresolved contradiction, false saturation, conclusion-strength mismatch.
- [ ] **Step 4: Material Auditor blind spots produce coverage failure and another bounded research round or non-success.**
- [ ] **Step 5: Prove Auditor cannot alter candidate/evidence/Task state directly.**

**Hard gate:** saturation is evidence-backed and independently challenged; search stops for sufficient coverage rather than arbitrary query count.

---

## Phase 9.7 — Conclusion gate, free-first, and actionable non-success

**Files:**
- Create: `packages/application/src/research/research-conclusion-policy.ts`
- Create/extend: runtime research finalization path under `apps/runtime/src/autonomy/research/`
- Test: conclusion/free-first/failure-result tests

**Produces:** final decision artifact/receipt whose conclusion strength cannot exceed Research Coverage.

- [ ] **Step 1: Write tests for claim-strength ladder** from simple discovery through `best available` and prove insufficient coverage is refused.
- [ ] **Step 2: Implement free-first selection** only among candidates meeting correctness/reliability/security/capability/acceptance floors.
- [ ] **Step 3: Implement total-lifecycle-cost comparison** so a paid candidate may correctly beat a free candidate when implementation/compute/maintenance/reliability burden proves lower overall cost.
- [ ] **Step 4: Implement mandatory actionable non-success output:** best currently workable solution + exact unmet requirement/compromise + strongest next experiment/path.
- [ ] **Step 5: Prove `RESEARCH_INCOMPLETE`/`NO_VERIFIED_SOLUTION` cannot silently become a strong positive recommendation.**

**Hard gate:** final language and recommendation strength are mechanically bounded by evidence/coverage; no-solution cases remain actionable without false certainty.

---

## Phase 9.8 — Research Receipt, restart/replay, and integration proof

**Files:**
- Create: `packages/application/src/research/research-receipt.ts` or artifact builder equivalent; do not add a new authoritative store unless proven necessary
- Create: `scripts/prove-research-intelligence-real.mjs`
- Create: `docs/reviews/research-intelligence-proof.md`
- Extend: autonomy integration tests

**Produces:** bounded provenance artifact containing contract reference, strategies/queries, source classes, source references/freshness, candidates/finalists, primary verification, contradictions, challenger round, saturation evidence, coverage verdict, permitted conclusion class, unresolved uncertainty, and actionable non-success fields where applicable.

- [ ] **Step 1: Write receipt determinism/bounds tests.**
- [ ] **Step 2: Prove receipt references canonical Evidence rather than copying unbounded source bodies/history.**
- [ ] **Step 3: Prove restart/replay retains receipt/coverage/decision references and does not repeat completed externally meaningful research effects blindly.**
- [ ] **Step 4: Add end-to-end hidden-winner fixtures** where a familiar/GitHub-first candidate loses to an option found through another source class/adjacent category/hybrid/contradiction search.
- [ ] **Step 5: Add a no-full-solution fixture** proving best-current + exact-gap + next-experiment output.
- [ ] **Step 6: Add free-vs-paid fixtures** proving free wins when floors are equal and paid wins when free fails the floor or total lifecycle cost.
- [ ] **Step 7: Run target-host proof if external research prerequisites are available; report missing prerequisites honestly.**
- [ ] **Step 8: Run full gates.**
```bash
pnpm check
git diff --check
node scripts/prove-research-intelligence-real.mjs
```

**Hard gate:** Research Intelligence passes end-to-end with current V31M4 authority, no second database/orchestrator, durable provenance, restart safety, and no false `best available` conclusion.

---

## Task 11 and Task 12 integration amendments

When the renumbered **Task 11 Quality Floor** is implemented, it must consume Research Coverage for research-dependent conclusions; model confidence/majority/extra critique cannot substitute for missing required coverage.

When the renumbered **Task 12 Eval Lab** is implemented, add hidden-winner research evaluation measuring:

- final verified decision quality;
- hidden-winner discovery rate;
- useful unique discoveries per compute;
- irrelevant-candidate rate;
- primary-source verification rate;
- contradiction detection;
- false-`best available` rate;
- total research cost;
- incremental value of heterogeneous challenger models versus fresh-context primary-model passes.

Only promote heterogeneous model routing if measured final-judgment value exceeds the simpler default.

## Self-review checklist

Before Task 9 implementation begins, independently confirm:

- the accepted Task 6 SHA remains the ancestry baseline and Tasks 0–6 are not reopened;
- Task 7 Project Intelligence and Task 8 Skills/MCP contracts are current;
- no existing application concept already supplies each proposed research type/policy;
- no public runtime API change is necessary;
- all new state fits Task/Ledger/Evidence/Artifact authority;
- issue #9 references are reconciled to the new Task 10 numbering where applicable;
- source/provider choices remain replaceable mechanisms, not architecture dependencies.
