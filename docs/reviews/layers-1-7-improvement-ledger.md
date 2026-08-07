# V31M4 Layers 1–7 Improvement Ledger

Layer 6 corrections remain recorded in `layers-1-6-improvement-ledger.md`.

## L7-001: Nested and concurrent SQLite transaction ambiguity

- **Severity:** High
- **Correction:** Async-local ownership rejects nested transactions while a FIFO gate serializes independent writers.
- **Regression:** Nested rejection and deterministic concurrent-writer tests.

## L7-002: State/event split commits

- **Severity:** High
- **Correction:** Outbox insertion uses the owning unit-of-work transaction and rolls back with state.
- **Regression:** Outbox rollback and ordered restart tests.

## L7-003: Artifact partial-write and integrity risk

- **Severity:** High
- **Correction:** Exclusive staging, flush, atomic rename, expected-hash enforcement, and post-promotion rehash.
- **Regression:** Deduplication/open/verify and mismatch rollback tests.

## L7-004: Unverified restore

- **Severity:** High
- **Correction:** Durable sidecar manifest, SHA-256 verification, staged replacement, and pragma/migration reinitialization.
- **Regression:** Restore-to-snapshot and backup-tampering tests.
