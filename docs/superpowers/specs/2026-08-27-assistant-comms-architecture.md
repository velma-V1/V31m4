# V31M4 Assistant and Communications Architecture

**Status:** APPROVED CURRENT-SYSTEM ARCHITECTURE — REQUIRED IN THE CURRENT V31M4 BUILD  
**Date:** 2026-08-27  
**Program:** `V31M4-ASSISTANT-001`  
**Type:** First-party interface/application subsystem; **not a department**  
**Initial remote channel:** Discord behind a replaceable provider-neutral boundary  
**Current sequencing:** after Task 10 Memory and before Task 11 Quality Floor  
**Runtime API:** remains `1.0.0` until a separately negotiated additive version is approved  
**Issue references:** #10, #15, #19, #21, #22, #23, #24, #28, #30, #31

## 1. Purpose

V31M4 must expose one persistent assistant identity that works in both directions:

> The owner can contact V31M4 whenever something is needed, and V31M4 can contact the owner whenever a material update or owner-only decision requires attention.

Assistant/Comms is part of the current system, not a future optional productization layer.

The current build sequence is:

```text
Task 7  Project Intelligence
Task 8  Skills + MCP
Task 9  Research Intelligence
Task 10 Memory
        ↓
V31M4-ASSISTANT-001
        ↓
Task 11 Quality Floor
Task 12 Eval Lab / sandbox bakeoff
Task 13 Self-improvement
```

The Assistant is implemented before Quality Floor so the owner-facing interface itself is included in final quality and evaluation campaigns.

## 2. One identity, multiple surfaces

Initial supported surfaces are:

- local V31M4 desktop/interface conversation;
- Discord as the first remote channel.

Desktop and Discord are interfaces to the **same V31M4 identity**, not separate assistants.

An interaction may begin on one channel and continue on another because durable meaning is stored in V31M4 authoritative state rather than in a channel transcript.

```text
owner sends Discord message
        ↓
V31M4 creates/updates authoritative work
        ↓
owner later opens desktop
        ↓
asks about the same work
        ↓
V31M4 resolves it from authoritative state
```

Future channels may supplement or replace Discord without redesigning V31M4 authority.

## 3. Architectural placement

Assistant/Comms belongs at V31M4's outer interface/application boundary:

```text
OWNER
  ↕
Desktop / Discord / future channels
  ↕
Assistant Gateway (non-authoritative)
  ↕
Assistant Runtime / Comms Role
  ↕
V31M4 authoritative runtime
  ↓
Manager -> Executor -> Auditor
  ↓
Tasks / Missions / Departments
```

It is **not**:

- a department;
- another autonomous-agent framework;
- another orchestrator;
- another task or memory database;
- another approval/policy system;
- a model-direct effect path.

## 4. Authority boundary

V31M4 remains authoritative for:

- mission/task state;
- Manager/Executor/Auditor progression;
- policy and approvals;
- evidence and acceptance;
- Ledger/effect reconciliation;
- memory validity;
- final delivery state.

Assistant/Comms may submit, route, narrate, and deliver. It cannot independently certify, approve, or execute protected work.

Channel adapters never access authoritative persistence directly.

## 5. Assistant Gateway

The Assistant Gateway is channel-facing and non-authoritative.

Its responsibilities are limited to:

- accept inbound channel events;
- authenticate/validate provider event origin;
- identify the configured owner/channel identity;
- normalize text/files/images/voice metadata into provider-neutral input;
- deduplicate provider retries;
- manage ephemeral channel/session transport state;
- dispatch outbound V31M4 interactions;
- expose channel health/capabilities;
- translate provider acknowledgement/failure into governed effect outcomes.

The Gateway never decides whether a protected V31M4 action is authorized.

## 6. Provider-neutral channel boundary

Implementation must define a provider-neutral `AssistantChannelPort` or equivalent. Exact signatures are frozen by the implementation plan/task, not by provider SDKs.

Required capability classes include, as applicable:

- receive/send text;
- receive/send files/images;
- notifications;
- structured actions/buttons/forms/modals;
- conversation/thread references;
- live voice session join/leave/audio where supported;
- delivery acknowledgement/failure;
- health/capability discovery;
- cancellation/idempotency context.

Provider-specific SDK types cannot cross into domain/application authority.

## 7. Discord as the initial adapter

Discord is the approved initial free-first remote adapter because it currently provides the strongest useful combination of:

