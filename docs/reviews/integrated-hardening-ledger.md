# Integrated Layers 1–10 Hardening Ledger

This ledger records the integrated hardening passes run after Layer 10, per Task 6 of
`docs/superpowers/plans/2026-08-07-layers-6-10-canonical.md`. Layers 1–8 were hardened in the
earlier forensic passes (see `docs/reviews/layers-1-8-improvement-ledger.md`); Layer 9 gateways
carry their own failure-path coverage. This pass concentrates on the new Layer 10 runtime attack
surface and the cross-layer command/event integration.

## Pass results (2026-08-09)

- **Hostile input (Layer 10 HTTP surface).** Permanent regressions in
  `apps/runtime/tests/hardening-runtime.test.ts` prove the runtime fails closed on: an oversized
  request body (bounded read → `RESOURCE_EXHAUSTED`, connection preserved so the mapped error still
  reaches the client), non-JSON bodies, non-finite numbers (`1e999` → `Infinity` rejected by the JSON
  safety guard), prototype-pollution payloads (`__proto__` is a forbidden key; `Object.prototype`
  stays unpolluted), a missing or non-canonical `Idempotency-Key`, and an unrecognized bearer
  credential (constant-time comparison, `PERMISSION_DENIED`).
- **Concurrency / determinism (external-command contract).** Six concurrent identical commands
  collapse to a single durable effect (one committed event, identical stored result). Three
  concurrent conflicting updates against the same expected revision resolve to exactly one commit and
  two version conflicts. Both are driven through the real HTTP surface and the serialized SQLite
  unit of work.
- **Crash / recovery (transactional integrity).** A rejected command rolls back with no partial
  record and no stranded outbox event; the record keeps its prior revision. Cross-restart recovery
  (`apps/runtime/tests/runtime-server.test.ts`) proves the durable log survives a process restart and
  is reported by startup recovery and `/health`.
- **Durable event replay refusal.** `apps/runtime/tests/event-stream.test.ts` and
  `packages/infrastructure/tests/event-replay-store.test.ts` prove ordered replay, replay-before-live
  boundary handoff without race or duplication, internal-gap refusal (`INTEGRITY_FAILURE` →
  `refresh_required`), retention `refresh_required` when a cursor predates history, and a bounded
  slow-consumer disconnect carrying a resumable cursor.
- **Clean-room architecture / dependency review.** No package imports `@v31m4/runtime` (the app is
  the top of the dependency stack, never a dependency of a lower layer); runtime source imports only
  Node built-ins and `@v31m4/{domain,application,infrastructure}`; adapter-facing modules import no
  runtime persistence; and there is no explicit `any` in the runtime source. Routes only translate
  transport and delegate to the runtime service and command executor — no business logic in routes.

## Confirmed defects

None. Every adversarial probe above confirmed the intended invariant on first run; the tests are
retained as permanent regressions rather than as scaffolding for a fix.

## Verification

Full native gate after this pass: `pnpm typecheck` 5/5, `pnpm test` 335 cases / 70 files,
`pnpm build` 5/5, `pnpm lint` / `pnpm check` green (0 errors, 1 info).
