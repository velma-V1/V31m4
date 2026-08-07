# Deferred 3D and Game Production Department

**Status:** Deferred until after V31M4 core completion
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
