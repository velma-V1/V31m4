# V31M4 Assistant and Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the current required `V31M4-ASSISTANT-001` subsystem so the owner and V31M4 can communicate bidirectionally through one authoritative V31M4 identity on desktop and Discord without creating a second authority or bypass path.

**Architecture:** Add a thin provider-neutral Assistant/Comms interface/application layer above the authoritative runtime. Channel adapters normalize/deliver interactions only; a thin Comms Role classifies Answer/Task/Responsibility and routes durable work/owner decisions through existing V31M4 authority. Communication sends are governed/reconciled external effects. Discord is the first free remote adapter and remains replaceable.

**Tech Stack:** Existing TypeScript/Node runtime, Task Capsule/Ledger/Evidence/Approval/Memory infrastructure, Manager/Executor/Auditor, existing process/tool/model gateways, current desktop/UI boundary, Discord official application/bot/voice APIs after fresh capability validation, Vitest, existing integration/proof conventions.

**Spec:** `docs/superpowers/specs/2026-08-27-assistant-comms-architecture.md`

## Global Constraints

- This program is part of the **current V31M4 build**, not a deferred feature.
- Entry gate: Task 10 Memory independently accepted.
- Exit gate: `V31M4-ASSISTANT-001` independently accepted before Task 11 Quality Floor.
- Runtime API `1.0.0` remains immutable unless a separate additive version is approved through `docs/contract-versioning.md`.
- Assistant/Comms is not a department and not another autonomous-agent framework.
- Channel adapters are non-authoritative and cannot access runtime persistence directly.
- Comms Role cannot execute protected effects or certify results.
- Real work routes through Manager -> Executor -> Auditor.
- Conversation/channel history is provenance only, never authoritative task/memory/approval state.
- Outbound communications use Ledger/effect reconciliation and stable idempotency.
- Discord is an initial adapter, not a permanent dependency.
- Discord capability/policy/pricing/security assumptions must be revalidated at implementation time.
- Removing or disabling Discord cannot break headless/core V31M4 startup.
- Use TDD, focused verification, full `pnpm check`, source/dependency guards, docs/maps/evidence, and a hard independent gate for each phase.

## Planned ownership

Exact paths must be reconciled against live repository structure when this program starts. Prefer existing interface/runtime conventions; do not create parallel layers merely to match this plan.

```text
packages/application/src/assistant/
  assistant-interaction.ts
  assistant-channel.port.ts
  assistant-router.ts
  owner-attention-policy.ts
  owner-decision-binding.ts
  communication-effect-policy.ts

packages/infrastructure/src/assistant/
  fake-assistant-channel.ts
  discord/*

apps/runtime/src/assistant/
  assistant-runtime.ts
  comms-role.ts
  assistant-composition.ts

apps/runtime/tests/assistant/
  authority-boundary.test.ts
  routing.test.ts
  communication-reconciliation.test.ts
  owner-decision.test.ts
  restart-continuity.test.ts
  discord-failure.test.ts

scripts/
  prove-assistant-comms-real.mjs

docs/reviews/
  assistant-comms-proof.md
```

If live package conventions require different exact paths, stop and record the mapping before implementation rather than creating a shadow architecture.

---

## Phase A — Freeze Assistant interaction and channel boundaries

**Produces:** provider-neutral internal interaction/channel contracts and a hermetic fake channel. Public runtime API remains unchanged unless separately approved.

- [ ] **Step 1: Audit live interfaces and contract-versioning requirements.** Confirm how desktop/UI requests currently enter runtime and which internal application types can be reused.
- [ ] **Step 2: Write failing tests** proving channel/provider types cannot enter domain authority, channel adapters cannot access SQLite/runtime repositories, and no Assistant path directly invokes protected tools/models.
- [ ] **Step 3: Define bounded provider-neutral interaction types** for inbound owner message/file/structured/voice metadata, outbound message/update/decision request, channel identity/provenance, capability discovery, delivery outcome, and idempotency context.
- [ ] **Step 4: Define `AssistantChannelPort` or live-repo equivalent** with only transport/capability responsibilities.
- [ ] **Step 5: Implement hermetic fake channel** supporting deterministic inbound/outbound tests, retry simulation, duplicate events, failures, and delayed acknowledgements.
- [ ] **Step 6: Run focused tests and dependency guards.**

**Hard gate:** one provider-neutral Assistant transport boundary exists; provider/channel code has zero authority path.

