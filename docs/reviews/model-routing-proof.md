# Measured Model Routing Proof

## Baseline

Item 3 started from pushed Item 2 head `60202d40b064254b5d802c1e065cd89f993bd20d`.
The `supervised_local` profile could invoke only its configured Ollama model, and the existing
strict `listModels*` contracts had no runtime query owner.

## Implemented Boundary

- `routeModels` is a deterministic Layer 5 policy. It filters by availability, modality, context,
  and invocation budget; verified capability measurements outrank preference, sample size breaks
  measured ties, and explicit preference is only a non-measured/tied ordering input.
- `SupervisedModelGateway` now discovers profiles through the existing supervised JSON-RPC adapter
  binding, strictly validates provider-neutral profiles, and binds discovered IDs to that process.
- the Ollama child reads `/api/tags`, maps context and vision support, verifies the requested model
  remains installed, and invokes that exact model.
- `job.execute` obtains a bounded route and retries only explicitly retryable dependency failures.
  Failed attempts persist no candidate; the successful immutable candidate records the exact model.
- authenticated `model.list` reuses the existing contracts and `ModelGatewayPort`, with filtering
  before pagination.
- the optional OpenAI-compatible child is transport-only infrastructure: HTTPS or loopback HTTP,
  a configured model allowlist, bounded JSON response, cancellation, exact provenance, and no
  provider type above the adapter boundary. It was contract-tested without a paid call.

## Executable Proof

- application tests prove measured ranking, preference-only ties, budget bounds, and fail-closed
  modality/context eligibility.
- gateway tests prove strict discovery and dynamic binding.
- the real runtime escalation test makes `preferred-code` fail retryably, invokes `fallback-code`,
  independently verifies the work, and reads the fallback ID from candidate provenance.
- real authenticated HTTP proves `model.list` and unauthenticated refusal.
- adapter tests prove dynamic Ollama inventory, context/vision mapping, exact selected-model
  invocation, and loopback OpenAI-compatible authentication/response translation.
- `pnpm prove:model-routing` passed against installed Ollama 0.32.7 using real `qwen3:8b` and
  `qwen2.5-coder:14b` inference in 32.38 seconds. No model was downloaded.

## Confirmed Defects

1. **Medium — optional discovery context rejected.** The gateway parser accidentally made
   `contextLimit` required although the domain and Ollama contract make it optional.
2. **High — one incompatible provider tag disabled all discovery.** An installed name containing
   `/` cannot be a V31M4 durable ID. The adapter formerly threw while mapping that tag, making all
   valid models unavailable. It now omits only unrepresentable provider names and retains the
   domain invariant.
3. **Medium — routing pushed the job command owner over 500 lines.** Routing orchestration was
   extracted to `routed-solver.ts`; the authoritative surface is exactly 500 lines.

## Honest Limitations

- discovery facts are live operational profiles. Verified capability measurements remain the only
  valid ranking evidence, but discovered models have none until Item 5 connects verified outcomes
  to capability state.
- the OpenAI-compatible child is contract-proven and bindable through the existing supervised
  gateway, but no paid provider was invoked and it is not a default startup dependency.
- provider names that violate durable-ID syntax are omitted; invoking them would require a future
  explicit stable alias contract rather than weakening the identifier invariant.

## Verification

Focused routing/runtime/adapter/application verification passed **39 tests with 3 opt-in skips
across 10 files**. The explicit installed-Ollama routing acceptance passed **1/1** using
`qwen3:8b` and `qwen2.5-coder:14b` in 32.38 seconds. The complete workspace gate passed with lint
at 0 errors (9 existing warnings and 1 existing info), typecheck 9/9, and **484 passing / 14
skipped tests across 106 passing + 4 skipped files**. Dependency, source-size, and explicit-`any`
guards passed in that suite. `git diff --check` and the complete phase diff were reviewed before
publication.