- official bot/application automation;
- bidirectional text;
- files/images;
- notifications;
- structured commands/buttons/modals;
- bot voice-channel support;
- zero recurring service cost for the intended use;
- low owner setup friction.

Discord is **replaceable** and **non-authoritative**.

```text
Assistant Runtime
      ↕
AssistantChannelPort
      ↕
Discord adapter   ← initial remote default
Desktop adapter   ← local interface
Future adapter    ← replace/supplement without authority changes
```

External platform capability must be revalidated at implementation time. If Discord no longer meets the floor, Research Intelligence re-runs channel selection.

Paid PSTN/SMS is optional and disabled by default while free mechanisms satisfy the required floor.

## 8. Comms Role

The Comms Role represents V31M4 conversationally to the owner.

It may:

- understand an interaction;
- classify it;
- ask for genuinely missing owner preference/authority;
- summarize authoritative state;
- narrate material progress/status;
- route bounded work to the Manager;
- deliver independently audited results;
- present owner decisions/approval requests;
- translate owner responses into typed requests for current-state validation.

It must not:

- execute protected tools/effects directly;
- certify its own or another model's work;
- bypass Manager -> Executor -> Auditor;
- approve on behalf of the owner;
- own authoritative conversation/task/memory state;
- treat model confidence or transcript content as evidence;
- persist private chain-of-thought.

## 9. Answer / Task / Responsibility

Every owner interaction is classified into one of three product-level classes.

### Answer

The owner wants information.

- Answer from current verified/authoritative knowledge when sufficient.
- Route into Research Intelligence when freshness, evidence, or comparison requirements are not satisfied.

### Task

The owner wants a bounded result.

- Create/route bounded work through Manager -> Executor -> Auditor.
- Completion remains subject to evidence and acceptance.

### Responsibility

The owner wants V31M4 to own something until told otherwise.

First implementation must represent this through existing authoritative concepts where sufficient:

```text
Mission Contract
+ Scheduler / conditional work
+ Task Capsules as work occurs
```

A new `Responsibility` aggregate is not authorized unless implementation evidence proves Mission/Scheduler/Task semantics cannot preserve the required invariants.

## 10. Owner attention policy

Human attention is a scarce resource.

Default behavior:

```text
routine within delegated authority
→ V31M4 handles it; normally no interruption

material information owner should know
→ V31M4 handles what it can; send update

owner-only authority / explicit decision required
→ contact owner with recommendation, evidence, and exact decision required
```

Uncertainty alone is not sufficient reason to interrupt the owner. V31M4 should research, acquire context, escalate capability, or use an explicitly preauthorized safe fallback first where possible.

If the owner does not respond:

- continue unrelated work;
- hold only the blocked decision if safe to wait;
- use a preauthorized safe fallback if one exists;
- never exceed delegated authority.

## 11. Bidirectional communication behavior

### Owner -> V31M4

The owner can initiate through desktop or Discord using normal messages and supported files/images/structured interactions/voice.

The Gateway authenticates and normalizes the interaction. Assistant Runtime classifies Answer/Task/Responsibility and routes durable meaning into authoritative V31M4 state.

### V31M4 -> owner

V31M4 may initiate:

- material updates;
- result delivery;
- requests for owner-only decisions;
- high-priority escalation;
- voice-channel invitation/interaction when live conversation is warranted and supported.

Outbound communication is a governed external effect, not an arbitrary model side effect.

## 12. Communication effects and restart safety

Messages, notifications, structured prompts, and live-voice initiation are externally meaningful effects.

They reuse existing V31M4 Ledger/reconciliation semantics:

```text
communication intent
↓
policy / allowed channel action
↓
effect_attempt
↓
provider dispatch
↓
provider/deterministic outcome
↓
effect_confirmation | effect_nonapplication | reconciliation_indeterminate
```

Required behavior:

- provider retry does not create duplicate authoritative interactions;
- crash after dispatch does not cause blind resend;
- restart reconciles pending material communication where possible;
- duplicate messages/calls/approval prompts are prevented by stable intent fingerprints;
- channel outage never corrupts underlying Task/Mission/Approval state.

## 13. Owner decisions and approvals

A Discord button, message, or voice-transcribed `yes` is provenance, not automatic permission to execute a protected stale action.

```text
owner interaction
↓
authenticated channel identity + provenance
↓
exact current pending decision / ApprovalRequest
↓
expiry + current-state rebinding
↓
existing Policy + Approval authority
↓
protected effect only if still authorized
```

