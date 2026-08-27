# Task 4 evidence — structured agent turns and local adapter modernization

Program: `V31M4-AUTONOMY-001 / 1.1.0`.
Branch: `autonomy-task4-agent-turns`, from base `c92f35e5da723a2edda2ee479e062468c0078eb1`.

Governing sources: `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md`
(architecture authority) and `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`
(execution authority), Task 4.

## What was added

| Concern | Owner |
|---|---|
| Agent-turn output contract `1.0.0` | `packages/contracts/src/agent-turn.schemas.ts` |
| Private-reasoning property names (one frozen list) | `packages/domain/src/value-objects/private-reasoning.ts` |
| Adapter protocol 1.1 agent invocation | `packages/contracts/src/adapter-rpc-v1_1.schemas.ts` |
| Provider-neutral agent capability on the model port | `packages/application/src/ports/model-gateway.port.ts` |
| Gateway translation + strict answer validation | `packages/infrastructure/src/gateways/agent-turn-result.ts`, `supervised-model-gateway.ts` |
| Governed iterative loop | `apps/runtime/src/autonomy/agent-turn-loop.ts` (+ `agent-turn-contracts.ts`, `agent-turn-recording.ts`) |
| Local adapter agent path | `adapters/local-supervised/agent-turn-protocol.mjs`, `model-adapter.mjs` |
| Target-host proof | `scripts/prove-agent-turn-real.mjs`, `apps/runtime/tests/autonomy/agent-turn-real.target-host.test.ts` |

## Preserved invariants

- `ADAPTER_PROTOCOL_VERSION` remains `"1.0.0"`. The v1.0 request union still has exactly 11 methods
  and parses its published payloads unchanged; every 1.1-only method and field is rejected by the
  v1.0 parser. Proven in `packages/contracts/tests/adapter-rpc-v1_1.schemas.test.ts`.
- Runtime API `1.0.0` is untouched. Nothing about agent turns became a public endpoint.
- The 19 model-facing operations are unchanged and `git.worktree` still does not exist.
- `WorkspaceManagerPort` remains the workspace authority; the loop passes an already-assigned
  `WorkspaceHandle` and the model never names one.
- Task Capsule revision/fingerprint semantics are unchanged; the loop reads the capsule and never
  transitions it.
- No external effect happens inside an authoritative SQLite transaction: the model call, the
  governed dispatch, and the post-state probe all sit outside the ledger transactions.
- No parallel state, policy, evidence, or acceptance authority was introduced. Refusals are
  recorded as ordinary `failure` entries through the existing `appendExecutionLedgerEntry` use case.
- Every first-party production source file stays at or below 500 lines.

## The properties Task 4 is about

**There is no model-direct tool path.** A turn is a proposal. Reaching the environment requires
`GovernedExecutionSurface.authorize` and then `EffectReconciler.runGovernedEffect`, both of which
the loop calls itself. The regression suite counts sandbox-backend executions and asserts that
every one is paired with an authoritative `effect_attempt` entry, and that a refused turn produces
zero executions.

**The runtime revalidates every turn.** `agentTurnSchema` is parsed in the loop even though the
adapter validated the same answer and the gateway validated it again. Adapter-side validation is a
courtesy; the runtime is the authority.

**`finish` is not success.** It ends a run as `ready_for_verification`. The outcome type has no
success, accepted, or score field, and the loop proposes no transition — the capsule is at the same
phase and logical revision after a `finish` as before it.

**No private reasoning is persisted.** `PRIVATE_REASONING_KEYS` is frozen in the domain and enforced
at four boundaries: the contract parser, the gateway's answer parser, the adapter's turn parser, and
the adapter's handling of a provider-volunteered `thinking` field, which is never read, returned, or
written. The list is enforced at every depth because `parameters` is fingerprinted into the Ledger.
A match is a refusal, never a silent strip. The adapter keeps its own copy because adapters are
dependency-free child processes; a test asserts the two lists are identical so they cannot drift.

**Repeated no-progress is deterministic.** It is decided by `decideRetry` over recorded intent
fingerprints, not by inspecting the transcript, so it survives a restart and cannot be influenced by
model output.

**Oversize fails closed.** The fixed 64 KiB autonomy ceiling is gone from the agent path, replaced by
a configurable `V31M4_AGENT_MAX_PROMPT_BYTES` hard ceiling combined with the caller's own
`contextBudget`; the tighter of the two applies and exceeding it refuses the invocation. Nothing is
truncated at any layer. The legacy `model.invoke` path keeps its original 64 KiB limit exactly, and
raising the agent ceiling does not raise it.

## Reasoning policy translation

