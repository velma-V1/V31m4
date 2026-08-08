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

Reconciled on 2026-08-08: `repo_map.md` now labels the current layer as Layer 8 and records Layer 7 persistence plus Layer 8 process/adapter infrastructure with the verified regression numbers above.

## Known verification evidence

Latest repository-map evidence inspected during handoff setup reports:

Re-run and verified on 2026-08-08 after restoring the Layer 7 content-addressed artifact store:

- Full Layer 1-8 regression: 286 passing cases across 60 test files.
- Layer 7-8 real-infrastructure regression: 21 passing cases across 9 test files.
- `pnpm typecheck`: 4/4 packages pass (domain, contracts, application, infrastructure).
- `pnpm build`: 4/4 packages pass (`tsc --noEmit`).
- `pnpm lint` and `pnpm check`: green (0 errors, 1 info).

Do not treat these results as proof for later changes. Re-run the appropriate focused and full gates after modifying code.

## Resolved architectural direction

- Current canonical contracts/interfaces are authoritative over superseded/reference branches.
- Old Layer 6 may be used for behavioral comparison only.
- Do not rename current APIs or create compatibility shims merely to imitate old names.
- Application use cases orchestrate through existing domain/services/ports and preserve transaction/external-call boundaries.
- World/runtime/API concerns belong to their owning later layers rather than being forced into earlier core layers.

## Deferred production departments

```text
VIDEO := {
  role: removable_plugin,
  implementation: DEFER_UNTIL_CORE_COMPLETE,
  core_dependency: false,
  now: RESERVE(extension_slot + required_interfaces),
  later: DESIGN_AND_BUILD_SEPARATELY,
  open_gen_ai: MAY_EVALUATE_OR_REUSE_PARTS_LATER
}

GAME_3D := {
  role: removable_plugin,
  implementation: DEFER_UNTIL_CORE_COMPLETE,
  core_dependency: false,
  now: RESERVE(extension_slot + required_interfaces),
  later: DESIGN_AND_BUILD_SEPARATELY
}

CORE := {
  build_now: true,
  MUST_NOT depend_on(VIDEO | GAME_3D),
  MUST preserve_extension_points(VIDEO | GAME_3D),
  MUST_NOT include(Open_Generative_AI)
}
```

These deferred departments do not gate completion of the core system. Open Generative AI is not part of core; only its potentially useful components may be evaluated later during Video Production design.

## Areas already mapped

Unless new evidence, compile/test failures, changed interfaces, or contradictions require reinspection, avoid broad rediscovery of:

- Layer 1-5 hardened architecture and contracts.
- Layer 6 application port surface and use-case ownership.
- Layer 7 persistence/artifact ownership.
- Existing architecture/source-of-truth documents already referenced by `AGENTS.md`.

Use targeted search/read for the exact interface or invariant needed by the current task.

## Resolved blocker (2026-08-08)

At `6c24c9e` the infrastructure package did not build: `packages/infrastructure/src/index.ts`
exported `./artifacts/content-addressed-artifact-store.js`, but that source file had never
been committed (only its test and the barrel export existed), so infrastructure typecheck
failed and 7 of 9 infra test files failed on the broken barrel import. The store was
implemented from the existing `content-addressed-artifacts` test and the `ArtifactStorePort`
contract (streamed SHA-256 hashing, atomic hash-addressed blob write, content dedup,
expected-hash verification before persistence, transactional metadata with rollback blob
cleanup). Infrastructure and the full Layer 1-8 gate are now green (numbers above).

## Current task / next action

1. Layer 9 governed production gateways: DONE and verified green (2026-08-08) — `PathPolicy`
   real-path containment, fail-closed `RuleBasedPolicyEngine`, `SqlitePluginRegistry`, and
   supervised `SupervisedModel/Tool/ProductionKernel` gateways under
   `packages/infrastructure/src/{paths,policy,plugins,gateways}`. Full gate: typecheck 4/4,
   306 tests / 64 files, build 4/4, lint/check clean.
2. Next: Layer 10 authoritative runtime (Task 5 in
   `docs/superpowers/plans/2026-08-07-layers-6-10-canonical.md`) — Fastify runtime,
   composition root, strict config, authenticated local sessions, typed routes, WebSocket
   events with the durable event-replay contract, and the external-command idempotency
   contract, under `apps/runtime/`.
2. Keep Video Production and 3D/Game Production deferred while preserving only their required
   extension points during core work.
3. Use grouped implementation, focused tests during development, and the native full
   regression gate at layer checkpoints.

## Session-start rule

Read this file first, verify branch/HEAD/status/diff, then continue from the latest verified incomplete task. Do not rescan the entire repository unless evidence requires it.
