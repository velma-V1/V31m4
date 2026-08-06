# @v31m4/application

Layer 4 defines the inward-facing contracts used by application services and use cases. It contains no persistence, process, network, provider, adapter, plugin, runtime-server, or interface implementation.

## Rules

- Imports are limited to `@v31m4/domain` and files inside this package.
- Every long-running or externally backed operation accepts `OperationContext`.
- Repository writes use explicit optimistic-concurrency conditions.
- Immutable records such as evidence and audit entries are append-only.
- Cancellation, deadlines, idempotency, and correlation are shared concerns, not redefined per port.
- Ports expose provider-neutral types only.
- Port implementations may reject with `ApplicationError`; they must never leak provider SDK errors across this boundary.
