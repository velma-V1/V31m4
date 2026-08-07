# @v31m4/application

This package defines the inward-facing Layer 4 ports used by application services and use
cases, implements the Layer 5 application services that turn domain state and those ports
into decisions and plans, and implements the Layer 6 use cases that coordinate
authoritative state and external side effects. It contains no persistence, process,
network, provider,
adapter, plugin, runtime-server, or interface implementation.

## Port rules (Layer 4)

- Imports are limited to `@v31m4/domain` and files inside this package.
- Every long-running or externally backed operation accepts `OperationContext`.
- Repository writes use explicit optimistic-concurrency conditions.
- Immutable records such as evidence and audit entries are append-only.
- Cancellation, deadlines, idempotency, and correlation are shared concerns, not redefined per port.
- Ports expose provider-neutral types only.
- Port implementations may reject with `ApplicationError`; they must never leak provider SDK errors across this boundary.

## Service rules (Layer 5)

The nine services under `src/services` are pure decision and planning functions:

- They import only `@v31m4/domain` and application-local files.
- They are deterministic for identical inputs — no hidden clock and no hidden randomness. Time enters through inputs or `ClockPort`; seeds enter explicitly.
- They return frozen results and never persist, publish, or invoke external systems directly.
- Every rejection is a typed `ApplicationError` or an explicit decision result.
- Models never certify their own work; model confidence and model size are never treated as evidence or as a proxy for quality.
- Helpers under `src/services/internal` are private and are not part of the public API.

Services: `compute-governor`, `context-compiler`, `diversity-planner`, `evidence-linker`,
`champion-selector`, `improvement-policy`, `capability-calculator`, `practice-selector`,
and `avatar-unlock-engine`.

## Use-case rules (Layer 6)

The 21 use cases under `src/use-cases` use units of work for authoritative mutations,
explicit revisions for mutable writes, append-only immutable stores, complete pagination,
and typed application errors. External execution follows prepare/commit, invoke, and
finalize-or-fail/commit phases. Use cases do not import contracts or infrastructure.