High-risk decisions require risk-appropriate authentication. Discord identity alone is not automatically sufficient for every future financial/security-sensitive action.

## 14. Conversation and memory rule

```text
Discord history ≠ authoritative memory
Desktop transcript ≠ authoritative task state
Voice transcript ≠ approval authority
```

Durable meaning is translated into existing V31M4 records such as:

- Task Capsule;
- Mission;
- Evidence;
- Execution Ledger;
- Memory;
- Approval;
- Artifact/result references.

Task 10 Memory remains the canonical persistent-memory layer. Assistant/Comms consumes it; it does not replace it.

## 15. Desktop relationship

The desktop interface is the local Assistant surface. Issue #10 still governs final one-click deterministic packaging/startup.

The current Assistant implementation may establish the desktop interaction boundary before final packaging is complete.

The desktop remains non-authoritative:

- submits typed requests;
- displays authoritative runtime projections;
- exposes conversation/status;
- never writes authoritative SQLite directly;
- never directly invokes models/tools.

Final launcher/bootstrap packaging can remain a release-composition task after the Assistant itself exists.

## 16. Runtime API/versioning

Runtime API `1.0.0` remains immutable unless the normal contract-versioning process explicitly approves an additive version.

If public Assistant commands/events are required:

1. record compatibility impact;
2. introduce a separately negotiated additive minor version;
3. preserve `1.0.0` behavior;
4. add positive/negative/cross-version tests;
5. update contract/repository maps in the same change.

Names such as `submitInteraction`, `submitOwnerDecision`, `replyReady`, or `ownerDecisionRequired` are illustrative until the implementation plan freezes exact contracts.

## 17. Free-first rule

Assistant provider selection consumes Research Intelligence's free-first rule:

- among candidates meeting the same required correctness/reliability/security/capability floor, prefer zero recurring monetary cost;
- paid services may win when free options fail the floor or have worse proven total lifecycle cost;
- provider choice remains replaceable.

## 18. Current implementation gates

`V31M4-ASSISTANT-001` begins only after Task 10 Memory is independently accepted and must complete before Task 11 Quality Floor begins.

Required implementation gates are:

1. provider-neutral Assistant interaction/channel contracts with hermetic fake channel;
2. thin Comms Role + Answer/Task/Responsibility routing;
3. local desktop/test interaction surface against authoritative runtime;
4. Discord inbound/outbound text, files, and structured interactions;
5. outbound material-update/escalation policy + Ledger reconciliation;
6. Discord live voice-channel path if current capability validation passes;
7. owner-decision rebinding/authentication;
8. cross-channel continuity/restart/provider-failure campaign;
9. independent acceptance before Task 11 Quality Floor.

## 19. Acceptance target

Assistant/Comms is not accepted until the supported configuration proves at minimum:

- owner can initiate a request from desktop;
- owner can initiate a request from Discord;
- V31M4 can initiate a material Discord update;
- V31M4 can request owner attention/decision through Discord;
- supported live Discord voice interaction works bidirectionally when enabled;
- the same Task/Mission/Responsibility meaning is available across channels;
- restart does not lose authoritative work;
- restart does not duplicate material notifications/escalations;
- provider retries are deduplicated;
- Discord outage fails communication but not core state;
- Discord removal leaves V31M4 core operational;
- Comms/Discord cannot bypass Manager/Executor/Auditor, policy, approval, evidence, sandbox, or effect reconciliation;
- stale/expired approval responses fail closed;
- transcript corruption/loss cannot erase authoritative work;
- no paid communications dependency is required while the free supported path meets the acceptance floor.

## 20. Quality Floor and Eval integration

Task 11 Quality Floor must evaluate Assistant-dependent outcomes where applicable, including:

- Answer quality/provenance;
- Task/Responsibility routing correctness;
- owner-attention/escalation policy;
- communication-effect reconciliation;
- approval rebinding;
- failure/provider-outage behavior;
- channel continuity.

Task 12 Eval Lab must include restart, duplicate-delivery, stale-approval, wrong-owner/channel, provider-outage, and cross-channel continuity cases.

## 21. Hard non-goals

- No full OpenClaw/Hermes/GAIA/nanobot control plane becomes the Assistant brain.
- No Discord-specific business logic enters core/domain authority.
- No PSTN/SMS requirement is imposed now.
- No personal spending/capital authority is introduced by Assistant/Comms.
- No new Responsibility aggregate is assumed necessary.
- No channel becomes required for headless/core startup.
- No mutation of runtime API `1.0.0` in place.
