# V31M4 Research Intelligence Architecture Amendment

**Status:** APPROVED CANONICAL AMENDMENT — implementation source of truth for the new Research Intelligence phase  
**Date:** 2026-08-27  
**Program:** `V31M4-AUTONOMY-001 / 1.1.0`  
**Amends:** `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`  
**Issue references:** #16, #17, #18, #20, #25, #26  
**Runtime API:** remains `1.0.0`; this amendment does not authorize a public API change

## 1. Purpose

This amendment adds a first-class **Research Intelligence** phase to prevent premature research convergence: finding a plausible answer from an incomplete search space and then presenting it with stronger certainty than the research coverage supports.

The governing intelligence objective is:

> **V31M4 seeks verified correctness wherever correctness can be deterministically established. Where exact correctness cannot be established, V31M4 seeks the highest-supported judgment available through evidence acquisition, alternative generation, falsification, independent verification, and calibrated uncertainty. It never strengthens a conclusion beyond the evidence supporting it.**

Research Intelligence exists to improve final decision correctness and judgment quality. Search count, model agreement, creativity, verbosity, number of agents, or number of sources are not success metrics by themselves.

## 2. Placement and task numbering

Insert **Task 9 — Research Intelligence** after Task 8 (Skills + MCP) and before Memory.

Later not-yet-started phases move as follows:

- Memory Router: Task 9 -> **Task 10**
- Quality Floor Controller: Task 10 -> **Task 11**
- Eval Lab / sandbox bakeoff: Task 11 -> **Task 12**
- Self-improvement lab: Task 12 -> **Task 13**

Tasks 0–8 retain their existing identities and history. This amendment does not reopen accepted Tasks 0–6 or redesign Tasks 7–8.

## 3. One-authority rule

Research Intelligence must reuse existing V31M4 authority rather than create a parallel research system.

- Task Capsule owns the bounded research objective, Research Contract references, unresolved questions, assumptions, and current decision state.
- Execution Ledger records research actions, source discoveries, observations, invalidations, and externally meaningful effect provenance.
- Evidence stores verified claims and provenance.
- Artifacts store candidate tables, comparison matrices, research receipts, and final research reports.
- Derived lexical/vector/graph/research indexes remain rebuildable non-authoritative caches.
- The Auditor and Quality Floor consume Research Coverage; they do not create a second evidence or acceptance authority.

No external search product, agent framework, browser, MCP server, indexer, repository host, or research database becomes authoritative state.

## 4. Research Contract

Before consequential research begins, V31M4 creates a bounded Research Contract for the decision or claim.

The contract must define, as applicable:

- exact decision/question and decision class;
- claim strength being attempted;
- consequence/risk class;
- freshness requirement;
- objective dimensions and constraints;
- applicable source classes;
- required independent search strategies;
- primary-source verification requirement;
- contradiction/challenger requirement;
- unknown-unknown/adjacent-domain requirement;
- search-saturation requirement;
- monetary/compute/time/maintenance constraints;
- completion and abstention conditions.

Research effort scales with decision consequence. Low-stakes questions remain cheap. Claims such as `best available`, `nothing better found`, `comprehensive`, or `exhaustive` require much stronger coverage than `I found X` or `X appears suitable`.

## 5. Fresh-context divergence and falsification

Research Intelligence must challenge the framing before and during discovery.

Required functions include:

- identify hidden assumptions;
- ask what would make the current answer wrong;
- invert important assumptions;
- remove or relax an assumed requirement and redesign;
- search for entirely different solution classes;
- search adjacent industries/domains;
- generate hybrid/component solutions;
- seek counterexamples and disconfirming evidence;
- identify what evidence would overturn the current leader.

The default mechanism is the primary capable model in **separate fresh bounded contexts** for solution generation, falsification, frame challenge, alternative generation, and coverage audit. Prior private reasoning is not carried as evidence.

A dedicated 1–4B small-model subsystem is **not required**. Heterogeneous challenger models may later be routed into an existing role only if Task 12 evaluation proves a material improvement in final verified judgment or hidden-option discovery. Do not add a dedicated `SmallModelPort` merely for possible future use.

