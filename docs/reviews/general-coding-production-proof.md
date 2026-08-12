# General Coding Production Proof

## Baseline

- Required and verified starting head: `597ca2a0eaba64ce0d44efcd0defe2fa2e50b9a6` on `main`.
- Stage 4 already proved the `stage4.tiny-code` supervised vertical slice. This item generalizes that path; it does not introduce another execution engine.
- Default `hermetic_reference` startup remains unchanged and requires no Ollama or supervised child process.

## Implemented Boundary

Projects opt into `software.production.v1` with a strict project-owned
`.v31m4/build-packet.json`. The versioned packet binds the authoritative project ID, objective,
required outputs, allowed and forbidden path scopes, allowed file operations, mandatory Node
checks, and file/byte/repair budgets. Unknown fields, unsupported versions or executables,
duplicate values, unsafe paths, and contradictory output scopes fail at the contract boundary.

The runtime resolves the project's existing `rootPath` beneath its owned projects root, rejects
symlinks, enforces packet budgets, and copies the project into the existing supervised kernel's
job workspace. It persists bounded allowed-path context there and prompts the existing
`ModelGatewayPort` path for a closed JSON change manifest. The existing checkpoint and
`ProductionKernelPort` path validates the complete manifest before applying it. Original project
files are never modified.

The existing supervised verifier executes the packet's mandatory Node command with an executable
plus argument array and derives pass/fail from the real process exit code. Only its immutable
artifact-backed evidence enters the unchanged champion and delivery use cases.

## Real Target-Host Proof

Command:

```text
pnpm prove:general-coding
```

The explicit opt-in proof used the already-installed Ollama 0.32.7 model
`devstral-small-2:24b`; no model was pulled. A real HTTP runtime created a project and mission in
SQLite, prepared a multi-file Git-style fixture containing multiple source files, package metadata,
an independent test, and an unrelated README, then started and executed a
`software.production.v1` job. The real model produced a strict update manifest, the real
supervised kernel changed only the isolated copy, the independent Node verifier passed, immutable
evidence was persisted, and the normal champion/delivery gate completed.

Final target-host rerun: **1 passed / 3 intentionally skipped** in the selected test file.

## Hermetic and Negative Proof

- Contract/public API, workspace containment, atomic manifest effect, supervised adapter, general
  HTTP/SQLite, Stage 4 regression, source-size, and dependency selection: **28 passed / 1 opt-in
  skipped across 8 files**.
- Out-of-scope model writes are rejected before a workspace effect and create no delivery.
- A valid change that fails the independent check persists failed evidence, selects
  `no_verified_solution`, and creates no receipt.
- Same-key execution replay returns the stored result without another model/kernel effect.
- A fresh runtime over the same SQLite database reads the completed authoritative job.
- Source symlinks, traversal/absolute contract paths, malformed manifests, duplicate paths,
  unsupported operations/executables, packet/project mismatch, and budget violations fail closed.
- The complete Stage 4 supervised adapter regression remains green, proving the original workflow
  was not replaced.

## Confirmed Defects Fixed

1. **High — partial external workspace effect.** An update earlier in a valid manifest could remain
   applied if a later file operation failed. An adversarial RED test reproduced it. The kernel now
   prevalidates every target and restores applied entries on an operational failure; the regression
   proves the earlier content remains byte-identical.
2. **Medium — real-model output shape mismatch.** The Stage 4 response schema forced a JavaScript
   string even for general production, so the real model emitted source instead of the required
   manifest. A supervised adapter RED test reproduced it. The adapter now selects a strict
   provider-side change-manifest schema only for the marker-bearing software workflow and retains
   the Stage 4 schema unchanged.

## Architecture Result

- Runtime remains the only application-state authority; adapters have no SQLite access.
- Model, kernel, and verifier effects still cross the existing typed gateways and supervised
  JSON-RPC processes.
- External effects remain outside authoritative SQLite transactions.
- Verification remains independent; model assertions cannot create evidence or delivery.
- The isolated work product, packet, context, candidate, checkpoint, verifier report, evidence,
  champion decision, and receipt retain their existing ownership boundaries.
- No reference component participates in the explicit real proof.

## Known Limitations and Next Item

This item intentionally supports only the deterministic Node verifier command. The broader
governed Git/filesystem/package/Playwright/HTTP tool plane remains Item 4. Verification failures do
not yet trigger bounded immutable repair lineage; Item 2, Autonomous Verified Repair, is the next
critical-path task. Model discovery/routing, learning, practice, desktop, CLI, and laboratory work
also remain incomplete.

## Verification Evidence

- Focused hermetic gate: `pnpm exec vitest run ...` — 28 passed, 1 opt-in skip across 8 files.
- Actual installed-model gate: `pnpm prove:general-coding` — 1 passed, 3 filtered skips.
- Full repository gate: `pnpm check` — lint 0 errors (9 existing warnings, 1 existing info),
  typecheck 9/9, and 472 passed / 12 skipped (484 total) across 104 passed + 3 skipped test files
  (107 total). Chromium used the reversible `/tmp` library extraction already documented for the
  browser proof; no system package was installed.
- `git diff --check`, source-size, dependency, explicit-`any`, complete diff, and clean-status review
  are required immediately before publication.
