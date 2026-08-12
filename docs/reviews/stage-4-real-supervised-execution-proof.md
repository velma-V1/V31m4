# Stage 4 Real Supervised Execution Proof

## Baseline

- Branch: `main`
- Required and verified starting commit: `13791abf01e83f68130bc724676aa9636a896ae9`
- Starting local, tracking, and live GitHub `main`: equal; worktree clean
- Scope: one real local `stage4.tiny-code` system-build path. Reference execution remains the
  hermetic default and all department-specific real adapters remain out of scope.

## Actual Local Model

- Ollama: `0.32.7`, existing Windows host installation reached through loopback from WSL
- Model: `devstral-small-2:24b`, installed identity `24277f07f62d`, 15 GB
- No model was pulled, updated, copied, or committed.
- The first real invocation failed closed with Ollama HTTP 400. Direct bounded diagnosis proved
  Ollama 0.32.7 could not compile grammar keywords `additionalProperties`, `minLength`, or
  `maxLength`. The adapter retained its post-response key/content/byte validation, reduced only
  the wire grammar to the supported equivalent core schema, added a compatibility regression,
  and the second bounded real attempt passed.

## Execution Profile

`RuntimeConfig.executionProfile` is now either `hermetic_reference` (default) or
`supervised_local`. The supervised profile requires a canonical installed model name and an
uncredentialed loopback HTTP Ollama origin. A partial, remote, credentialed, or malformed
configuration fails during validated composition. Default core startup does not start a child
process, contact Ollama, or require any Stage 4 adapter.

## Adapter Process Architecture

The supervised profile owns three independent lazy `SupervisedAdapterProcess` instances:

1. `ollama-local-supervised` performs `model.invoke` against the configured loopback Ollama.
2. `stage4-local-kernel` implements the frozen production-kernel lifecycle.
3. `stage4-local-verifier-adapter` implements the allowlisted verifier tool operation.

All three use the existing `ProcessSupervisor` and bounded newline-delimited `JsonRpcClient`.
They are started with argument arrays, independent process groups, bounded frames/stderr,
timeouts, cancellation, graceful/forced teardown, and an explicit OS/adapter environment
allowlist. They have no SQLite dependency or runtime persistence access.

## Model Input and Output Boundary

The authoritative runtime reads the prompt through `ArtifactStorePort`, bounds it to 64 KiB, and
materializes it under the supervised root as `<promptArtifactId>.txt`. The adapter may read only
that canonical staged identity. It calls `/api/generate` with the configured exact model, validates
the bounded Ollama envelope and single `content` result, then stages an invocation-keyed output.
The runtime validates the expected staged identity and promotes those bytes through the existing
content-addressed `ArtifactStorePort` transaction before a candidate can reference them. Raw model
claims never become verification evidence.

## Real Kernel Effect

The kernel accepts only workflow `stage4.tiny-code`. It creates a job-owned workspace containing
an initially failing `solution.mjs` and an independent `verify.mjs`, hashes the bounded candidate,
persists a meaningful checkpoint containing job/stage/hash/size, and atomically applies the
candidate to `solution.mjs`. Absolute/traversal/noncanonical identities, symlinks, oversized work,
foreign/stale checkpoints, and changed candidate content fail closed.

The apply operation is idempotent by candidate hash. It also detects the crash gap where the file
was replaced but completion state was not yet recorded, records that existing effect without
reapplying it, and refuses an emergency-stopped already-applied effect. The regression that first
demonstrated the defect observed `applyCount: 2`; the fixed result is exactly one.

## Verifier Implementation

The verifier adapter accepts only tool `stage4-deterministic-verifier` and operation
`verify_candidate`. It spawns a separate Node process in the contained job workspace:

```text
node --permission --allow-fs-read=<job-workspace> verify.mjs
```

It inherits only `PATH`, captures bounded stdout/stderr, enforces the check timeout, and derives
status solely from process exit status. The runtime validates verifier/check/report identity,
persists the report through `ArtifactStorePort`, and constructs immutable candidate-scoped
evidence. The model response and model confidence are not inputs to the verdict.

