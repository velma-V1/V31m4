# Deferred 3D and Game Production Department (historical)

**Superseded 2026-08-09:** the department shell described as deferred below is implemented and
verified — see `docs/reviews/post-core-program-status.md` (Phase C) and
`plugins/game-production/`. Its real (non-reference) adapters are to be built against Summer as
the execution platform, per `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`,
not the generic Godot/Unreal agent approach implied below. This file is retained as the historical
record of the original preserved design.

**Status (historical, at time of writing):** Deferred until after V31M4 core completion
**Type:** First-party removable production plugin
**Core dependency:** None

## Decision

All game-design and game-engine-specific implementation is removed from the core completion path.

Deferred work includes:

- game-specific agents
- Godot/Unreal integrations
- Blender/game-asset pipelines
- procedural asset generation
- engine automation
- gameplay/simulation tooling
- automated game testing
- preview/playtest workflows
- build/export/package workflows

## Future integration boundary

The department must later connect only through generic V31M4 plugin/runtime contracts for capabilities, tools, models, workflows, jobs, artifacts, checkpoints, verification/evidence, resources, approvals, isolated workspaces, and runtime events.

No game-engine-specific business logic, SDK, executable, asset pipeline, or startup requirement belongs in core packages.

## Resume gate

Do not implement this department until the V31M4 core is release-complete and the generic plugin slots are verified with the Game Production department absent.
