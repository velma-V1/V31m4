# @v31m4/infrastructure

Layer 7 implements application ports with SQLite transactions, optimistic revisions,
append-only durable records, a transactional outbox, durable idempotency records,
content-addressed artifacts, and verified backup/restore. It imports only the application
and domain public APIs plus infrastructure libraries.

Layer 8's `SupervisedAdapterProcess` is the reusable lazy binding from the existing
`ProcessSupervisor` to the bounded `JsonRpcClient`. Child processes inherit only an explicit safe
OS-variable allowlist plus adapter configuration, propagate operation cancellation, restart after
unexpected exit, and are stopped as process groups. Stage 4's optional local model/kernel/verifier
children consume this binding; the package remains provider-neutral and the default runtime does
not require those children or Ollama.
