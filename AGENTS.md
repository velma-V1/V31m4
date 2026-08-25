# V31M4 Contributor Operating Rules

Before changing, adding, moving, renaming, or deleting any repository file, read `/docs/architecture.md`, `/docs/repository-map.md`, `/docs/dependency-rules.md`, and the nearest module README. Do not infer architecture from implementation alone. If implementation conflicts with the architecture documents, stop and report the conflict before modifying files.

## Required workflow

1. Read `docs/repository-specification.md`.
2. Identify the owning layer and package.
3. If the change touches contracts, schemas, APIs, events, manifests, workflows, or adapter messages, read `docs/contract-versioning.md`.
4. If the change touches autonomous task state, Task DAGs, model/tool execution, sandboxing, project intelligence, context assembly, skills, memory, quality-floor execution, independent verification, MCP/A2A interoperability, or self-improvement, read both `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture.md` and `docs/superpowers/plans/2026-08-25-autonomy-quality-floor.md`; execute exactly one plan task/phase at a time and do not cross its hard gate before review.
5. Confirm every proposed import is permitted by `docs/dependency-rules.md`.
6. Reuse existing interfaces instead of creating parallel abstractions.
7. Write or update tests before production behavior.
8. Run the narrowest relevant checks, then the complete layer checks.
9. Update `repo_map.md` and `docs/repository-map.md` in the same change when ownership/current-state meaning changes.
10. Do not mark work complete without recorded verification evidence.

## Autonomy-program rules

- `V31M4-AUTONOMY-001` is an explicitly approved additive architecture expansion. Preserve all existing public v1 semantics; add new authoritative concepts through the normal domain/contract-or-port/use-case/infrastructure/runtime path when genuinely required rather than creating shadow state.
- The approved spec is the architecture source of truth; the approved plan is the execution source of truth. If live implementation evidence makes a plan interface invalid, stop and record the exact conflict rather than silently redesigning the architecture.
- Named external projects in the autonomy spec are classified as direct substrates, adapter challengers, interoperability formats, evaluation tools, or research mechanisms. Do not replace V31M4 orchestration/state/policy/evidence with a full external agent framework.
- Implement the autonomy phases in the dependency order defined by the spec and plan. Do not begin self-improvement or later-phase optimization before earlier hard gates are satisfied.
- The primary local acceptance model may change; no core type or invariant may depend on Qwen3.8 specifically.
- The sandbox backend is deliberately unresolved until target-host bake-off. Freeze the V31M4-owned `SandboxPort`, not OpenSandbox/OpenShell/direct-Docker as a permanent implementation.

## Non-negotiable boundaries

- Domain code imports no infrastructure, adapters, plugins, applications, UI, or contracts.
- Contract source imports only the domain public API and Zod.
- UI code never owns authoritative project state.
- Models never certify their own outputs.
- External tools and models are invoked only through typed gateways.
- Production assets are modified only through isolated working copies.
- Accepted evidence and verified checkpoints are immutable.
- Optional tools and plugins must never be required for core startup.
- Unsupported contract or protocol versions are rejected rather than coerced.