# @v31m4/application

Layers 4 and 5 define the inward-facing application boundary and deterministic decision services. The package contains no persistence, process, network, provider, adapter, plugin, runtime-server, or interface implementation.

## Layer 4 ports

- Twenty-six ports cover repositories, artifacts, events, models, tools, plugins, kernels, verification, policy, approvals, audit, scheduling, resources, secrets, time, isolated workspaces, configuration, and backup.
- Every authoritative write requires a unit-of-work transaction.
- Mutable writes require optimistic-concurrency conditions.
- Long-running operations receive immutable cancellation and deadline context.

## Layer 5 services

- Compute governor
- Context compiler
- Diversity planner
- Evidence linker
- Champion selector
- Improvement policy
- Capability calculator
- Practice selector
- Avatar unlock engine

## Rules

- Imports are limited to `@v31m4/domain` and files inside this package.
- External API contracts are translated outside the application core.
- Services are deterministic and return immutable decisions.
- Services do not access persistence or external systems directly.
- Immutable records such as evidence, candidates, and audit entries remain append-only.
- Models cannot verify their own work, and model confidence is not evidence.
- Port implementations may reject with `ApplicationError`; provider SDK errors never cross this boundary.
