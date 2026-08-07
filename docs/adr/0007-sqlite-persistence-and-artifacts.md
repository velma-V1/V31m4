# ADR 0007: SQLite persistence and content-addressed artifacts

**Status:** Accepted

## Decision

Layer 7 uses one SQLite authority with WAL, foreign keys, full synchronous commits,
ordered migrations, `BEGIN IMMEDIATE` units of work, and explicit record revisions.
Drizzle owns the typed table declarations; migration SQL remains explicit and ordered.
Mutable records use compare-and-swap revisions. Immutable records use insert-only
semantics. Domain events enter an ordered transactional outbox in the same transaction as
state.

Artifact bytes live outside SQLite in SHA-256-addressed paths. Writes use exclusive
temporary files, flush, atomic rename, and post-write hash verification. Metadata is
transactional; rollback removes newly promoted unreferenced content. Duplicate bytes share
one content path.

Backups use SQLite's online backup API and durable sidecar manifests. Restore verifies the
snapshot hash before replacement and reopens the database with the required pragmas and
migrations.

## Consequences

External execution remains outside database transactions. Concurrent writers serialize
at SQLite and stale revisions fail deterministically. Later runtime command handling can
store durable idempotency outcomes and replay committed outbox sequences without another
authority.