## Independence Proof

- The model, kernel, and verifier are different supervised children.
- The verifier executes fixture-owned deterministic assertions, not model-authored tests.
- A passing model response without exit-zero verifier evidence cannot become a champion.
- `verifyCandidates`, `selectChampionUseCase`, and `deliverResult` remain the existing application
  authorities; routes and adapters cannot mint a champion or receipt.

## Positive Verification Proof

The hermetic real-process integration produced correct candidate source, a real kernel apply,
exit-zero independent verifier evidence, a `passed` verification result, a champion decision, and
a delivery receipt. The actual Ollama proof repeated that path after a controlled interruption and
fresh runtime restart. It found one candidate, checkpoint, evidence record, champion decision, and
delivery receipt; the kernel recorded `applyCount: 1`.

## Negative Verification Proof

A supervised model fixture produced `return a - b`. The kernel applied that real file and the
separate Node verifier exited nonzero. Immutable failed evidence was persisted, the decision was
`no_verified_solution`, the job failed, and zero delivery receipts existed. A lower-level adapter
proof also runs the verifier before candidate application and observes failure, then after the
bounded apply and observes success.

## Checkpoint and Restart Proof

The runtime persists its execution owner in the job stage and deterministic prompt, invocation,
candidate, plan, evidence, checkpoint, decision, and receipt identities. A controlled failure is
injected only after the real kernel apply has durably completed, leaving the authoritative job
running and claimed. After full runtime shutdown, a brand-new runtime opens the same SQLite and
workspace roots, CAS-claims the old owner, reuses the persisted model/candidate/checkpoint, inspects
kernel status and checkpoint identity, and invokes idempotent resume. The same external command key
then completes verification and finalization.

Proof counts after restart: one Ollama request, candidate, checkpoint, evidence record, decision,
and receipt; unchanged checkpoint identity; kernel `applyCount: 1`. A completed same-key retry is
served by the durable idempotency record and performs no second effect.

## Failure Matrix

| Failure | Executable behavior/evidence |
|---|---|
| Missing model/kernel/verifier adapter process | Supervisor spawn failure is explicit and retains no phantom process |
| Ollama unavailable or model request rejected | Adapter RPC fails; runtime returns typed dependency failure; no candidate/delivery |
| Requested model mismatch | Adapter rejects any model other than its configured exact identity |
| Model timeout/cancel | Bounded RPC timeout and propagated operation cancellation reject; adapter abort is available |
| Model child exit/malformed response | Exit, malformed JSON-RPC, malformed Ollama envelope/JSON, and oversized output reject |
| Kernel child exit/timeout | Generic supervised process exit/timeout rejection applies to the kernel binding |
| Unsafe path/content | Canonical IDs, real-path containment, symlink rejection, and 64 KiB limits fail closed |
| Invalid/stale/foreign checkpoint | Kernel validates persisted job, checkpoint, state, and candidate hash before effect |
| Post-effect stop/replay | Emergency-stopped already-applied effect rejects and `applyCount` remains one |
| Verifier missing/timeout/exit/malformed result | Supervision or report validation rejects; never converted to pass |
| Verifier failed check | Nonzero exit persists failed evidence and blocks champion/delivery |
| Runtime interruption | Fresh-runtime checkpoint reconciliation completes with no duplicate durable/external effect |
| Concurrent execute | Existing atomic job claim and revision match reject a same-runtime concurrent claimant |
| Repeated/completed idempotency key | Existing payload-hash contract rejects conflict and replays the completed authoritative result |
| Expired operation deadline | Gateway timeout is clamped to wall-clock time remaining, minimum 1 ms |

## Real End-to-End Command and Result

Command:

```bash
V31M4_STAGE4_REAL=1 \
V31M4_OLLAMA_ENDPOINT=http://127.0.0.1:11434 \
V31M4_OLLAMA_MODEL=devstral-small-2:24b \
node scripts/prove-stage4-real.mjs
```

