# ADR 0008: Supervised adapter process boundary

Status: accepted

Adapters execute as child processes behind newline-delimited JSON-RPC 2.0. The runtime owns spawning,
timeouts, cancellation, framing limits, stderr limits, restart budgets, and process-tree cleanup. Protocol
corruption fails closed and rejects every outstanding call. Adapter-facing modules cannot import SQLite or
secret-store implementations. Secrets use bounded, single-use leases and structured logs redact registered
secret values.

This preserves the Layer 1–7 rule that external execution cannot occur inside an authoritative transaction:
the supervisor is operational infrastructure, never a repository or transaction owner.