---

## Phase B — Implement thin Comms Role and Answer / Task / Responsibility routing

**Produces:** current owner interactions are classified and routed without making conversation state authoritative.

- [ ] **Step 1: Write failing classification/routing tests** for Answer, Task, Responsibility, malformed interaction, missing owner authority, and unsupported channel capability.
- [ ] **Step 2: Implement `AssistantRouter`** using explicit bounded classification output; classification does not itself execute work.
- [ ] **Step 3: Implement Answer routing** to verified current knowledge or Research Intelligence when freshness/evidence/coverage is insufficient.
- [ ] **Step 4: Implement Task routing** into existing Manager/task authority without bypassing acceptance/evidence.
- [ ] **Step 5: Implement Responsibility routing** using existing Mission + Scheduler + Task semantics first. Add no new Responsibility aggregate unless a failing invariant proves it necessary and a separate architecture correction is approved.
- [ ] **Step 6: Implement Comms Role** as narrator/router only, with no protected effect permissions and no completion-certification authority.
- [ ] **Step 7: Prove deleting conversation/session state does not delete authoritative Task/Mission state.**

**Hard gate:** owner intent reliably enters existing V31M4 authority and conversation history is not required to preserve work.

---

## Phase C — Implement local desktop/test Assistant surface

**Produces:** owner can use the local V31M4 interface to submit interactions and inspect authoritative progress/results through the same Assistant Runtime used by remote channels.

- [ ] **Step 1: Audit current desktop/UI boundary** and reuse it; do not introduce another UI authority.
- [ ] **Step 2: Write failing tests** proving desktop submits typed interactions and cannot write runtime persistence or invoke models/tools directly.
- [ ] **Step 3: Wire local interaction into Assistant Runtime.**
- [ ] **Step 4: Expose authoritative status/result projection** sufficient for “how did that turn out?” without reconstructing state from transcript history.
- [ ] **Step 5: Preserve Issue #10 separation:** final one-click launcher/bootstrap packaging is not required to prove the Assistant runtime itself.

**Hard gate:** local Assistant works through the same authoritative path remote channels will use; no desktop shadow state.

---

## Phase D — Implement Discord text/files/structured interaction adapter

**Produces:** free bidirectional remote messaging through Discord behind the provider-neutral boundary.

- [ ] **Step 1: Revalidate current Discord official capabilities, policies, rate limits, pricing, bot/application authentication, structured interactions, file limits, and supported voice path. Record evidence in `docs/reviews/assistant-comms-proof.md`.**
- [ ] **Step 2: If Discord fails the required floor, stop provider implementation and run Research Intelligence channel selection. Do not redesign the Assistant boundary.**
- [ ] **Step 3: Write adapter contract tests** using captured/provider-specified payload fixtures without embedding Discord SDK types into application authority.
- [ ] **Step 4: Implement inbound owner identity allowlisting/authentication and provider event deduplication.**
- [ ] **Step 5: Implement inbound/outbound text and file/image normalization/delivery.**
- [ ] **Step 6: Implement buttons/modals/commands as normalized Assistant interactions, never direct protected actions.**
- [ ] **Step 7: Add bounded retry/backoff/rate-limit behavior behind the adapter.**
- [ ] **Step 8: Prove Discord adapter can be disabled/removed while core and desktop Assistant remain healthy.**

**Hard gate:** owner and V31M4 can communicate bidirectionally over Discord with no provider-specific authority leak.

---

## Phase E — Govern outbound communication and owner-attention policy

**Produces:** V31M4 can initiate communication without duplicate spam or unnecessary owner interruption.

- [ ] **Step 1: Write owner-attention policy tests** for routine-silent, material-update, owner-only decision, unrelated-work continuation, and owner-unavailable cases.
- [ ] **Step 2: Implement deterministic owner-attention policy inputs** from current authoritative task/approval/risk state; model preference alone cannot force escalation.
- [ ] **Step 3: Treat each material outbound communication as a governed external effect** with intent fingerprint and Ledger attempt before provider dispatch.
- [ ] **Step 4: Append confirmation/nonapplication only from provider/deterministic post-state; indeterminate send state blocks blind resend.**
- [ ] **Step 5: Add crash/restart tests** for crash-before-send, crash-after-send-before-response, delayed provider acknowledgement, provider duplicate callback, and runtime replay.
- [ ] **Step 6: Prove duplicate material notifications and approval prompts are prevented.**

