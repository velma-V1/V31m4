# V31M4 Current State

This file is a concise operational handoff for future Claude Code sessions. It records verified repository state and should be updated whenever branch, implementation, verification, blockers, or remaining work materially changes.

## Repository state

- Branch: `canonical/layers-6-10`
- Handoff baseline commit before this file was added: `2fe85cd708c6dffd4d05872f3a85926648e6a676`
- Live HEAD: verify from git at every session start; do not trust a stored SHA as current after subsequent commits.
- Architecture baseline: `V31M4-SRS-001 / 1.0.0`
- Hardened ancestor: `5746e5f2571a08dea3cce0493adeac92ae025135`
- Canonical continuation is based on the hardened Layer 5 line. Older Layer 6 implementations are reference material only.

## Verified implemented state

- Layers 1-5: hardened baseline complete before this canonical continuation.
- Layer 6: 21 application use-case orchestration entrypoints are present under `packages/application/src/use-cases`.
- Layer 7: SQLite persistence, transactional outbox/idempotency, content-addressed artifacts, and verified backup/restore are present under `packages/infrastructure`.
- Layer 8: repository evidence records process supervision, JSON-RPC framing/correlation, adapter registration, restart-budget protection, bounded scheduling, resource monitoring, secret leases, and redacted logging.

## Important repository evidence already inspected

- `repo_map.md` reports Layer 6 use cases and Layer 7 infrastructure with a full Layer 1-8 regression of 286 passing cases across 60 test files.
- `docs/repository-map.md` records ownership for the Layer 6 application-use-case surface and Layer 7 persistence/artifact infrastructure.
- `docs/reviews/layers-1-8-improvement-ledger.md` records Layer 8 process/adapter infrastructure and its failure-path coverage.

These documents are not perfectly synchronized: `repo_map.md` still labels the current layer as Layer 7 and says process/adapter infrastructure is not implemented, while the Layer 1-8 ledger records Layer 8 implementation. Treat this as documentation lag that must be reconciled before claiming Layer 8 complete.

## Known verification evidence

Latest repository-map evidence inspected during handoff setup reports:

- Full Layer 1-8 regression: 286 passing cases across 60 test files.
- Layer 7 real-infrastructure regression: 11 passing cases across 5 test files.
- `pnpm typecheck`: 3/3 packages pass.
- `pnpm build`: 3/3 packages pass.
- Native gates recorded green: typecheck, test, build, lint, check.
- Largest source file recorded at 468 lines.

Do not treat these historical results as proof for new changes. Re-run the appropriate focused and full gates after modifying code.

## Resolved architectural direction

- Current canonical contracts/interfaces are authoritative over superseded/reference branches.
- Old Layer 6 may be used for behavioral comparison only.
- Do not rename current APIs or create compatibility shims merely to imitate old names.
- Application use cases orchestrate through existing domain/services/ports and preserve transaction/external-call boundaries.
- World/runtime/API concerns belong to their owning later layers rather than being forced into earlier core layers.

## Areas already mapped

Unless new evidence, compile/test failures, changed interfaces, or contradictions require reinspection, avoid broad rediscovery of:

- Layer 1-5 hardened architecture and contracts.
- Layer 6 application port surface and use-case ownership.
- Layer 7 persistence/artifact ownership.
- Existing architecture/source-of-truth documents already referenced by `AGENTS.md`.

Use targeted search/read for the exact interface or invariant needed by the current task.

## Known blocker / inconsistency

Documentation lag exists between `repo_map.md`, `docs/repository-map.md`, and the Layer 1-8 improvement ledger regarding Layer 8. Verify the actual tree/tests and reconcile the maps before marking Layer 8 complete.

## Current task / next action

1. Verify the actual latest Layer 8 tree and tests on `canonical/layers-6-10` rather than relying on stale map text.
2. Reconcile repository maps/ownership documentation with the implemented state.
3. Continue the approved canonical Layers 6-10 plan from the latest verified incomplete layer.
4. Use grouped implementation, focused tests during development, and the native full regression gate at layer checkpoints.

## Session-start rule

Read this file first, verify branch/HEAD/status/diff, then continue from the latest verified incomplete task. Do not rescan the entire repository unless evidence requires it.
