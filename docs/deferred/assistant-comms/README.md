# V31M4 Assistant and Communications Layer

**Status:** DEFERRED DESIGN ONLY — APPROVED PRODUCT TARGET, NOT AUTHORIZED FOR IMPLEMENTATION  
**Program:** `V31M4-ASSISTANT-001`  
**Type:** First-party interface/application layer; **not a department**  
**Initial remote channel:** Discord behind a replaceable provider-neutral boundary  
**Companion requirements:** #10, #15, #19, #21, #22, #23, #24

## Repository quarantine

This document is intentionally stored under `docs/deferred/assistant-comms/` as an approved future product design.

It is **not** current implementation authority and must not be treated as evidence that Assistant/Comms exists, is registered, is buildable, changes runtime API versions, or is part of the supported runtime.

Models and contributors should read/use this document only when a task explicitly concerns Assistant/Comms, final desktop productization, owner communication, or promotion of this deferred design toward implementation.

Until explicit implementation authorization is given:

- do not add an Assistant package/application/channel adapter from this document;
- do not change runtime API `1.0.0` for Assistant purposes;
- do not add Discord to core startup, pnpm workspace requirements, runtime composition, or release acceptance;
- do not create a second task, memory, approval, policy, evidence, or conversation authority;
- preserve core operation when every Assistant/Comms channel is absent.

Promotion requires a fresh repository audit, contract-versioning review, channel capability/security validation, explicit owner authorization, and a separately accepted implementation plan.

## 1. Product objective

V31M4 must expose **one assistant identity** that works in both directions:

> The owner can contact V31M4 when something is needed, and V31M4 can contact the owner when a material update or owner-only decision requires attention.

Initial supported surfaces are:

- the local desktop application;
- Discord as the first free remote channel.

Future channels may include Telegram, Matrix/Element, PSTN/SMS, mobile applications, or other mechanisms that prove superior. No channel is permanent architecture.

## 2. Identity and continuity

Desktop and Discord are interfaces to the **same V31M4 identity**, not separate assistants.

An interaction may begin on one channel and continue on another because durable meaning is stored in V31M4 authoritative state rather than in a channel transcript.

Example target behavior:

```text
owner sends Discord message
        ↓
V31M4 creates/updates authoritative work
        ↓
owner later opens desktop
        ↓
asks about the same task/responsibility
        ↓
V31M4 resolves it from authoritative state
```

Channel session IDs and transcripts are provenance/navigation only.

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
Tasks / Missions / Responsibilities / Departments
```

It is **not**:

- a production department;
- another autonomous-agent framework;
- another orchestrator;
- a second memory/task database;
- a second approval/policy system;
- a model-direct effect path.

## 4. Assistant Gateway

The Assistant Gateway is non-authoritative and channel-facing.

Its responsibilities are limited to:

- accept inbound channel events;
- validate/authenticate provider event origin;
- identify the configured owner/channel identity;
- normalize text/files/images/voice interaction metadata into provider-neutral input;
- deduplicate provider retries;
- manage ephemeral channel/session transport state;
- deliver outbound V31M4 messages/interactions;
- expose channel availability/health;
- translate provider acknowledgements/failures into governed effect results.

The Gateway never accesses SQLite/runtime persistence directly and never decides whether a protected V31M4 action is authorized.

## 5. Provider-neutral channel boundary

Implementation must define a provider-neutral interface such as `AssistantChannelPort`; the exact name/signature is not frozen until implementation planning.

The boundary must support channel capabilities rather than provider types, including as applicable:

- receive/send text;
- receive/send files/images;
- notifications;
- structured actions/buttons/forms/modals;
- conversation/thread references;
- live voice session join/leave/audio where supported;
- delivery acknowledgement/failure;
- health/capability discovery;
- cancellation and idempotency context.

Provider SDK types must not cross into domain/application authority.

## 6. Discord as the initial adapter

Discord is the approved initial remote channel because it currently provides the strongest useful free combination of:

- official bot/application automation;
- bidirectional text;
- files/images;
- notifications;
- structured commands/buttons/modals;
- live bot voice-channel support;
- zero recurring service cost for the intended usage;
- low user setup friction.

Discord is **not** a permanent dependency.

```text
Assistant Runtime
      ↕
AssistantChannelPort
      ↕
