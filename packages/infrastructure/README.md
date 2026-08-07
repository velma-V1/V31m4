# @v31m4/infrastructure

Layer 7 implements application ports with SQLite transactions, optimistic revisions,
append-only durable records, a transactional outbox, durable idempotency records,
content-addressed artifacts, and verified backup/restore. It imports only the application
and domain public APIs plus infrastructure libraries.
