# Autonomous Verified Repair Proof

## Baseline

Item 2 started from published Item 1 head `108c5571217ce2656bfdcd04ef651d232bb8b01d`.
The implementation composes the existing `recordIssues`, `repairCandidate`, `ImprovementPolicy`,
candidate/evidence repositories, verifier port, production kernel, checkpoint use case, artifact
store, and isolated supervised workspace. It does not introduce another execution engine or state
authority.

## Lifecycle

When independent verification of a `software.production.v1` candidate fails and both mission and
build-packet repair budgets permit another round, the runtime:

1. records an immutable evidence-linked issue for the failed candidate;
2. builds a bounded repair prompt from the current allowed-path workspace context and persisted
   verifier report, not from model confidence;
3. invokes the existing supervised model gateway with deterministic round identity;
4. creates a new reconstructed candidate whose parent is the failed candidate;
5. replaces only the kernel inbox, records a content-addressed repair checkpoint, and applies the
   bounded manifest through the existing production kernel;
6. runs distinct focused and regression verification plans through the independent verifier;
7. persists candidate, evidence, repair record, and issue transition atomically; and
8. allows champion selection and delivery only when the mandatory regression result passes.

Prior candidates, evidence, repair records, and checkpoints remain immutable. Exhausted budgets or
repeated failed output finish with `no_verified_solution`; no delivery receipt is created.

## Real Target-Host Proof

`pnpm prove:autonomous-repair` used the already-installed Ollama 0.32.7
`devstral-small-2:24b`; no model was downloaded. The initial prompt intentionally withheld the
exact deterministic greeting value while preserving the real mission and acceptance contract. The
real first inference produced a candidate that failed the independent Node check. The persisted
report exposed the exact assertion failure to one repair round. A second real inference produced a
new manifest, the real kernel applied it, separate focused and regression commands passed, and the
normal champion/delivery gate completed. Final rerun: **1 passed / 6 intentionally filtered
skips**, 43.02 seconds.

## Failure and Recovery Proof

- Zero repair budget preserves the original failed evidence and returns `no_verified_solution`.
- One declared round with identical still-failing output creates a failed repair record, stops at
  the exact budget, and creates no receipt.
- An out-of-scope repair manifest fails during checkpoint validation before a protected workspace
  effect; the unrelated README remains byte-identical.
- Distinct verification-plan identities prevent focused/regression report and evidence collisions.
- A controlled interruption after the repaired kernel effect leaves a durable checkpoint. A new
  runtime over the same SQLite/workspace recovers the original evidence, reuses the model output
  and checkpoint, verifies once, persists exactly two candidates, and finishes with kernel
  `applyCount: 2` (one original effect plus one repair effect).
- Repeating the completed external idempotency key returns the stored outcome with no new effect.
- Existing supervised-process suites retain timeout, cancellation, malformed response, process
  exit, and verifier failure coverage; these failures remain typed and fail closed.

## Confirmed Defect Fixed

**High — repair restart restaged the wrong candidate.** The restart RED proof interrupted after the
repair kernel effect. Retry reconstructed the original candidate and tried to materialize it before
consulting already-persisted original verification, conflicting with the repaired kernel inbox.
The runtime now resolves authoritative verification first and skips the already-completed original
external effect. The fresh-runtime regression proves exact reconciliation and completed replay.

## Architecture Result

- Runtime and application use cases remain authoritative; adapters still cannot access SQLite.
- External model, kernel, and verifier work remains outside SQLite transactions.
- Models diagnose and propose repairs but never create passing evidence.
- Only project-owned contained workspaces are modified, and manifest application remains atomic.
- `hermetic_reference` remains the optional-service-free default profile.
- The repair loop is bounded by both mission and build-packet limits plus model/tool budgets.

## Known Limitations and Next Item

Routing still selects the single configured supervised model. Item 3 must add dynamic local model
discovery, evidence-based provider-neutral routing, and bounded escalation without changing
verification authority. The broader governed tool plane remains Item 4.

## Verification Evidence

- Focused repair/runtime/application/architecture gate: **41 passed / 2 opt-in skips across 12
  files**.
- Actual installed-model gate: `pnpm prove:autonomous-repair` — 1 passed, 6 filtered skips.
- Full repository gate: `pnpm check` — lint 0 errors (9 existing warnings, 1 existing info),
  typecheck 9/9, and **476 passed / 13 skipped (489 total) across 105 passed + 3 skipped test files
  (108 total)**. The browser proof used the reversible `/tmp` libraries documented in current
  state; no system dependency was installed.