Discord adapter   ← initial default
Desktop adapter   ← local interface
Future adapter    ← replace/supplement without redesigning authority
```

If Discord becomes unreliable, restrictive, insufficient, paid, or otherwise fails the required floor, Research Intelligence must re-run the channel selection rather than defending the incumbent choice.

Paid PSTN/SMS remains optional and disabled by default while free mechanisms satisfy the required floor.

## 7. Comms Role

The Comms Role is the only conversational role intended to represent V31M4 to the owner.

It may:

- understand a request;
- classify the interaction;
- ask for genuinely missing owner preference/authority;
- summarize authoritative state;
- narrate material progress/status;
- route bounded work to the Manager;
- deliver audited results;
- present owner decisions/approvals;
- translate owner responses into typed requests for current-state validation.

It must not:

- execute protected tools/effects directly;
- certify its own work or another model's work;
- bypass Manager -> Executor -> Auditor;
- approve on behalf of the owner;
- own authoritative conversation/task/memory state;
- treat model confidence or transcript content as evidence;
- persist private chain-of-thought.

The Comms Role is a router/narrator/interface role, not another worker tier with unrestricted tools.

## 8. Answer / Task / Responsibility

Owner interactions are classified into three product-level classes:

### Answer

The owner wants information.

- Answer from current verified/authoritative knowledge when sufficient.
- Route into bounded Research Intelligence when current knowledge/evidence is insufficient or freshness matters.

### Task

The owner wants a bounded result.

- Create/route work into the existing Manager -> Executor -> Auditor path.
- Completion remains subject to acceptance/evidence/Quality Floor.

### Responsibility

The owner wants V31M4 to own something until told otherwise.

Examples include monitoring, maintaining, operating, or repeatedly handling a class of work.

First implementation must attempt to represent this through existing authoritative semantics:

```text
Mission Contract
+ Scheduler / conditional work
+ Task Capsules created as work occurs
```

A new `Responsibility` domain aggregate is **not approved** by this design. Add one only if implementation evidence proves existing Mission/Scheduler/Task semantics cannot preserve the required invariants cleanly.

## 9. Owner attention policy

The Assistant exists to reduce unnecessary owner involvement.

Default behavioral ladder:

```text
routine within delegated authority
→ V31M4 handles it; usually silent

material information owner should know
→ V31M4 handles what it can; send Discord update