Result on 2026-08-11: **PASS**, 1/1 real test. The second bounded model attempt first established
the corrected path in 4.98 seconds; the final post-repair acceptance rerun passed in 22.07 seconds.
The first attempt was the confirmed schema-grammar compatibility defect described above; no
success was fabricated or silently replaced by a reference adapter.

## Hermetic Test Result

The Stage 4 real test is skipped unless `V31M4_STAGE4_REAL=1`. The default runtime profile and
`pnpm check` remain independent of Ollama. Focused Stage 4/owning-layer verification before the
final full gate: 52/52 across 11 files, plus the real target-host test 1/1. Final workspace counts
are recorded below after the closing gate.

## Confirmed Defects and Fixes

1. Supervised model RPC leaked application-only `metadata`; the strict adapter request now receives
   only frozen `1.0.0` fields.
2. Model/tool cancellation used nonexistent provider methods and operation cancellation was not
   propagated into RPC; both now use `adapter.cancel` and the existing cancellation signal.
3. The production-kernel gateway used method/parameter names that contradicted the frozen RPC
   contract; all five operations now use the exact contract methods and required identities.
4. Child adapters inherited the whole parent environment; process supervision now defaults to a
   small OS allowlist plus explicit adapter configuration.
5. Adapter deadlines were calculated from operation start, not the current wall clock; timeout is
   now clamped to the actual remaining deadline and fallback bound.
6. Ollama 0.32.7 rejected unsupported JSON grammar keywords; wire grammar is compatible while
   equivalent byte/key/content enforcement remains at the trust boundary.
7. Kernel resume after an already-applied emergency stop reapplied the candidate (`applyCount: 2`);
   applied-content/state reconciliation now prevents the duplicate and rejects that stopped resume.
8. Stage 4 growth placed `job-command-surface.ts` above the mandatory 500-line limit; small command
   validation/hash helpers were extracted and the existing architecture regression is green.
9. JSON-RPC remote errors lost their code, message, and retryability at the client/gateway boundary;
   strict error-envelope parsing now preserves all three while transport failures remain retryable.
10. RPC timeout/cancellation rejected only the caller while leaving supervised external work alive;
    typed timeout/cancel failures now terminate the owned process group and permit a clean restart.

## Known Limitations

- `supervised_local` proves only the allowlisted `stage4.tiny-code` workflow and installed Ollama
  model; it is not a general code-production kernel or multi-model catalog.
- Repair rounds remain zero for this proof; an incorrect real model candidate honestly produces no
  verified solution rather than an automated repair loop.
- Reference components remain deliberately available for hermetic default execution.
- Video ShotGeneration, Summer-backed Game adapters, controlled learning, and idle practice remain
  separate incomplete capabilities.

## Next Real Capability

Do not add more API/UI scaffolding. The next critical path is a bounded generalization from the
single Stage 4 fixture to a real project-owned coding workspace/build packet with approved tool
operations and repair rounds, still behind the same model/kernel/verifier ports and evidence gate.
Department-specific ComfyUI/Summer adapters remain independently sequenced.

## Final Verification Evidence

- Focused Stage 4/owning-layer selection before the closing gate: 52/52 across 11 files.
- Post-status-reconciliation focused runtime selection: 19/19 across 4 files.
- Actual installed-Ollama acceptance: 1/1, final rerun 22.07 seconds.
- `pnpm check`: PASS.
  - Biome: 327 files, 0 errors, 9 existing warnings, 1 existing deprecation info.
  - TypeScript: 9/9 packages.
  - Hermetic Vitest: 453 passing, 11 skipped, 464 total across 100 passing + 3 skipped files.
    The real Ollama proof is one of the explicit default skips and was run separately above.
- Runtime/infrastructure dependency, source-size, and explicit-`any` architecture tests: PASS;
  largest changed runtime source is 498 lines and changed source contains no explicit `any`.
- `git diff --check`: run again after this evidence update and immediately before publication.