Brainstorming/divergence generates hypotheses and search directions only. It contributes zero proof toward Research Coverage until the resulting claims/candidates are externally investigated and verified.

## 6. Discovery Planner

The Discovery Planner must use independent search directions, not repeated paraphrases of one query.

Applicable strategies include:

- exact-name search;
- capability search;
- problem-first search;
- architecture-pattern search;
- component/subsystem search;
- alternatives/competitor search;
- ecosystem/category search;
- negative/failure search;
- migration/replacement search;
- adjacent-domain search;
- assumption-inversion search;
- combination/hybrid search.

The Research Contract selects which strategies are required. High-consequence selection must include at least one framing challenge and at least one challenger/contradiction direction.

## 7. Source-class coverage

Coverage is measured over **applicable source classes**, not raw result count.

Depending on the task, source classes may include:

- official/vendor sites, documentation, release notes, specifications;
- source-code hosts such as GitHub/GitLab/Codeberg;
- registries such as npm, PyPI, Hugging Face, Ollama, Docker/container registries;
- papers, benchmarks, arXiv, academic/standards sources;
- product ecosystems, directories, marketplaces, provider catalogs;
- community/user reports such as Reddit, forums, issue trackers, migration reports;
- current technical reporting/news/blogs when freshness matters.

Not every research task requires every class. The Research Contract determines applicability and minimum required coverage.

Primary-source verification is required for material capability, availability, price, version, licensing, API, policy, or compatibility claims whenever a primary source exists.

## 8. Candidate and contradiction coverage

Research Intelligence must maintain a bounded candidate registry containing:

- candidate identity/category;
- discovery strategy/source class;
- claimed fit;
- verified strengths/constraints;
- unresolved claims;
- contradictions/negative evidence;
- reason for elimination or finalist status.

The system must actively search for:

- strongest challenger to the current leader;
- evidence against the current leader;
- migration-away reports;
- known failure modes;
- adjacent solutions that remove a requirement rather than satisfy it directly;
- combinations of smaller components that outperform a monolithic candidate.

Consensus among models is never evidence.

## 9. Search saturation

Research stops because coverage is sufficient, not because a fixed number of searches ran.

For high-consequence selection, successive discovery rounds continue until all applicable conditions are met:

1. required source classes have been searched;
2. required independent search strategies have been executed;
3. finalists have primary-source verification where available;
4. contradiction/challenger search has been completed;
5. unknown-unknown/adjacent-domain search has been completed where required;
6. successive rounds produce diminishing meaningful new candidates or material evidence;
7. the independent Auditor finds no material unexplored search-space defect.

If the saturation gate fails, the conclusion is research-incomplete regardless of how polished the comparison appears.

## 10. Conclusion-strength gate

Research Coverage deterministically bounds the language/decision class V31M4 may emit.

Illustrative strength ladder:

1. `I found X`
2. `X appears suitable`
3. `X is the current leader among verified candidates`
4. `X is the best I found under this Research Contract`
5. `No better candidate was found after required challenger/saturation coverage`
6. `X is the best available option established under the current evidence and contract`

A lower-coverage research run may not emit a higher-strength conclusion.

Where exact correctness is deterministically establishable, V31M4 should prove it rather than substitute judgment.

## 11. Failure-result rule

A failed exhaustive search is not a useful final answer by itself.

When no candidate fully satisfies the Research Contract, V31M4 must return:

1. **best currently workable solution** supported by the evidence;
2. **exact unmet requirement or compromise** that prevents full satisfaction;
3. **strongest next experiment, search direction, or implementation path** capable of removing that compromise.

The research verdict may still be `RESEARCH_INCOMPLETE`, `NO_VERIFIED_SOLUTION`, or another bounded non-success state, but the decision artifact must not stop there when a useful partial path exists.

## 12. Free-first selection rule

Monetary cost is a first-class decision dimension.