Provider-neutral `disabled | enabled | auto` is translated inside the adapter and nowhere else:

- `disabled` → `think: false`
- `enabled` → `think: true`, and refused outright when the installed model does not report a
  `thinking` capability, because running without reasoning while reporting `enabled` would be a
  false record
- `auto` → **no** `think` field is sent at all. The runtime has declined to decide, and inventing a
  default would be an assumption about this provider's semantics that the architecture requires be
  measured rather than presumed.

## Target-host proof

`node scripts/prove-agent-turn-real.mjs` runs the whole real path: governed loop → real
`SupervisedModelGateway` → real supervised adapter child process → real Ollama → real local model.
It probes the host first and reports `TASK4_TARGET_HOST_PROOF=BLOCKED_ENVIRONMENT` with a reason,
exiting non-zero, when the service or the requested model is absent. It never fabricates a result.

### Mandated model: BLOCKED_ENVIRONMENT

The plan's initial local acceptance model is Qwen3.8-27B Q4_K_M. It is **not installed** on this
target host, and pulling a ~17 GB model was not authorized as part of this task.

```text
[agent-turn-proof] installed models: huihui_ai/mistral-small-abliterated:24b, qwen3:8b, gemma3:12b,
                   qwen3:14b, devstral-small-2:24b, qwen2.5-coder:14b, qwen3.5:9b
[agent-turn-proof] requested model: qwen3.8:27b
[agent-turn-proof] TASK4_TARGET_HOST_PROOF=BLOCKED_ENVIRONMENT
[agent-turn-proof] reason: the requested model qwen3.8:27b is not installed on this host
```

`TASK4_QWEN38_27B_PROOF = BLOCKED_ENVIRONMENT`. No Qwen3.8-27B measurement exists and none is
claimed. `AGENTS.md` already states that no domain or application invariant may depend on Qwen3.8
specifically, and none does.

### Substitute measurement on an installed Qwen (non-target evidence)

To prove the code path itself rather than leave it unexercised, the same script was run against an
installed real Qwen of the same quantization:
`V31M4_AGENT_MODEL=qwen3:14b node scripts/prove-agent-turn-real.mjs`.

Two consecutive runs, 8/8 tests passed, identical measurements:

```text
model=qwen3:14b  quantization=Q4_K_M  capabilities=completion,tools,thinking
act:      outcome=ready_for_verification  turns=2  executions=1
          turn 0 tool_call code.inspect accepted   turn 1 finish accepted
defer:    outcome=deferred                turns=1  executions=0
repeat:   outcome=stopped/NO_PROGRESS     turns=2  executions=1
          turn 1 refused NO_NEW_EVIDENCE
manifest: outcome=stopped/REFUSED_TURN_BUDGET_EXHAUSTED  turns=1  executions=0
          turn 0 refused ADAPTER_REJECTED_TURN (command.run outside the manifest)
context:  bytes=180961  numCtxRequested=32768  inputTokens=29881  turn=finish  elapsedMs≈30000
context:  oversize refused without truncation
          ("Agent context is oversized: 525312 bytes exceeds the 524288 byte ceiling")
reasoning disabled: turn=finish  |  auto: turn=finish  |  enabled: turn=finish
          no reasoning trace in any result or in any staged output file
legacy:   finishReason=completed
```

`QWEN_32K` is a measurement, not a configuration claim: 29,881 prompt tokens of a 32,768-token
budget were actually evaluated and the model still produced a valid structured turn, in roughly 30
seconds on this host. **64K was not attempted and must not be promoted without its own measured
target-host evidence.**

One run in this session failed four loop scenarios with a retryable provider error while Ollama was
reloading the model under a changed `num_ctx`. That is host churn, not a defect: the loop correctly
propagated a retryable dependency failure instead of masking it, and the two runs bracketing it were
clean. Retry policy for transient provider failures is deliberately not in the loop.

## Deferred to its own phase

`code.patch` requires the current observed fingerprint of its target, which can only come from a
prior governed read. Supplying that from evidence belongs to Task 6 (evidence-conditioned effects),
so until then the loop refuses such a turn as `AUTHORIZATION_REFUSED` rather than executing it
without its precondition. This is fail-closed and deliberate.

## Gates

```text
pnpm typecheck   PASS
pnpm test        PASS   (1029 tests: 999 passed, 24 skipped, 6 todo)
pnpm lint        PASS   (9 pre-existing warnings, unchanged; 0 errors)
pnpm build       PASS
git diff --check PASS
source-size gate PASS   (largest first-party production file 499 lines)
target-host      BLOCKED_ENVIRONMENT for Qwen3.8-27B; 8/8 PASS on installed qwen3:14b
```
