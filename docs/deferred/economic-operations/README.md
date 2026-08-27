# V31M4 Economic Operations Department

**Status:** DEFERRED DESIGN ONLY — STORED FOR FUTURE USE, NOT AUTHORIZED FOR IMPLEMENTATION  
**Program:** `V31M4-ECONOMIC-OPS-001`  
**Type:** Removable first-party department / plugin  
**Implementation timing:** After the current V31M4 autonomy-quality program is complete and the department design is separately approved for build  
**Core rule:** V31M4 remains the sole system authority. Economic Operations owns business-specific logic and business-specific resources only.

## Repository quarantine

This document is intentionally stored under `docs/deferred/economic-operations/` as a future design artifact.

It is **not** current implementation authority and must not be treated as evidence that Economic Operations exists, is registered, is buildable, or is part of the supported runtime.

Models and contributors should read or use this document only when a task explicitly concerns Economic Operations, future business-department design, or promotion of this deferred design toward implementation.

Until explicit implementation authorization is given:

- do not create an Economic Operations package or plugin from this document;
- do not add it to pnpm workspaces, Turborepo tasks, runtime composition, plugin manifests, startup requirements, CI build targets, or current implementation maps;
- do not introduce core changes solely to satisfy this deferred design;
- do not treat proposed entities, states, ports, provider choices, or workflows below as frozen implementation contracts;
- preserve core startup, tests, packaging, and release acceptance with Economic Operations absent.

Promotion from this deferred document to an implementation source of truth requires a fresh repository audit, Research Intelligence pass, explicit owner authorization, and a separately accepted implementation plan.

---

## 1. Purpose

The Economic Operations department gives V31M4 the ability to:

> **find, validate, build, launch, run, manage, improve, scale, hold, or shut down a business with minimal owner involvement while remaining inside explicit delegated authority.**

The department is not a second autonomous system and is not required for V31M4 core operation.

When the department is absent, V31M4 must still be able to operate its core autonomy, research, memory, evidence, verification, assistant/comms, and other departments normally.

When the department is installed, V31M4 gains business-specific operating capability.

---

## 2. Architectural Placement

```text
V31M4 CORE
├── autonomy / task execution
├── Manager → Executor → Auditor
├── Research Intelligence
├── Project Intelligence
├── memory
├── evidence / verification
├── quality floor
├── skills / tools / MCP
├── policy / approvals
├── scheduler
├── secrets / credential handling
├── effect reconciliation
└── Assistant / Comms

        │
        ▼

ECONOMIC OPERATIONS DEPARTMENT
├── Opportunity Intelligence
├── Business Validation
├── Venture Builder
├── Revenue Operations
├── Business Operations
├── Financial Operations
├── Business Control
└── Business Portfolio
```

### Permanent boundary

The core supplies generic intelligence, execution, policy, security, evidence, scheduling, and communication infrastructure.

The Economic Operations department supplies business-specific reasoning, workflows, policies, resources, measurements, and decisions.

Do not move business-specific concepts into core merely because Economic Operations uses them.

---

## 3. Department Independence Invariant

Economic Operations must be removable.

Core startup, tests, packaging, release acceptance, and normal V31M4 operation must succeed with Economic Operations absent.

Economic Operations must interact with V31M4 only through approved generic department/plugin host contracts, application ports, runtime contracts, and governed tool/model boundaries.

The department must not:

- own or directly access authoritative V31M4 SQLite state outside approved ports;
- become a second scheduler;
- become a second memory system;
- create an independent agent authority hierarchy;
- bypass Manager → Executor → Auditor where those roles are required;
- bypass policy, approvals, secrets, evidence, or effect reconciliation;
- place business-specific logic inside frozen core packages unless a separately approved generic core requirement is proven.

---

## 4. Business Instance Model

Economic Operations may manage one or more independent businesses.

Each business is treated as a bounded business instance with its own resources, accounts, operating state, policies, and evidence.

Example:

```text
Economic Operations
├── Business A
│   ├── checking / operating account
│   ├── savings / reserve account
│   ├── payment processor
│   ├── email
│   ├── domain / website
│   ├── social-media accounts
│   ├── marketplace/store accounts
│   ├── CRM / customer records
│   ├── vendor accounts
│   ├── analytics
│   ├── operating budget
│   ├── reserve policy
│   └── delegated authority
│
├── Business B
│   └── independent resources and policies
│
└── Business Portfolio Control
```