When multiple candidates satisfy the required correctness, reliability, security, capability, and acceptance floor, V31M4 prefers a solution with zero recurring monetary cost.

A paid solution may win when:

- no free candidate satisfies the required floor; or
- evidence shows the paid candidate has lower total lifecycle cost after implementation effort, compute, maintenance, operational burden, reliability, and switching risk are included.

Free-first is subordinate to correctness, safety, reliability, and capability. It is not permission to select a weaker or unsafe solution merely because it is free.

## 13. Research receipt

Every consequential research decision produces a bounded Research Receipt artifact containing:

- Research Contract fingerprint/reference;
- search strategies/queries executed;
- source classes covered;
- source references and freshness metadata;
- candidate registry/finalists;
- primary verification results;
- contradiction/challenger findings;
- saturation evidence;
- coverage verdict;
- conclusion class permitted;
- unresolved uncertainty;
- best-current-solution/gap/next-path result when no full solution exists.

The receipt is provenance, not a second authority. Verified claims reference canonical Evidence records.

## 14. Independent audit

The Auditor must audit both the answer and the research process.

It must challenge:

- missing source classes;
- framing assumptions;
- unexplored solution categories;
- strongest omitted challenger;
- missing primary-source proof;
- contradictions not resolved;
- false saturation;
- conclusion language stronger than coverage;
- free-first being used to justify a candidate below the required floor.

A material blind spot fails Research Coverage and triggers another bounded research round or a non-success result.

## 15. Quality Floor integration

Task 11 Quality Floor consumes Research Coverage as an input for research-dependent decisions.

The Quality Floor does not satisfy missing research by model confidence, majority agreement, or an extra critique pass. Missing required coverage remains missing evidence/context.

The execution ladder remains compatible with:

```text
DIRECT -> CHECKED -> COMPETITIVE -> ADVERSARIAL -> DECOMPOSE
-> SPECIALIST_OR_ALTERNATE -> ACQUIRE_CONTEXT -> NO_VERIFIED_SOLUTION
```

Research Intelligence primarily strengthens `ACQUIRE_CONTEXT`, alternative generation, falsification, and the evidence required before high-strength conclusions.

## 16. Evaluation requirements

Task 12 Eval Lab must include hidden-winner research cases where:

- the obvious GitHub/repository answer is inferior;
- the better option appears in official docs, a package/model registry, an adjacent category, a communications/platform layer, or a component combination;
- negative/migration evidence overturns a popular candidate;
- a free candidate meets the floor and should beat a paid candidate;
- a paid candidate correctly wins because the free path fails reliability/capability or has worse total lifecycle cost;
- no candidate fully satisfies the contract, requiring best-current-solution + exact-gap + next-experiment output.

Measure at minimum:

- final verified decision quality;
- hidden-winner discovery rate;
- meaningful unique candidate discovery per compute;
- irrelevant-candidate rate;
- primary-source verification rate;
- contradiction detection;
- false-`best available` rate;
- research cost in time/model/tool use;
- incremental value of any heterogeneous challenger model versus fresh-context primary-model passes.

Only mechanisms with measured positive value are promoted.

## 17. Hard non-goals

- No full external research-agent framework becomes V31M4 authority.
- No dedicated small-model architecture is required.
- No raw search count is treated as coverage.
- No brainstorming output is treated as evidence.
- No separate research database becomes canonical state.
- No provider/vendor is hard-coded by this amendment.
- No public runtime API change is authorized.
- No accepted Task 0–6 implementation is reopened by this amendment.

## 18. Hard gate

Research Intelligence is complete only when tests and evaluation prove:

- Research Contract enforcement;
- independent strategy and applicable source-class coverage;
- fresh-context divergence/falsification;
- primary verification where available;
- challenger/contradiction handling;
- saturation refusal when coverage is incomplete;
- conclusion-strength gating;
- best-current-solution + exact-gap + next-path behavior;
- free-first selection without lowering the quality floor;
- durable provenance through existing Task/Ledger/Evidence/Artifact authority;
- no second research authority;
- restart/replay preserves the research decision state and receipt references.
