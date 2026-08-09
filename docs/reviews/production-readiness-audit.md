# Production-Readiness Audit — L1–10 Core

Principal audit of the completed Layers 1–10 core for reliability, security, efficiency,
maintainability, and operability. Evidence-first: every finding was confirmed against executable
code, and every fix carries a regression test. Deferred Video and 3D/Game departments were out of
scope and untouched.

- **Starting SHA:** `ba0e0d6dbff4645ae53a46c3b157ca2592055275`
- **Date:** 2026-08-09

## Findings and dispositions

### HIGH-1 — Idempotency record write could be silently swallowed (durability / correctness)
`SqliteIdempotencyStore.complete` caught every INSERT error, called `lookup`, and returned success
whenever `lookup` did not itself throw. For a genuine (non-duplicate) write failure — a
serialization error, `SQLITE_FULL`, or an I/O fault — `lookup` finds no row and returns `null`, so
the original error was swallowed. Because `complete` runs inside the command's serialized
transaction, the record and outbox event would then commit **without** the idempotency record,
breaking retry deduplication (a later retry re-runs and can duplicate the durable effect) and
hiding the write failure.
**Fix:** serialize the result up front (a non-serializable result now throws instead of silently
losing the record); on an INSERT failure, treat only a confirmed matching duplicate as idempotent
success and re-throw every other error so the transaction rolls back.
**Regression:** `packages/infrastructure/tests/idempotency-store.test.ts` — matching duplicate is a
no-op, type/hash mismatch conflicts, and a non-serializable result throws and records nothing.

### MEDIUM-2 — Misleading, O(n) health/startup metric (observability / efficiency)
The runtime never calls `markPublished` (the outbox is the durable replay log, retained for replay
rather than drained), so `published_at` is always `NULL` and the `pendingEvents` field reported the
ever-growing **total** event count via a full-table `COUNT(... WHERE published_at IS NULL)` scan on
every `/health` request and startup.
**Fix:** report `latestSequence` — `MAX(sequence)`, an O(1) index read and the truthful head of the
durable log (the cursor a client resumes toward). Field renamed across the composition, bootstrap,
server `/health`, and the startup log line.
**Regression:** existing runtime/hardening tests updated to assert `latestSequence`.

### MEDIUM-3 — SSE delivery could leak a pending promise on mid-backpressure disconnect (reliability)
When a slow SSE consumer applied backpressure, `deliver` awaited a `drain` event. If that client
disconnected while parked, `drain` never fired, so the promise never settled, the coordinator's
drain loop stayed parked, and the `drain` listener was never removed.
**Fix:** race `drain` against `close`/write-`error`, reject on disconnect (the coordinator then
releases the subscription), and always remove both listeners.
**Regression:** `apps/runtime/tests/runtime-server.test.ts` — an SSE client disconnect drives the
coordinator's active subscription count back to zero.

### LOW-4 — Empty secret would corrupt redacted logs (defensive)
`RedactedLogger.write` called `line.replaceAll(secret, "[REDACTED]")` for each secret; an
empty-string secret would splice the marker between every character and destroy the log line.
**Fix:** skip empty secrets.
**Regression:** `packages/infrastructure/tests/adapter-operations.test.ts` — an empty secret is
ignored while a real secret is still redacted.

## Surfaces audited and found sound (no change)

- **PathPolicy:** real-path canonicalization of the deepest existing ancestor, `..` collapsed by
  `resolve` before the walk, `root + sep` containment check — no traversal/symlink/prefix bypass.
- **Local auth:** constant-time bearer comparison; unknown/malformed credentials fail closed.
- **Error mapper:** unknown errors collapse to an opaque 500; `ApplicationError.details` are
  structured and, under the loopback + authenticated-operator threat model, acceptable to return.
- **Adapter invoker:** provider/transport failures are reclassified as `DEPENDENCY_FAILURE`; the
  original cause is retained internally but never serialized to a client.
- **Bounded input:** JSON-RPC frames capped (1 MiB) and supervisor stderr capture capped (1 MiB).
- **Transaction hooks:** the post-commit live publish cannot throw (enqueue is non-throwing), so a
  committed command cannot be reported as failed in a way that corrupts state; idempotency covers a
  spurious retry.
- **Architecture:** no reverse dependency into `apps/runtime`; runtime imports only Node built-ins
  and `@v31m4/*`; routes hold no business logic; zero explicit `any`.

## Retained known limitations (not defects)

- **Outbox retention/pruning is not implemented.** The durable event log grows with committed
  events. The replay store already supports pruned history (`refresh_required` when a cursor
  predates `oldest`), so retention is an additive operational feature, intentionally not introduced
  here to avoid scope expansion on a working system.
- **Event transport is SSE, not WebSocket** (ADR 0009), by deliberate design; the coordinator is
  transport-agnostic.

## Verification

Full native gate after the fixes: `pnpm typecheck` 5/5, `pnpm test` 340 cases / 71 files,
`pnpm build` 5/5, `pnpm lint` / `pnpm check` green (0 errors, 1 info). Final clean-checkout results
are recorded in `docs/reviews/clean-checkout-verification.md`.