A business's accounts and assets belong to that business context, not to V31M4 personally and not to unrelated departments.

---

## 5. Business Resource Isolation

Every business resource must be explicitly bound to the correct business instance.

Examples include:

- bank/checking account;
- savings/reserve account;
- payment processor;
- credit-card or debit-card account if later authorized;
- domain registrar;
- hosting account;
- website/storefront;
- business email;
- social-media profiles;
- ad accounts;
- marketplace accounts;
- CRM;
- customer-support platform;
- bookkeeping/accounting system;
- shipping/fulfillment provider;
- vendor/supplier accounts;
- analytics systems;
- business phone/communication account;
- business-specific APIs and credentials.

V31M4 core continues to own generic secret handling and authorization mechanisms.

Economic Operations owns the semantic meaning of these resources and how they are used for the business.

Cross-business use of money, credentials, accounts, customer data, or authority is forbidden unless an explicit owner-approved policy permits it.

---

## 6. Economic Operations Capability Stack

### 6.1 Opportunity Intelligence

Purpose: find economically useful opportunities instead of waiting for the owner to invent them.

Responsibilities:

- discover unmet demand;
- find underserved markets;
- identify recurring customer pain;
- detect new products/services enabled by new technology;
- identify acquisition/resale/arbitrage opportunities where legal and appropriate;
- discover business-model opportunities;
- analyze competitors and substitutes;
- estimate customer willingness to pay;
- estimate startup cost and operating burden;
- identify distribution channels;
- estimate time-to-first-revenue;
- identify major regulatory, legal, platform, or operational blockers;
- rank opportunities by evidence rather than novelty.

Opportunity Intelligence must use V31M4 Research Intelligence rather than creating a parallel research subsystem.

Research strength must match decision consequence.

A plausible idea is not a validated opportunity.

---

### 6.2 Business Validation

Purpose: determine whether an opportunity deserves capital and implementation effort before V31M4 builds a full business around it.

Validation methods may include:

- market-demand evidence;
- competitor revenue/activity signals;
- customer interviews or surveys where authorized;
- landing-page tests;
- waitlists;
- preorders where lawful and clearly disclosed;
- pricing tests;
- offer tests;
- small advertising tests;
- marketplace demand tests;
- search-demand evidence;
- community demand evidence;
- unit-economics modeling;
- manually delivered prototype/service tests;
- minimum viable product experiments;
- controlled outreach campaigns.

Validation must seek cheap information before expensive commitment.

The system should prefer killing a weak idea early over rationalizing sunk cost.

A validation result should be able to conclude:

```text
VALIDATED
REQUIRES_MORE_EVIDENCE
REJECTED
BLOCKED
NO_VERIFIED_OPPORTUNITY
```

If no option fully satisfies the Business Validation contract, Economic Operations must return:

1. the best currently workable option;
2. the exact remaining compromise or uncertainty;
3. the strongest next experiment or path capable of removing that compromise.

A failed search must not terminate at "no solution found" when a useful next-best path exists.

---

### 6.3 Venture Builder

Purpose: convert a validated opportunity into an operating business.

Responsibilities may include:

- define the offer;
- define target customer;
- define business model;
- define pricing;
- select brand/name subject to availability checks;
- acquire/configure domain where authorized;
- create website/storefront;
- configure business email;
- configure payment collection;
- create required business social accounts;
- establish CRM/customer support path;
- assemble operating procedures;
- create required content/assets;
- connect fulfillment/service-delivery workflows;
- define metrics;
- define launch plan;
- run launch acceptance checks;
- launch only when required evidence and authority gates pass.

Venture Builder coordinates specialist V31M4 departments when useful.

Examples:

- Video Production can create marketing/video assets.
- Future graphics/design capabilities may create brand assets.
- Software-building capabilities can create a website, SaaS product, automation, or internal tools.

Economic Operations owns the business objective; specialist departments own specialized production work.

---

### 6.4 Revenue Operations

Purpose: acquire and retain customers rather than merely creating a business that exists.

Responsibilities:

- identify acquisition channels;
- build and test offers;
- generate leads;
- perform authorized outreach;
- manage funnels;
- create and test marketing assets;
- run organic social activity;
- run paid advertising when authorized;
- manage CRM state;
- perform follow-ups;
- qualify leads;
- support sales workflows;
- optimize pricing;
- improve conversion;
- improve retention;
- improve repeat purchase;
- identify upsell/cross-sell opportunities;
- measure acquisition cost and customer value;
- stop channels that fail evidence thresholds.

