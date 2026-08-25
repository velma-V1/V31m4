# V31M4 Contributor Operating Rules

Before changing, adding, moving, renaming, or deleting any repository file, read `/docs/architecture.md`, `/docs/repository-map.md`, `/docs/dependency-rules.md`, and the nearest module README. Do not infer architecture from implementation alone. If implementation conflicts with the architecture documents, stop and report the conflict before modifying files.

## Required workflow

1. Read `docs/repository-specification.md`.
2. Identify the owning layer and package.
3. If the change touches contracts, schemas, APIs, events, manifests, workflows, or adapter messages, read `docs/contract-versioning.md`.
4. If the change touches autonomous task state, Task DAGs, model/tool execution, sandboxing, project intelligence, context assembly, skills, memory, quality-floor execution, independent verification, MCP/A2A interoperability, or self-improvement, read both `docs/superpowers/specs/2026-08-25-autonomy-quality-floor-architecture-v2.md` and `docs/superpowers/plans/2026-08-25-autonomy-quality-floor-v2.md`; these supersede the same-date non-v2 autonomy documents. Execute exactly one plan task/phase at a time and do not cross its hard gate before independent review.
5. Confirm every proposed import is permitted by `docs/dependency-rules.md`.
6. Reuse existing interfaces instead of creating parallel abstractions.
7. Write or update tests before production behavior.
8. Run the narrowest relevant checks, then the complete layer checks.
9. Update `repo_map.md` and `docs/repository-map.md` in the same change when ownership/current-state meaning changes.
10. Do not mark work complete without recorded verification evidence.

## Autonomy-program rules

- `V31M4-AUTONOMY-001 / 1.1.0` is an explicitly approved additive architecture expansion. Preserve runtime API `1.0.0` and adapter protocol `1.0.0`; new autonomy behavior follows the v2 spec/plan, including separately negotiated adapter protocol `1.1.0` where required.
- Do not change the existing `ADAPTER_PROTOCOL_VERSION = "1.0.0"` constant to `1.1.0` or mutate strict v1.0 RPC unions in place. Introduce side-by-side v1.1 schemas/constants/negotiation while retaining and regression-testing v1.0 exactly.
- The v2 spec is the architecture source of truth and the v2 plan is the execution source of truth. The older same-date non-v2 autonomy spec/plan are historical and must not be used for implementation decisions.
- If live implementation evidence makes a v2 plan interface invalid, stop and record the exact conflict rather than silently redesigning the architecture or creating a shadow path.
- Named external projects in the autonomy spec are substrates, challengers, interoperability formats, evaluation tools, or research mechanisms only. Do not replace V31M4 orchestration/state/policy/evidence/memory/acceptance with a full external agent framework.
- Implement phases in v2 dependency order. Do not begin self-improvement or later optimization before earlier hard gates are satisfied.
- The primary local acceptance model may change; no domain/application invariant may depend on Qwen3.8 specifically.
- `WorkspaceManagerPort` remains the worktree/workspace authority; the model must not create worktrees or receive host `.git` authority.
- The sandbox backend is deliberately unresolved until target-host bake-off. Freeze the V31M4-owned `SandboxPort`, not OpenSandbox/OpenShell/direct-Docker as a permanent implementation.
- Sandbox `writableWorkspaceOnly` means no additional writable **host** mount. A sandbox may receive bounded ephemeral sandbox-internal scratch/tmp/cache storage and a temporary HOME when required by build/test tools; that scratch is non-authoritative, contains no ambient host secrets, and is destroyed with the sandbox.
- Public runtime API `1.0.0` strict schemas are immutable. Internal Task Capsule/Ledger/skill/memory state does not automatically become a public endpoint.

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