**Hard gate:** V31M4 can contact the owner proactively while communication effects remain idempotent/reconcilable.

---

## Phase F — Implement owner decision binding and authentication

**Produces:** owner responses can authorize current pending decisions without stale-channel approval bypass.

- [ ] **Step 1: Write failing tests** for stale approval, expired approval, wrong owner, wrong channel/session, replayed button, mismatched decision fingerprint, changed underlying state, and insufficient authentication for risk class.
- [ ] **Step 2: Bind every owner-decision interaction to the exact pending decision/ApprovalRequest and current state fingerprint.**
- [ ] **Step 3: Revalidate expiry, state, policy, and authentication before protected effect execution.**
- [ ] **Step 4: Keep transcript/message/audio as provenance only; it never manufactures approval authority.**
- [ ] **Step 5: Define risk-appropriate authentication escalation** so Discord identity alone is not automatically sufficient for future financial/security-sensitive actions.

**Hard gate:** stale/replayed/forged/misbinding owner responses fail closed and cannot bypass approval authority.

---

## Phase G — Implement supported Discord live voice path

**Produces:** live owner↔V31M4 voice interaction through Discord when current provider validation confirms support and quality.

- [ ] **Step 1: Confirm the live Discord voice transport still meets the free/reliability/capability/security floor.**
- [ ] **Step 2: Define voice session lifecycle behind `AssistantChannelPort` capability semantics; Discord voice details remain adapter-local.**
- [ ] **Step 3: Write tests for join/leave, owner identity, interruption, provider disconnect, runtime restart, unavailable voice capability, and transcript-as-provenance-only behavior.**
- [ ] **Step 4: Implement bounded audio input/output integration through existing model/audio capabilities or separately governed adapters; do not create another assistant brain.**
- [ ] **Step 5: Ensure voice inability degrades to text/structured communication without corrupting or weakening authority.**

**Hard gate:** supported live voice works bidirectionally or is explicitly unavailable with safe text fallback; no voice path bypasses normal authority.

---

## Phase H — Cross-channel continuity, restart, and provider-failure campaign

**Produces:** the required “same V31M4 everywhere” behavior and final program acceptance evidence.

- [ ] **Step 1: Write cross-channel tests:** start on Discord -> continue desktop; start desktop -> receive Discord update; owner decision on one channel visible through authoritative state on the other.
- [ ] **Step 2: Write restart tests:** restart with active Task/Responsibility, pending material update, pending approval, provider outage, derived-cache loss, and missing channel session state.
- [ ] **Step 3: Write provider-failure tests:** Discord unavailable, unauthorized identity, malformed event, rate limit, duplicate delivery, delayed acknowledgement, lost session/thread reference, and voice unavailable.
- [ ] **Step 4: Prove authoritative work survives complete transcript/channel-state loss.**
- [ ] **Step 5: Prove Discord removal leaves core/runtime and local Assistant operational.**
- [ ] **Step 6: Run target-host proof through real Discord test environment using dedicated non-production credentials/configuration.**
- [ ] **Step 7: Run full repository gates.**
```bash
pnpm check
git diff --check
node scripts/prove-assistant-comms-real.mjs
```
- [ ] **Step 8: Record exact proof, provider versions/capabilities, known limitations, and accepted SHA in `docs/reviews/assistant-comms-proof.md`.**

**Hard gate:** `V31M4-ASSISTANT-001` independently accepted; Task 11 Quality Floor is now authorized to begin.

---

## Task 11 Quality Floor integration

Task 11 must include Assistant/Comms in applicable quality decisions, including:

- Answer provenance/correctness;
- Task/Responsibility routing;
- owner-attention behavior;
- communication reconciliation;
- approval rebinding/authentication;
- provider-outage behavior;
- cross-channel continuity.

## Task 12 Eval Lab integration

Add adversarial/hidden cases for:

- wrong owner identity;
- stale/replayed approval;
- provider duplicate callbacks;
- crash after send before confirmation;
- conversation-history corruption/loss;
- Discord unavailable;
- voice unavailable;
- channel replacement/removal;
- Answer requiring Research Intelligence rather than unsupported confidence;
- Responsibility surviving restart without transcript history.

## Final release relationship

Issue #10 one-click deterministic desktop startup remains a final packaging/composition requirement. It must package the already-implemented Assistant; it is **not** the point at which Assistant/Comms first gets built.