Revenue Operations must not optimize vanity metrics at the expense of verified economic value.

Primary objectives should ultimately connect to revenue, contribution margin, customer value, or another explicitly approved business objective.

---

### 6.5 Business Operations

Purpose: reliably deliver what the business promises.

Responsibilities may include:

- order/work intake;
- service fulfillment;
- digital-product delivery;
- customer onboarding;
- customer support;
- vendor coordination;
- supplier management;
- inventory where applicable;
- scheduling;
- shipping/fulfillment coordination;
- refunds/returns according to policy;
- quality control;
- recurring work;
- issue/exception handling;
- operational documentation;
- process improvement;
- monitoring operational dependencies.

The department should automate routine operations inside delegated authority and escalate only when owner authority or genuinely unavailable judgment is required.

---

### 6.6 Financial Operations

Purpose: understand and govern the money of each business instance.

This remains inside Economic Operations until broader cross-department monetary authority is proven necessary.

Responsibilities:

- business-specific checking account awareness;
- savings/reserve-account awareness;
- payment-processor state;
- revenue tracking;
- expense tracking;
- cash-flow forecasting;
- operating budget;
- reserve requirements;
- vendor/payment obligations;
- receivables/payables awareness where applicable;
- bookkeeping inputs and reconciliation support;
- profitability calculations;
- unit economics;
- tax-document preparation support where appropriate;
- spending proposals;
- bounded business spending when explicitly authorized;
- financial anomaly detection;
- runway estimates;
- capital allocation between approved business activities.

### Business spending authority

Any autonomous financial authority must be explicitly scoped per business.

Example policy:

```text
Business: ExampleCo
Operating account: bound resource A
Reserve account: bound resource B
Minimum reserve: $2,000
Maximum autonomous transaction: $75
Maximum autonomous daily spend: $150
Maximum monthly experiment budget: $500
Debt creation: forbidden
New credit: forbidden
Transfers to unrelated businesses: forbidden
Owner distribution: owner-only
Policy expansion: owner-only
```

The department may decide within the envelope.

Outside the envelope, V31M4 Assistant/Comms requests owner authority.

No department may expand its own financial authority.

---

### 6.7 Business Control

Purpose: continuously determine what should happen next to the business.

Business Control consumes verified operating and financial state and makes decisions such as:

```text
MAINTAIN
IMPROVE
EXPERIMENT
SCALE
REDUCE
PAUSE
PIVOT
SHUT_DOWN
ESCALATE_OWNER
```

Metrics may include:

- revenue;
- gross profit;
- contribution margin;
- cash balance;
- reserve balance;
- burn/runway;
- customer acquisition cost;
- lifetime value;
- conversion rate;
- refund rate;
- churn;
- repeat purchase;
- operational failure rate;
- support burden;
- vendor reliability;
- time burden;
- owner-attention burden;
- risk exposure;
- market change;
- opportunity cost.

Business Control should favor economic reality over sunk cost or emotional attachment.

Scaling requires evidence.

Worsening results should generally reduce risk-taking rather than increase it.

---

## 7. Business Portfolio Control

Economic Operations may eventually manage multiple businesses.

Portfolio Control determines where attention and business-owned capital should be allocated across the portfolio.

It may compare:

- expected return;
- demonstrated return;
- risk;
- required capital;
- required time;
- operational complexity;
- scalability;
- owner-attention requirement;
- strategic value;
- confidence/evidence strength.

It may recommend or, when authorized, execute:

- funding one business over another;
- reducing investment in a weak business;
- shutting down a failing experiment;
- scaling a proven business;
- launching a new validation test;
- holding reserves rather than deploying capital.

Cross-business fund transfers require explicit policy and must never be inferred merely because the same owner controls both businesses.

---

## 8. End-to-End Business Loop

```text
RESEARCH INTELLIGENCE
        ↓
OPPORTUNITY INTELLIGENCE
        ↓
Candidate opportunities
        ↓
BUSINESS VALIDATION
        │
        ├── REJECTED → record lesson → search again
        │
        ├── MORE EVIDENCE → cheapest useful experiment
        │
        └── VALIDATED
               ↓
         VENTURE BUILDER
               ↓
             LAUNCH
               ↓
         REVENUE OPERATIONS
               ↓
         acquire customers
               ↓
         BUSINESS OPERATIONS
               ↓
         deliver value
               ↓
         FINANCIAL OPERATIONS
               ↓
         measure economics
               ↓
         BUSINESS CONTROL
               ↓
      ┌────────┼────────┬────────┐
      ▼        ▼        ▼        ▼
   improve   scale    pivot    shut down
      │        │        │
      └────────┴────────┘
               ↓
             repeat
```

