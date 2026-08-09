# Game Department Execution-Platform Boundary: Summer

**Status:** Approved architecture decision
**Date:** 2026-08-09
**Architecture baseline:** V31M4-SRS-001 / 1.0.0
**Supersedes (Game Production section only):**
`docs/superpowers/specs/2026-08-07-defer-video-game-departments-design.md`,
`docs/deferred/game-production/README.md`

## Context

`docs/superpowers/specs/2026-08-07-defer-video-game-departments-design.md` deferred all
game-engine-specific implementation until after core completion. That deferral is now resolved at
the department-shell level: `plugins/game-production` is implemented and verified as a removable,
core-independent department (see `docs/reviews/post-core-program-status.md`, Phase C), with
`AssetAdapter` / `SceneBuildAdapter` / `SceneValidationAdapter` / `PackageAdapter` as its
replaceable engine/tool boundaries (`plugins/game-production/src/contracts.ts`), backed today by
deterministic reference adapters. What remains deferred is a **real** engine-backed implementation
of those adapters — the 2026-08-07 spec's guidance for that remaining work ("game-specific agents,
Godot/Unreal integrations ... engine automation") is what this document supersedes.

## Decision

**Summer is the primary execution platform for the Game department's real (non-reference)
adapters.** V31M4 does not build a parallel Godot agent stack, a generic engine-side AI
orchestration layer, or its own build/run/test/export automation for game engines. Summer already
provides that; V31M4 consumes it through a thin, replaceable adapter.

```text
V31M4 (department orchestration, policy, evidence, verification, acceptance, audit)
  -> GameDept engine/tool ports (existing: AssetAdapter, SceneBuildAdapter,
     SceneValidationAdapter, PackageAdapter — plugins/game-production/src/contracts.ts)
  -> SummerAdapter (future work, not built by this decision)
  -> Summer, over its MCP server and/or CLI
  -> SummerEngine / Godot
```

Role split:

- **V31M4 owns:** project/scene workflow orchestration (already implemented in
  `GameDepartment`/`plugins/game-production/src/game-department.ts`), policy and permission
  decisions, verification and acceptance criteria, evidence/audit recording, and failure
  classification/recovery (checkpoint/resume, bounded repair, `DEPENDENCY_FAILURE` surfacing) —
  exactly the responsibilities already proven out for Video's real adapters
  (`docs/reviews/target-host-validation.md`).
- **Summer owns:** the execution substrate — actually opening/creating a project, modifying a
  scene, changing gameplay code, importing/referencing assets, building, running, testing, and
  producing runtime evidence inside Godot (or whatever engine Summer itself targets).
- **Summer-hosted AI/agent capabilities are optional** to V31M4 and are never a V31M4 core
  dependency. V31M4 calls Summer as a tool/execution boundary, not as a source of policy,
  verification, or acceptance authority — those stay in V31M4 per the existing department
  architecture.

## Adapter mapping (documentation only — no adapter is implemented by this decision)

A future `SummerAdapter` (or a small family of per-capability adapters, following the same pattern
as Video's `FfmpegAssemblyAdapter` / `OllamaVisionQcAdapter`) would implement the **existing**
`plugins/game-production/src/contracts.ts` interfaces — no new port surface is required for this
decision:

| Existing port | Summer-mediated responsibility |
| --- | --- |
| `AssetAdapter.acquire` | asset import/reference through Summer |
| `SceneBuildAdapter.build` | project open/create, scene create/modify, gameplay code change, build, run, test — whatever Summer's MCP/CLI exposes for producing a built scene |
| `SceneValidationAdapter.validate` | runtime evidence collection + validation via Summer |
| `PackageAdapter.package` | package/export via Summer |

Cancellation/timeout/fail-closed-`DEPENDENCY_FAILURE` handling would follow the same discipline
already implemented and evidenced for Video's real adapters (`context.signal`, argument-array or
MCP-client invocation, no unescaped shell strings) — see
`plugins/video-production/src/internal/run-external-process.ts` for the established pattern this
work would reuse or parallel.

## What this decision does NOT do

- Does not implement `SummerAdapter` or any Summer integration code.
- Does not add Summer-specific types, SDKs, or dependencies to `packages/*` (frozen core) or to
  `plugins/game-production/src` runtime dependencies.
- Does not require Summer to be installed for core or department CI — reference adapters remain
  the CI/unit default, unchanged.
- Does not implement Unreal, Blender, or any other multi-engine adapter now. Those remain
  explicitly out of scope until Summer-mediated Godot is real and validated.
- Does not build a custom generic Godot agent bridge, a generic scene-control framework, or a
  generic engine-side AI orchestration layer — Summer already is that layer; V31M4 stays a
  consumer of it, not a re-implementer.
- Does not change `plugins/game-production/src/contracts.ts` or any other product code.

## Resume gate

Real `SummerAdapter` implementation work may begin once: Summer's MCP/CLI boundary and its actual
capabilities are confirmed against a real, installed Summer instance (no capability is to be
assumed without verification, per `docs/reviews/target-host-validation.md`'s honesty rule); and the
adapter can be implemented and target-host-validated one capability at a time, the same way the
Video real adapters were.

## Acceptance rules (unchanged from the 2026-08-07 spec, reaffirmed)

The Game department's core-independence is already proven (Phase D independence matrix,
`docs/reviews/post-core-program-status.md`): core operates with zero departments, both departments
run together, removing one leaves the other working, and the host operates after both are removed.
This decision does not change or re-test that boundary — it only scopes how the Game department's
*real* adapters will eventually be built.
