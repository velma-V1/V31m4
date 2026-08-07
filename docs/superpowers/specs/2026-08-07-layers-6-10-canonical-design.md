# Canonical Layers 6–10 Design

**Approved:** 2026-08-07

**Immutable root:** `5746e5f2571a08dea3cce0493adeac92ae025135`

**Reference only:** `61e09ee81c73be5a3eda32e0516b35f02386641d`

## Objective

Extend the hardened Layer 5 line through one canonical, sequentially verified Layers 6–10 implementation. The superseded Layer 6 is evidence and source material only; it is not merged or cherry-picked wholesale.

## Delivery shape

Each layer is a distinct reviewable commit. A layer may advance only after focused correctness and failure tests, the complete native gate, dependency verification, anti-drift review, and documentation updates all pass. Confirmed regressions are fixed before the next layer begins.

## Layer 6: application use cases

Implement the 21 specified use cases using the hardened domain, ports, and deterministic services. Every authoritative mutation uses `UnitOfWorkPort`; every mutable write supplies `WriteCondition`; immutable records remain append-only. External operations use durable prepare/commit, external execution, and finalize-or-fail/commit phases. Collection decisions exhaust pagination and reject repeated cursors. Approval expiry is inclusive (`expiresAt <= now`). Practice tasks persist the exact opaque workspace identity used for cleanup.

The detailed classification is recorded in `docs/reviews/layer-6-reconciliation-matrix.md`.

## Layer 7: persistence and artifacts

Add `@v31m4/infrastructure` with SQLite-backed migrations, unit of work, repositories, durable idempotency storage, transactional outbox, append-only immutable tables, content-addressed artifacts, and backup/restore. SQLite transactions serialize authoritative writes and repository revisions implement compare-and-swap semantics. Artifact writes stage to a temporary file, hash the bytes, atomically promote, and re-read/hash before acceptance.

## Layer 8: process and adapter infrastructure

Implement a bounded process supervisor and JSON-RPC client with message-size limits, protocol validation, cancellation, timeout, process-tree termination, restart policy, and captured stdout/stderr. Add adapter registration, scheduler, resource monitoring, secret leases, and structured logging without allowing adapters to import runtime persistence.

## Layer 9: production gateways

Implement model, tool, plugin, and kernel gateways plus policy and path enforcement. Gateways translate provider-neutral ports to supervised adapters. Tool and kernel writes use isolated workspaces and promotion gates. Path policy canonicalizes real paths and rejects traversal, drive/UNC/device escapes, symlink/junction/reparse escape, mixed-separator ambiguity, case tricks, and roots outside approved project, artifact, or backup boundaries.

## Layer 10: authoritative runtime

Implement the Fastify runtime, composition root, strict configuration, authenticated local sessions, typed routes, WebSocket events, startup recovery, and checkpoint-safe shutdown. Routes translate contracts and call use cases; they contain no business logic.

### Durable event replay acceptance contract

- Every committed event receives one monotonically increasing durable sequence in the same transaction as its authoritative state change.
- A subscription requests `afterSequence`; replay is strictly ordered and contains only sequences greater than the cursor.
- The server detects internal gaps and refuses ambiguous replay.
- If the cursor predates retained history, the server returns `refresh_required` with the oldest and latest available sequence; it never silently resumes from a newer point.
- Live delivery begins only after the replay boundary is fixed, preventing replay/live races.
- Slow clients have a bounded queue and are disconnected with an explicit resumable cursor; clients reconnect and replay.
- A client that receives `refresh_required` reloads authoritative state and establishes a fresh cursor.

### External command acceptance contract

- Every state-changing request carries one `idempotencyKey` and an `expectedRevision` when mutating an existing aggregate.
- The runtime stores actor, command type, canonical payload hash, status, and serialized durable result in the same SQLite authority boundary.
- Same actor/key/type/hash returns the stored result without repeating the operation.
- Same actor/key with a different type or payload hash returns an idempotency conflict.
- A stale expected revision returns a version conflict.
- Concurrent writers deterministically produce one commit and one or more version conflicts.
- A timeout followed by retry cannot duplicate a durable operation.

## Verification and hardening

Each production behavior starts with a failing regression or contract test. After Layer 10, run four integrated passes across Layers 1–10: invariant/state-machine attacks; hostile-input/security attacks; crash/concurrency/recovery attacks; and clean-room architecture/operations review. Every confirmed defect follows reproduction, failing test, root-cause fix, focused verification, affected-pass rerun, and full regression.

Final evidence includes branch and SHA, test count and files, failures and skips, typecheck, build, lint, check, largest source file, explicit `any` scan, unresolved risk severity, and a clean-checkout rerun.