The department should be capable of operating this loop repeatedly without requiring the owner to manually initiate every phase.

---

## 9. Owner Relationship

Economic Operations must follow the V31M4 business-partner operating model.

### Routine action inside authority

```text
Decide → verify → act → record
```

Owner interruption is unnecessary.

### Material information the owner should know

```text
Handle what can be handled
        ↓
Send concise Discord update
```

### Owner authority required

```text
Prepare recommended decision
+ evidence
+ consequence of options
        ↓
Contact owner through Assistant/Comms
        ↓
Receive owner decision
        ↓
Revalidate current state and exact action
        ↓
Proceed only if still authorized
```

Uncertainty alone is not a reason to contact the owner.

V31M4 should first research, acquire evidence, seek alternatives, escalate intelligence, and use delegated judgment.

Owner contact is primarily an authority escalation.

---

## 10. Assistant / Discord Integration

Economic Operations does not own Discord or communications infrastructure.

It emits typed communication requirements to the V31M4 Assistant/Comms layer.

Examples:

```text
INFORMATIONAL_UPDATE
OWNER_ATTENTION
OWNER_DECISION_REQUIRED
URGENT_OWNER_DECISION
BUSINESS_EXCEPTION
BUSINESS_SUMMARY
```

The Assistant/Comms layer chooses the available channel.

Current default remote communication direction:

```text
AssistantChannelPort
        ↓
Discord Adapter
```

Discord is a replaceable communication adapter, not an Economic Operations dependency.

---

## 11. Research Intelligence Integration

Economic Operations must use V31M4 Research Intelligence for consequential external research.

Research Intelligence must support:

- research contracts;
- source-class diversity;
- query-strategy diversity;
- assumption/frame challenge;
- fresh-context falsification;
- adjacent-domain discovery;
- challenger search;
- contradiction search;
- candidate coverage;
- search saturation;
- conclusion-strength gating.

Business-specific research may define additional source classes, such as:

- customer marketplaces;
- industry directories;
- government/business registries;
- pricing pages;
- ad libraries;
- app stores;
- product marketplaces;
- job postings;
- customer reviews;
- forums/community discussions;
- search trends;
- supplier catalogs;
- financial filings where relevant;
- regulatory sources.

### Research failure rule

When no candidate fully satisfies the Research Contract, the department must not stop at an empty failure.

It must provide:

1. **best currently workable solution;**
2. **exact unmet requirement or compromise;**
3. **best next experiment/path that could eliminate the compromise.**

---

## 12. Free-First Rule

Economic Operations should remain free or near-zero recurring cost whenever a free solution satisfies the required quality floor.

Selection rule:

> When multiple solutions satisfy required correctness, reliability, security, capability, and maintainability, prefer the solution with the lowest total lifecycle cost, favoring zero recurring monetary cost.

Total lifecycle cost includes:

- money;
- implementation effort;
- maintenance effort;
- compute;
- reliability cost;
- owner-attention cost;
- switching/lock-in cost;
- failure risk.

A nominally free service that requires substantial fragile automation may lose to a low-cost supported API.

Paid mechanisms may be used when free options fail the required floor or when evidence demonstrates a lower total lifecycle cost.

---

## 13. Evidence and Judgment Rules

The department inherits the V31M4 quality principle:

> Seek verified correctness wherever correctness can be established. Where exact correctness cannot be established, seek the highest-supported judgment available and do not claim more certainty than the evidence supports.

Business decisions must distinguish:

```text
FACT
VERIFIED_MEASUREMENT
ESTIMATE
ASSUMPTION
HYPOTHESIS
JUDGMENT
DECISION
```

Model confidence is not evidence.

Financial projections are not treated as realized results.

Marketing claims are not treated as customer demand without evidence.

A business is not considered successful because it launched.

---

## 14. Risk and Authority Principles

Economic Operations must fail closed on authority.

Required principles:

- no self-expanding permissions;
- no self-expanding spending limits;
- no debt unless separately and explicitly authorized;
- no use of household/personal funds unless separately and explicitly authorized;
- no collateralization unless separately and explicitly authorized;
- no hiding losses by transferring unrelated funds;
- preserve configured reserves;
- acquire cheap information before taking expensive risk;
- stage uncertain actions when possible;
- use bounded experiments;
- worsening performance decreases risk appetite;
- scaling requires verified evidence;
- consequential irreversible actions require stronger evidence and/or owner authority;
- every external effect follows normal V31M4 policy/evidence/reconciliation rules.