owner-only authority / explicit decision required
→ V31M4 sends high-priority Discord escalation and enters a live voice interaction when supported/appropriate
```

Uncertainty alone is not sufficient reason to interrupt the owner. V31M4 should research, acquire context, escalate capability, or use a safe bounded fallback before seeking owner attention unless the missing information is genuinely owner-specific authority/preference.

If owner response is unavailable:

- continue unrelated work;
- hold only the blocked decision if it can safely wait;
- use an explicitly preauthorized safe fallback where one exists;
- never exceed delegated authority.

## 10. Bidirectional Discord behavior

### Owner -> V31M4

The owner can initiate through Discord using normal messages, files/images, structured commands, or voice-channel interaction.

The Gateway authenticates/normalizes the interaction; the Assistant Runtime determines Answer/Task/Responsibility and routes it into authoritative V31M4 state.

### V31M4 -> owner

V31M4 may initiate:

- informational/material updates;
- result delivery;
- requests for owner-only decisions;
- voice-channel invitations/escalations when live conversation is warranted.

Outbound communications are governed external effects, not arbitrary model side effects.

## 11. Communication effects and restart safety

Sending a message, creating a notification, or initiating/joining a live voice interaction is an externally meaningful effect.

It must use existing V31M4 idempotency/Ledger/reconciliation concepts:

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
- runtime crash after dispatch does not blindly resend;
- restart reconciles pending material communication where possible;
- duplicate calls/messages/approval prompts are prevented by stable intent fingerprints;
- channel outage never corrupts the underlying Task/Mission/Approval state.

## 12. Owner decisions and approvals

A Discord button, message, or voice-transcribed `yes` is not itself permission to execute a stale protected action.

Flow:

```text
owner interaction
↓
authenticated channel identity + provenance
↓
exact pending decision / ApprovalRequest reference
↓
current-state and expiry revalidation
↓
existing Policy + Approval authority
↓
protected effect if still authorized
```

High-risk decisions require risk-appropriate authentication. Discord account identity alone must not automatically be considered sufficient for every future financial/security-sensitive action.

The Assistant layer cannot manufacture Approval records or bypass existing approval semantics.

## 13. Conversation and memory rule

```text
Discord history ≠ authoritative memory
Desktop transcript ≠ authoritative task state
Voice transcript ≠ approval authority
```

Durable meaning must be translated into appropriate existing V31M4 records, such as:

- Task Capsule;
- Mission;
- Evidence;
- Execution Ledger;
- Memory;
- Approval;
- Artifact/result references.

Memory Task 10 remains responsible for persistent memory semantics. Assistant/Comms consumes that authority; it does not replace it.

## 14. Desktop relationship

Issue #10 remains the authoritative final-release requirement for one-click deterministic desktop startup.

The final desktop application is the local Assistant surface plus bootstrap/status/recovery UI. It remains non-authoritative:

- starts/verifies required runtime components;
- reports READY only when the supported graph is healthy;
- provides local conversation/status;
- submits typed requests;
- displays authoritative runtime projections;
- never writes SQLite or directly invokes models/tools.

The desktop technology choice remains separately validated; this document does not force a new shell/framework decision beyond existing repository architecture.

## 15. Runtime API/versioning

Runtime API `1.0.0` is immutable during the current autonomy program.

When Assistant implementation begins, if public interaction commands/events are required, follow `docs/contract-versioning.md`:

1. record compatibility/architecture decision;
2. introduce an additive separately negotiated minor version rather than mutating 1.0.0;
3. preserve 1.0.0 behavior;
4. add positive/negative/cross-version tests;
5. update repository/contract maps in the same change.

Proposed future concepts such as `submitInteraction`, `submitOwnerDecision`, `replyReady`, or `ownerDecisionRequired` are product examples only and are **not frozen contract names** by this deferred document.

## 16. Free-first rule

Assistant provider/channel selection consumes the Research Intelligence free-first rule:

- free candidates win when they meet the same required floor;
- paid services are allowed when free options cannot meet correctness/reliability/security/capability requirements or have worse total lifecycle cost;
- provider choice must remain replaceable.

This is why Discord is the initial adapter and paid PSTN/SMS is not currently required.

## 17. Implementation sequence when later authorized

The future `V31M4-ASSISTANT-001` implementation plan should be independently reviewed and should roughly prove these gates in order:

1. provider-neutral Assistant interaction/channel contracts with hermetic fake channel;
2. thin Comms Role and Answer/Task/Responsibility routing;
3. desktop/test surface integration against authoritative runtime;
4. Discord text/files/structured interactions;
5. outbound material-update/escalation policy and effect reconciliation;
6. Discord live voice-channel path if capability validation still passes;
7. owner-decision rebinding/authentication;
8. cross-channel continuity/restart/failure campaigns;
9. final integration with Issue #10 one-click desktop productization.

Provider capability must be revalidated at implementation time because external platforms change.

## 18. Acceptance target

Assistant/Comms is not complete until the supported configuration proves at minimum:

- owner can initiate a request from desktop;
- owner can initiate a request from Discord;
- V31M4 can initiate a material Discord update;
- V31M4 can request owner attention/decision through Discord;
- supported live Discord voice interaction works bidirectionally when enabled;
- the same Task/Mission/Responsibility state is visible across channels;
- restart does not lose authoritative work;
- restart does not duplicate material notifications/escalations;
- provider retries are deduplicated;
- Discord outage fails communication but not core state;
- Discord removal leaves V31M4 core operational;
- Comms/Discord cannot bypass Manager/Executor/Auditor, policy, approval, evidence, sandbox, or effect reconciliation;
- stale/expired approval responses fail closed;
- channel transcript corruption/loss cannot erase authoritative work;
- no paid communications dependency is required while the free supported path meets the acceptance floor.

## 19. Hard non-goals

- No full OpenClaw/Hermes/GAIA/nanobot/etc. control plane is imported as the Assistant brain.
- No Discord-specific business logic enters core/domain authority.
- No PSTN/SMS requirement is imposed now.
- No personal spending/capital authority is introduced by Assistant/Comms.
- No new Responsibility aggregate is assumed necessary.
- No channel becomes required for headless/core startup.
- No implementation begins from this deferred document without explicit authorization.
