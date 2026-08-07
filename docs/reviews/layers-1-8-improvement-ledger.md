# Layers 1–8 improvement ledger

Layer 8 adds bounded process supervision, strict JSON-RPC framing and correlation, adapter registration,
restart-storm protection, bounded scheduling, resource sampling, single-use expiring secret leases, and
redacted structured logging.

Failure-path coverage includes spawn failure, timeout, cancellation, malformed and oversized frames,
protocol corruption, stderr flooding, child crash rejection, restart storms, and idempotent process cleanup.
Architecture coverage prevents adapter/process/RPC modules from importing SQLite or the secret implementation.
All previous Layer 1–7 regression tests remain part of the native gate.