---

## 15. Business Lifecycle

Each business should progress through an explicit lifecycle.

Suggested states:

```text
DISCOVERED
VALIDATING
REJECTED
VALIDATED
BUILDING
READY_TO_LAUNCH
OPERATING
SCALING
PAUSED
PIVOTING
WINDING_DOWN
CLOSED
```

State transitions must be evidence-backed and checked.

Examples:

- `DISCOVERED -> VALIDATING` requires a bounded validation plan.
- `VALIDATING -> VALIDATED` requires validation acceptance evidence.
- `VALIDATED -> BUILDING` requires an approved business build plan and resource envelope.
- `BUILDING -> READY_TO_LAUNCH` requires launch acceptance checks.
- `READY_TO_LAUNCH -> OPERATING` requires launch authorization and verified required dependencies.
- `OPERATING -> SCALING` requires explicit scale criteria and supporting evidence.
- `OPERATING -> WINDING_DOWN` requires a shutdown decision and safe closure plan.
- `WINDING_DOWN -> CLOSED` requires reconciliation of outstanding obligations/resources.

Do not force this exact state model into implementation until repository audit confirms the best fit with existing V31M4 Mission/Task/plugin state.

---

## 16. Business Tooling Philosophy

Economic Operations should not rebuild commodity business software.

Preferred model:

```text
V31M4 intelligence
        ↓
Economic Operations business logic
        ↓
generic governed ports/tools
        ↓
replaceable external service adapters
```

Likely adapter categories:

- banking/financial data;
- payments;
- bookkeeping/accounting;
- email;
- social media;
- CRM;
- website/storefront;
- domain/hosting;
- advertising;
- analytics;
- ecommerce;
- marketplace;
- customer support;
- shipping/fulfillment;
- supplier/vendor systems.

Provider choice must remain replaceable wherever practical.

No provider should become V31M4 authority.

---

## 17. Trading / Speculation

Trading is **not required** for the core Economic Operations department to satisfy the goal of finding, building, running, and managing businesses.

If added later, Trading must be an isolated optional capability with staged promotion:

```text
research
→ backtest
→ held-out evaluation
→ paper trading
→ forward paper trading
→ tiny live allocation
→ measured scaling
```

Trading must never gain access to unrelated business reserves or household funds merely because it is part of Economic Operations.

The department should be considered complete without Trading.

---

## 18. Initial Build Scope

When implementation is eventually authorized, prioritize the minimum complete business loop.

### Phase 1 — Department Foundation

- removable first-party plugin skeleton;
- business-instance identity/resource binding;
- department lifecycle;
- authority envelope representation;
- business state projection;
- integration with V31M4 task/evidence/policy infrastructure.

### Phase 2 — Opportunity + Validation

- opportunity discovery workflow;
- opportunity scoring;
- Research Intelligence integration;
- validation-plan generation;
- cheap experiment selection;
- validation evidence;
- kill/continue decision.

### Phase 3 — Venture Builder

- business build plan;
- provider/tool selection through Research Intelligence;
- creation workflow;
- website/offer/payment/social/tool orchestration;
- launch-readiness checks.

### Phase 4 — Revenue Operations

- acquisition-channel management;
- lead/customer lifecycle;
- marketing experiments;
- conversion/revenue measurement;
- stop/scale rules.

### Phase 5 — Business Operations

- fulfillment;
- customer support;
- vendor/supplier workflows;
- operational exception handling;
- recurring responsibilities.

### Phase 6 — Financial Operations

- account/resource binding;
- revenue/expense/cash state;
- reserve and budget policy;
- bounded spending authority;
- bookkeeping inputs;
- reconciliation;
- owner escalation for out-of-envelope transactions.

### Phase 7 — Business Control

- KPI/state model;
- intervention decisions;
- improve/scale/pivot/pause/shutdown logic;
- portfolio-level allocation if multiple businesses exist.

### Phase 8 — Real-World Bakeoff

Use at least one low-capital real business experiment to prove the complete loop.

The department is not accepted merely because unit/integration tests pass.

---

## 19. Acceptance Target

Economic Operations should not be considered production-ready until it can demonstrate an end-to-end campaign resembling:

```text
1. Discover multiple opportunity candidates.
2. Research broadly enough to justify candidate coverage.
3. Select a candidate using evidence.
4. Validate demand using bounded low-cost tests.
5. Reject weak candidates without owner intervention.
6. Build one validated business.
7. Configure required business resources.
8. Launch it.
9. Acquire at least one real customer or equivalent verified market outcome.
10. Fulfill the promised product/service.
11. Record revenue and expenses accurately.
12. Maintain configured reserve and spending limits.
13. Detect a business problem or optimization opportunity.
14. Correct or improve the operation.
15. Send the owner only materially useful information.
16. Escalate when owner authority is genuinely required.
17. Survive runtime interruption/restart without losing business state or duplicating consequential effects.
18. Produce an evidence-backed decision to maintain, improve, scale, pivot, pause, or shut down.
```

Success is measured by verified business outcomes, not by agent activity.

---

## 20. Explicit Non-Goals for Initial Version

Do not require the first Economic Operations release to:

- manage the owner's personal finances;
- pay personal bills;
- manage household accounts;
- create generalized V31M4-wide Capital Authority;
- operate every possible business type;
- perform autonomous legal representation;
- perform autonomous tax filing without appropriate review/authority;
- support unrestricted debt/credit creation;
- run speculative trading;
- own communications infrastructure;
- replace Research Intelligence;
- replace V31M4 core autonomy;
- become an independent agent platform.

---

## 21. Open Questions to Resolve Before Implementation

These should be answered through repository audit and Research Intelligence immediately before implementation, not prematurely frozen now.

1. What is the smallest durable business-instance representation that fits existing V31M4 domain/application boundaries?
2. Can existing Mission + TaskCapsule + Scheduler semantics represent ongoing business responsibilities without a new authority model?
3. Which business resource bindings need authoritative durable identity versus derived configuration?
4. What financial data/provider interface is best for the first real business?
5. What payment platform best fits the first business model?
6. Which bookkeeping/accounting path is free-first and sufficiently reliable?
7. Which CRM/customer representation is truly necessary for v1?
8. Which social-media APIs allow legitimate automated operation for the chosen business?
9. What level of business spending can be safely automated during the first live bakeoff?
10. What real business experiment gives the highest learning value at the lowest capital/risk?
11. Which metrics should determine scale, pause, or shutdown for that first business?
12. Which components should become reusable department capabilities only after repeated real-business evidence proves the abstraction useful?

---

## 22. Frozen Design Decisions

Unless later evidence justifies a correction:

1. **Economic Operations is a removable first-party V31M4 department.**
2. **This deferred design may be stored in the repository under `docs/deferred/economic-operations/`, but no Economic Operations implementation package/plugin may be added until the design is ready for implementation and explicit implementation authorization is given.**
3. **Business-specific bank accounts, savings/reserve accounts, payment systems, social accounts, domains, email, vendor accounts, and commercial resources belong to the business/Economic Operations context.**
4. **Do not add generalized personal-finance or core Capital Authority yet.**
5. **Core supplies generic policy, approvals, secrets, evidence, scheduling, execution, auditing, and effect reconciliation.**
6. **Economic Operations supplies business-specific opportunity, validation, creation, revenue, operations, finance, and control logic.**
7. **Research Intelligence is reused for external business research; no parallel research brain.**
8. **Assistant/Comms is reused for owner interaction; Discord is currently the default remote adapter but remains replaceable.**
9. **Free-first / lowest-total-lifecycle-cost selection applies when quality requirements are met.**
10. **Validation and Revenue Operations are first-class capabilities; they may not be omitted merely to simplify implementation.**
11. **Trading is optional and not required for department completion.**
12. **Provider integrations remain replaceable mechanisms and never become authoritative business state.**
13. **The department must be capable of rejecting, pivoting, or shutting down a business—not only creating and growing one.**
14. **When research cannot fully satisfy a requirement, return the best workable solution, exact remaining compromise, and best next path to remove it.**
15. **Final judgment quality and verified economic outcomes matter more than activity, agent count, or automation volume.**

---

## 23. North-Star Acceptance Statement

> **A finished Economic Operations department allows V31M4 to independently discover an economic opportunity, establish whether it deserves pursuit, construct the required business, acquire customers, deliver the promised value, operate the business, understand its finances, protect its reserves and authority limits, improve or scale it when evidence supports doing so, shut it down when evidence says it should stop, and involve the owner only when material information or owner-only authority makes that involvement necessary.**
