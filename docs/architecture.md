# V31M4 Architecture

**Specification:** `V31M4-SRS-001`  
**Baseline:** `1.0.0`

V31M4 is a local-first modular monolith with Clean Architecture dependency direction, hexagonal ports, isolated external adapters, durable event-driven orchestration, and removable production plugins.

## Dependency direction

```text
Interface applications
        ↓
Application use cases and ports
        ↓
Domain entities and value objects

Infrastructure implements application ports.
Adapters implement model, tool, and kernel protocols.
Plugins register bounded capabilities through the plugin SDK.
Laboratories remain isolated from production state.
```

Dependencies always point toward the domain. The domain package has no runtime, infrastructure, adapter, plugin, UI, provider, filesystem, process, network, or database dependencies.

## State authority

The future runtime process will own authoritative project, mission, job, evidence, checkpoint, artifact, capability, promotion, and avatar state. Interfaces may cache and display that state but never own it.

## Domain authority

Layer 2 establishes immutable domain state and transition rules before persistence or orchestration exists. Domain factories validate all externally supplied values. Transition functions return new frozen state and never mutate prior state. Illegal lifecycle movement raises typed domain errors.

Job lifecycle transitions also produce immutable domain events. Models, adapters, tools, and interfaces cannot directly alter domain state.

## Verification authority

Models may propose solutions, critiques, claims, and repairs. Models may not certify their own work. Acceptance requires independent deterministic evidence whenever deterministic verification is available.

The domain enforces:

- Evidence records are immutable and artifact-backed.
- Verified checkpoints require evidence.
- Mandatory verification failures prevent a passing result.
- Missing mandatory checks produce an inconclusive result.
- Champion delivery requires complete mandatory and requirement coverage.
- Training data begins quarantined and cannot be promoted before verification.
- Avatar unlock records require immutable evidence.

## Current implemented boundary

Domain Entity Layer 2 contains repository governance, domain primitives, all domain entities listed in the repository specification, their immutable transitions, public exports, and behavior tests.

No application services, ports, persistence, runtime API, desktop UI, CLI, gateways, adapters, plugins, laboratories, or production workflows are implemented.
